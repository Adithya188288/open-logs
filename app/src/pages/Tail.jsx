// Live tail: search, histogram, streaming event list with a details panel, honest freshness.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { confirmDelete, FormDialog, openDialog, toast } from '../components/Dialogs.jsx';
import { Icon } from '../components/Icon.jsx';
import { Topbar, useProject } from '../components/Layout.jsx';
import { Loader } from '../components/Loader.jsx';
import { MenuButton } from '../components/Menu.jsx';
import { ApiError, api } from '../lib/api.js';
import { downloadCsv, toCsv } from '../lib/csv.js';
import { ago, eventTime, hm, hms, hmsms, lagLabel, needsDate, num, span } from '../lib/format.js';
import { fetchTail, RANGES, TAIL_PAGE, tailKey } from '../lib/live.js';
import { q, queryClient, refresh } from '../lib/queries.js';
import { clauseLabel, clauseToSearch, parseSearch } from '../lib/search.js';
import { rejectedRecently } from '../lib/rejections.js';
import { copyText } from '../lib/store.js';

const LEGEND = /** @type {const} */ ([
  ['info', ['debug', 'info']],
  ['warn', ['warn']],
  ['error', ['error', 'fatal']],
]);
const LEVEL_ORDER = ['fatal', 'error', 'warn', 'info', 'debug'];
/** Most events one live check fetches; more than this means the list restarts from the newest page. */
const POLL_LIMIT = 200;
/** Each check re-reads this far back, so late arrivals (retries, buffered senders, Basin's ingest lag) still show. */
const LATE_ARRIVAL_MS = 5 * 60_000;

/** Newest first; events with the same time keep a stable order by id. @param {LogEvent[]} events */
function newestFirst(events) {
  return events.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
/**
 * The legend groups (info, warn, error) the level chip lets through. No level chip lets everything through.
 * The level toggles under the histogram show this, so they always agree with the chips.
 * @param {FieldClause[]} chips
 */
function shownLevels(chips) {
  const c = chips.find((x) => x.field === 'level');
  if (!c) return LEGEND.map(([k]) => k);
  const values = (Array.isArray(c.value) ? c.value : [c.value]).map(String);
  /** @param {string} lv */
  const passes = (lv) =>
    c.op === '=' || c.op === 'in'
      ? values.includes(lv)
      : c.op === '!=' || c.op === 'not_in'
        ? !values.includes(lv)
        : true;
  return LEGEND.filter(([, levels]) => levels.some(passes)).map(([k]) => k);
}

/**
 * The chips with the clause on `field` replaced (or removed when `clause` is null).
 * @param {FieldClause[]} chips @param {string} field @param {FieldClause | null} clause
 */
function withClause(chips, field, clause) {
  const rest = chips.filter((c) => c.field !== field);
  return clause ? [...rest, clause] : rest;
}

const SEARCH_HELP = [
  ['payment failed', 'words anywhere in the message or fields'],
  ['level:error', 'a field equals a value'],
  ['source:api,worker', 'any of several values'],
  ['status:>=500', 'numbers: > >= < <='],
  ['code:!card_declined', 'not equal'],
  ['order_id:*', 'the field exists'],
  ['route:"/a b"', 'quote values with spaces'],
  ['http.status:502', 'nested fields with dots'],
];

/** @typedef {import('../lib/search.js').FieldClause} FieldClause */
/** @typedef {{ id: string, ts: number, source: string, level: string, message: string, fields: Record<string, unknown> }} LogEvent */
/** @typedef {keyof typeof RANGES | 'custom'} Range */

/**
 * Flattens nested fields to dot keys for the details panel.
 * @param {Record<string, unknown>} obj
 * @param {string} [prefix]
 * @returns {[string, unknown][]}
 */
function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatten(/** @type {Record<string, unknown>} */ (v), `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  );
}

/** @param {{ s: any }} s */
function dismissKey({ s }) {
  return `ol-dismiss-${s.id}-${s.last_rejected_at}`;
}

export function Tail() {
  const project = useProject();
  const [params, setParams] = useSearchParams();

  // What to show
  const [range, setRange] = useState(
    /** @type {Range} */ (() => (params.get('range') in RANGES ? params.get('range') : '15m')),
  );
  const [custom, setCustom] = useState({ from: 0, to: 0 });
  const [showCustom, setShowCustom] = useState(false);
  const [initial] = useState(() => parseSearch(params.get('q') ?? ''));
  // The chips are the one filter: the source picker, the level toggles and saved views all read and edit them.
  // Links like /tail?source=api (from a source's page) start with that source's chip.
  const [chips, setChips] = useState(
    /** @type {FieldClause[]} */ (
      () => {
        const linked = params.get('source');
        return linked
          ? withClause(initial.clauses, 'source', { field: 'source', op: '=', value: linked })
          : initial.clauses;
      }
    ),
  );
  const [text, setText] = useState(initial.text);
  const [input, setInput] = useState(initial.text);
  const [zoom, setZoom] = useState(
    /** @type {{ from: number, to: number } | null} */ (
      () => {
        const at = Number(params.get('at'));
        return at ? { from: at - 30_000, to: at + 30_000 } : null;
      }
    ),
  );
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [relative, setRelative] = useState(false);
  const focusId = useRef(params.get('event'));

  // What we have
  const [events, setEvents] = useState(/** @type {LogEvent[]} */ ([]));
  const [freshIds, setFreshIds] = useState(/** @type {Set<string>} */ (new Set()));
  const [nextCursor, setNextCursor] = useState(/** @type {string | null} */ (null));
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [hist, setHist] = useState(/** @type {any} */ (null));
  const [loadPhase, setPhase] = useState(
    /** @type {'loading' | 'ready' | 'too_large' | 'error'} */ ('loading'),
  );
  const [problem, setProblem] = useState(/** @type {ApiError | null} */ (null));
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [status, setStatus] = useState(
    /** @type {{ lag_ms: number, now: number, newest_event_at: number | null } | null} */ (null),
  );
  const [dataThrough, setDataThrough] = useState(0);
  const [nextCheckAt, setNextCheckAt] = useState(0);
  const [, tick] = useState(0);
  // Source status (for the rejected-token banner) re-checks each minute, only while this tab is visible.
  const sources = useQuery({ ...q.sources(project.id), refetchInterval: 60_000 }).data ?? project.sources;
  const views = useQuery(q.views(project.id)).data ?? [];
  const [dismissed, setDismissed] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const searchRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const loadSeq = useRef(0);
  const pollNow = useRef(/** @type {() => void} */ (() => {}));
  const polls = useRef(0);

  const live = !paused && !zoom && range !== 'custom';
  const pollMs = status && status.lag_ms > 0 ? 30_000 : 3000;

  const windowRange = useCallback(() => {
    if (zoom) return zoom;
    if (range === 'custom') return custom;
    const to = Date.now() + 1000;
    return { from: to - RANGES[range], to };
  }, [zoom, range, custom]);

  const where = useMemo(() => (text ? [...chips, { text }] : [...chips]), [chips, text]);
  const filtered = Boolean(chips.length || text);
  const sourceChip = chips.find((c) => c.field === 'source');
  const source = sourceChip?.op === '=' ? String(sourceChip.value) : '';
  const shown = shownLevels(chips);
  const hidden = LEGEND.map(([k]) => k).filter((k) => !shown.includes(k));

  // The address bar keeps the whole filter, so a copied link shows the same view.
  useEffect(() => {
    const search = [...chips.map(clauseToSearch), text].filter(Boolean).join(' ');
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('source');
        if (search) next.set('q', search);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [chips, text, setParams]);
  const cacheKey = tailKey(project.id, { where, zoom, range, custom, reloadKey });
  const queryKey = cacheKey[1];
  const [loadedKey, setLoadedKey] = useState('');
  // Until data for the current query arrives, show the loader rather than the previous query's rows.
  const phase = loadedKey === queryKey ? loadPhase : 'loading';
  const pollRef = useRef(pollMs);
  pollRef.current = pollMs;

  // Full load whenever what we're looking at changes (reloadKey: the Retry button).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a deliberate trigger
  useEffect(() => {
    const seq = ++loadSeq.current;
    const w = windowRange();
    setProblem(null);
    setSelected(null);
    setCursor(0);
    // Rows we already have for this view (preloaded at start-up, or from an earlier visit) show
    // straight away; they're refreshed quietly unless they're less than 30 seconds old.
    const kept = queryClient.getQueryData(cacheKey);
    const show = (/** @type {any} */ d) => {
      setStatus(d.status);
      setEvents(d.events);
      setNextCursor(d.nextCursor);
      setHist(d.hist);
      setUnfilteredTotal(d.unfiltered);
      setDataThrough(d.status.now - d.status.lag_ms);
      setPhase('ready');
      setLoadedKey(queryKey);
      if (focusId.current) {
        const i = d.events.findIndex((/** @type {LogEvent} */ e) => e.id === focusId.current);
        if (i >= 0) {
          setCursor(i);
          setSelected(focusId.current);
        }
        focusId.current = null;
      }
    };
    if (kept) show(kept);
    else setPhase('loading');
    (async () => {
      if (!kept || Date.now() - kept.at > 30_000) {
        try {
          const d = await fetchTail(project.id, where, w, filtered);
          if (seq !== loadSeq.current) return;
          queryClient.setQueryData(cacheKey, d);
          show(d);
        } catch (err) {
          if (seq !== loadSeq.current) return;
          setPhase(err instanceof ApiError && err.code === 'query_too_large' ? 'too_large' : 'error');
          setProblem(err instanceof ApiError ? err : null);
          setLoadedKey(queryKey);
        }
      }
      setNextCheckAt(Date.now() + pollRef.current);
    })();
  }, [project.id, where, windowRange, filtered, reloadKey]);

  // Latest values for the poller, without restarting its timer on every change.
  const latest = useRef({ events, cursor, where, hist, status, phase, live, windowRange, pollMs });
  latest.current = { events, cursor, where, hist, status, phase, live, windowRange, pollMs };

  /**
   * Fetches what arrived since the last check and merges it in, always (it's a live tail).
   * Each check re-reads the last few minutes too, so an event that lands late with an earlier time still
   * appears in its place. If more arrived than one check fetches, so that the page never reaches the rows
   * already shown, the list restarts from the newest page (older rows stay reachable through Load older),
   * so it never shows a hole. On a busy project the overlap alone can fill a page; that is not a gap.
   * The histogram refreshes only when new events arrived or every 4th poll; freshness is computed locally.
   */
  useEffect(() => {
    const poll = async () => {
      const current = latest.current;
      // Nothing runs while this tab is in the background; we catch up when it's visible again.
      if (!current.live || current.phase !== 'ready' || document.visibilityState !== 'visible') return;
      const seq = loadSeq.current;
      polls.current += 1;
      try {
        const windowFrom = current.windowRange().from;
        const newest = current.events[0]?.ts ?? windowFrom;
        const page = await api('/api/query', {
          body: {
            project_id: project.id,
            from: Math.max(windowFrom, newest - LATE_ARRIVAL_MS),
            to: Date.now() + 1000,
            where: current.where,
            limit: POLL_LIMIT,
          },
        });
        if (seq !== loadSeq.current) return;
        const known = new Set(current.events.map((e) => e.id));
        const fresh = page.events.filter((/** @type {LogEvent} */ e) => !known.has(e.id));
        if (fresh.length || polls.current % 4 === 0) {
          const histogram = await api('/api/histogram', {
            body: { project_id: project.id, ...current.windowRange(), where: current.where },
          });
          if (seq === loadSeq.current) setHist(histogram);
        }
        const oldestFetched = page.events.at(-1)?.ts ?? newest;
        if (page.next_cursor && oldestFetched > newest) {
          // More arrived than one check fetches (the page never reached the rows already shown):
          // show the newest page and page back from there, instead of leaving a hole.
          setFreshIds(new Set(fresh.map((/** @type {LogEvent} */ e) => e.id)));
          setEvents(page.events);
          setNextCursor(page.next_cursor);
          setCursor(0);
        } else if (fresh.length) {
          const merged = newestFirst([...fresh, ...current.events]);
          const cursorEvent = current.events[current.cursor];
          setFreshIds(new Set(fresh.map((/** @type {LogEvent} */ e) => e.id)));
          setEvents(merged);
          if (cursorEvent) setCursor(merged.indexOf(cursorEvent));
        }
        if (current.status) setDataThrough(Date.now() - current.status.lag_ms);
      } catch {}
      setNextCheckAt(Date.now() + current.pollMs);
    };
    pollNow.current = poll;
    const pollTimer = setInterval(poll, pollMs);
    const onVisible = () => document.visibilityState === 'visible' && poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs, project.id]);

  // Keep the kept rows current as new events stream in, so coming back shows them too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheKey is derived from queryKey
  useEffect(() => {
    const kept = queryClient.getQueryData(cacheKey);
    if (kept && loadedKey === queryKey && kept.events !== events)
      queryClient.setQueryData(cacheKey, { ...kept, events, hist, at: Date.now() });
  }, [events, hist, queryKey, loadedKey]);

  // Countdown in the freshness pill (only redraws while the tab is visible).
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const loadViews = () => refresh.views(project.id);

  // "/" jumps to search from anywhere.
  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (freshIds.size) {
      const t = setTimeout(() => setFreshIds(new Set()), 2500);
      return () => clearTimeout(t);
    }
  }, [freshIds]);

  /** @param {string} field @param {unknown} value */
  const addFilter = (field, value) => {
    const v = typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    setChips((c) => [...c.filter((x) => x.field !== field), { field, op: '=', value: v }]);
  };

  const applySearch = () => {
    const parsed = parseSearch(input);
    setChips((c) => parsed.clauses.reduce((acc, cl) => [...acc.filter((x) => x.field !== cl.field), cl], c));
    setText(parsed.text);
    setInput(parsed.text);
  };

  const clearFilters = () => {
    setChips([]);
    setText('');
    setInput('');
  };

  /** @param {string} name */
  const pickSource = (name) =>
    setChips((c) => withClause(c, 'source', name ? { field: 'source', op: '=', value: name } : null));

  /** Turns a legend group on or off by editing the level chip. The last group can't be turned off. @param {string} key */
  const toggleLevel = (key) =>
    setChips((c) => {
      const on = shownLevels(c);
      const next = on.includes(key) ? on.filter((k) => k !== key) : [...on, key];
      if (!next.length) return c;
      if (next.length === LEGEND.length) return withClause(c, 'level', null);
      const levels = LEGEND.filter(([k]) => next.includes(k)).flatMap(([, lv]) => lv);
      return withClause(
        c,
        'level',
        levels.length === 1
          ? { field: 'level', op: '=', value: levels[0] }
          : { field: 'level', op: 'in', value: levels },
      );
    });

  /** @param {Range} r */
  const pickRange = (r) => {
    setZoom(null);
    if (r === 'custom') {
      const w = windowRange();
      setCustom({ from: w.from, to: w.to });
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    setRange(r);
  };

  /** @param {any} v */
  const applyView = (v) => {
    setChips(v.filter.where.filter((/** @type {any} */ c) => 'field' in c));
    const t = v.filter.where.find((/** @type {any} */ c) => 'text' in c)?.text ?? '';
    setText(t);
    setInput(t);
    setZoom(null);
    setShowCustom(false);
    if (v.filter.range) setRange(v.filter.range);
  };

  const saveView = () =>
    openDialog((close) => (
      <FormDialog
        title="Save view"
        submitLabel="Save view"
        onClose={close}
        onSubmit={async (v) => {
          /** @type {object[]} */
          const w = [...chips];
          if (text) w.push({ text });
          try {
            await api(`/api/projects/${project.id}/views`, {
              body: { name: v.name, filter: { where: w, range: range === 'custom' ? '1h' : range } },
            });
            await loadViews();
            toast('View saved');
            return null;
          } catch (err) {
            return err instanceof ApiError ? err.message : 'Could not save';
          }
        }}
      >
        <div className="field">
          <label className="label" htmlFor="vname">
            Name
          </label>
          <input id="vname" className="input" name="name" required maxLength={60} placeholder="Errors only" />
        </div>
        <p className="small muted">Saves the filters (source, levels, search) and the time range.</p>
      </FormDialog>
    ));

  /** @param {any} v */
  const deleteView = (v) =>
    confirmDelete({
      title: `Delete view ${v.name}?`,
      body: 'Only the saved view goes away. No logs are deleted.',
      confirmLabel: 'Delete view',
      onConfirm: async () => {
        try {
          await api(`/api/views/${v.id}`, { method: 'DELETE' });
          await loadViews();
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Delete failed';
        }
      },
    });

  const loadOlder = async () => {
    if (!nextCursor) return;
    const seq = loadSeq.current;
    const page = await api('/api/query', {
      body: { project_id: project.id, ...windowRange(), where, limit: TAIL_PAGE, cursor: nextCursor },
    });
    // The view changed while this was loading: these rows belong to the previous query.
    if (seq !== loadSeq.current) return;
    setEvents((prev) => [...prev, ...page.events]);
    setNextCursor(page.next_cursor);
  };

  const exportCsv = () =>
    downloadCsv(
      `${project.name}-logs.csv`,
      toCsv(
        ['time_utc', 'level', 'source', 'message', 'fields'],
        events.map((e) => [new Date(e.ts).toISOString(), e.level, e.source, e.message, e.fields]),
      ),
    );

  /** @param {import('react').KeyboardEvent} e */
  const onListKey = (e) => {
    const n = events.length;
    if (!n) return;
    let next = cursor;
    if (e.key === 'j') next = Math.min(n - 1, cursor + 1);
    else if (e.key === 'k') next = Math.max(0, cursor - 1);
    else if (e.key === 'Enter' && e.target === e.currentTarget) {
      const id = events[cursor]?.id ?? null;
      setSelected((s) => (s === id ? null : id));
      e.preventDefault();
      return;
    } else if (e.key === 'Escape' && selected) {
      setSelected(null);
      return;
    } else return;
    e.preventDefault();
    setCursor(next);
    if (selected) setSelected(events[next]?.id ?? null);
    listRef.current?.querySelectorAll('.ev')[next]?.scrollIntoView({ block: 'nearest' });
  };

  const w = windowRange();
  const dated = !relative && needsDate(w);
  const windowName = zoom || range === 'custom' ? 'this range' : `the last ${span(w.to - w.from)}`;
  const lag = status && status.lag_ms > 0 ? ` · ${lagLabel(status.lag_ms)} ingest lag` : '';
  const statusText = !dataThrough
    ? 'Loading…'
    : paused
      ? `Paused · frozen at data through ${hms(dataThrough)} UTC`
      : zoom || range === 'custom'
        ? `Viewing ${hms(w.from)}–${hms(w.to)} UTC${lag}`
        : `Data through ${hms(dataThrough)} UTC${lag} · next check ${Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000))}s`;
  const bad = sources.find((s) => rejectedRecently(s) && !isDismissed(s));
  const panelEvent = events.find((e) => e.id === selected);
  void dismissed;

  return (
    <>
      <Topbar
        title="Live tail"
        meta={
          <span className={`pill${live && dataThrough ? ' ok' : ''}`} data-testid="freshness">
            <span className={`dot ${live && dataThrough ? 'live' : 'off'}`} />
            {statusText}
          </span>
        }
      >
        <div className="seg" role="group" aria-label="Time range">
          {[...Object.keys(RANGES), 'custom'].map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={
                !zoom && (r === 'custom' ? range === 'custom' || showCustom : range === r && !showCustom)
              }
              onClick={() => pickRange(/** @type {Range} */ (r))}
            >
              {r === 'custom' ? 'Custom' : r}
            </button>
          ))}
        </div>
        <button
          className="btn ghost"
          type="button"
          onClick={() => pollNow.current()}
          disabled={!live}
          title="Check for new events now"
        >
          <Icon name="refresh" size={14} />
          Refresh
        </button>
        <button className="btn" type="button" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          <Icon name={paused ? 'play' : 'pause'} size={14} />
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn ghost" type="button" onClick={exportCsv}>
          <Icon name="download" size={14} />
          Export CSV
        </button>
      </Topbar>

      {bad && (
        <div className="problem">
          <div className="alert err" role="alert" data-testid="ingestion-problem">
            <Icon name="info" />
            <div className="body">
              <strong>{`Requests from ${bad.name} are being rejected`}</strong>
              <span>
                {`Requests for this source (latest ${hms(bad.last_rejected_at)} UTC) were rejected with `}
                <code>401 invalid token</code>. The token may have been regenerated.
              </span>
            </div>
          </div>
          <div className="acts">
            <Link className="btn" to={`/sources?project=${encodeURIComponent(project.id)}`}>
              Check source token
            </Link>
            <button
              className="btn"
              type="button"
              onClick={() => {
                try {
                  localStorage.setItem(dismissKey({ s: bad }), '1');
                } catch {}
                setDismissed((d) => d + 1);
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="tail-tools">
        {showCustom && (
          <CustomRange
            initial={custom}
            onApply={(c) => {
              setCustom(c);
              setRange('custom');
            }}
          />
        )}
        <div className="tools-row">
          <label className="sr" htmlFor="srcsel">
            Source
          </label>
          <select
            id="srcsel"
            className="select"
            aria-label="Source"
            value={source}
            onChange={(e) => pickSource(e.target.value)}
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
            {source && !sources.some((s) => s.name === source) && <option value={source}>{source}</option>}
          </select>
          <div className="query">
            <Icon name="search" size={15} />
            <span className="chips">
              {chips.map((c) => (
                <span key={`${c.field}:${c.op}`} className="chip">
                  {clauseLabel(c)}
                  <button
                    type="button"
                    aria-label={`Remove filter ${clauseLabel(c)}`}
                    onClick={() => setChips((cs) => cs.filter((x) => x !== c))}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </span>
            <label className="sr" htmlFor="q">
              Search events
            </label>
            <input
              id="q"
              ref={searchRef}
              placeholder="Search message, or field:value  e.g. status:500"
              autoComplete="off"
              spellCheck="false"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch();
                if (e.key === 'Escape') listRef.current?.focus();
                if (e.key === 'Backspace' && !input && chips.length) setChips((cs) => cs.slice(0, -1));
              }}
            />
            <MenuButton
              className="iconbtn"
              label="Search help"
              title="Search help"
              items={() => (
                <>
                  <div className="menu-label">Search syntax</div>
                  <div className="help" data-testid="search-help">
                    {SEARCH_HELP.flatMap(([q, what]) => [
                      <code key={`${q}-q`}>{q}</code>,
                      <span key={`${q}-w`}>{what}</span>,
                    ])}
                  </div>
                  <p className="tiny muted menu-note">
                    Press Enter: field:value parts become filter chips. Backspace in an empty box removes the
                    last chip.
                  </p>
                </>
              )}
            >
              <Icon name="help" size={15} />
            </MenuButton>
            <kbd>/</kbd>
          </div>
          <MenuButton
            testId="views-menu"
            items={() => (
              <>
                <div className="menu-label">Saved views</div>
                {views.length ? (
                  views.map((v) => (
                    <div key={v.id} className="menu-row">
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="saved-view"
                        onClick={() => applyView(v)}
                      >
                        {v.name}
                      </button>
                      <button
                        className="iconbtn"
                        type="button"
                        aria-label={`Delete view ${v.name}`}
                        onClick={() => deleteView(v)}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="tiny muted menu-note">No saved views yet.</p>
                )}
                <hr />
                <button type="button" role="menuitem" onClick={saveView}>
                  <Icon name="plus" size={14} />
                  Save current view…
                </button>
              </>
            )}
          >
            Views
            <Icon name="chevron" size={14} />
          </MenuButton>
          <button className="btn" type="button" aria-pressed={wrap} onClick={() => setWrap((x) => !x)}>
            Wrap lines
          </button>
        </div>
        <Histogram
          hist={phase === 'ready' ? hist : null}
          phase={phase}
          zoom={zoom}
          windowRange={w}
          summaryWindow={
            zoom
              ? span(zoom.to - zoom.from)
              : range === 'custom'
                ? 'custom range'
                : span(RANGES[/** @type {keyof typeof RANGES} */ (range)])
          }
          hidden={hidden}
          onToggle={toggleLevel}
          onZoom={setZoom}
        />
      </div>

      <div className={`tail-body${panelEvent ? ' with-panel' : ''}`}>
        <div className={`table${dated ? ' dated' : ''}`}>
          <div className="thead">
            <button
              type="button"
              title="Switch absolute / relative time"
              onClick={() => setRelative((r) => !r)}
            >
              {relative ? 'Age ⇄' : 'Time · UTC ⇄'}
            </button>
            <span>Level</span>
            <span>Source</span>
            <span>Message</span>
            <span />
          </div>
          <div className="sr" aria-live="polite">
            {events[cursor]
              ? `Event ${cursor + 1} of ${events.length}: ${events[cursor].level}, ${events[cursor].source}, ${events[cursor].message.slice(0, 120)}`
              : ''}
          </div>
          <div
            ref={listRef}
            role="region"
            className={`list${wrap ? ' wrap' : ''}${phase === 'loading' ? ' refreshing' : ''}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the list takes focus so j/k/Enter can move through events
            tabIndex={0}
            aria-label="Event list. j and k move between events, Enter opens details, slash jumps to search."
            onKeyDown={onListKey}
          >
            {phase === 'loading' && !events.length ? (
              <div className="list-loading">
                <Loader label="Loading events" />
              </div>
            ) : phase === 'too_large' ? (
              <div className="toolarge" data-testid="too-large">
                <div className="alert warn" role="alert">
                  <Icon name="warn" />
                  <div className="body">
                    <strong>This search would scan too much data</strong>
                    <span>{problem?.hint ?? 'Narrow the time range or add a field filter.'}</span>
                  </div>
                </div>
                <div className="acts">
                  <button className="btn" type="button" onClick={() => pickRange('24h')}>
                    Try last 24h
                  </button>
                  <button className="btn" type="button" onClick={() => addFilter('level', 'error')}>
                    Add level:error
                  </button>
                </div>
              </div>
            ) : phase === 'error' ? (
              <div className="state" role="alert">
                <h2>Could not load events</h2>
                <p>{problem?.message ?? 'The server did not answer.'}</p>
                <button className="btn" type="button" onClick={() => setReloadKey((k) => k + 1)}>
                  Retry
                </button>
              </div>
            ) : !events.length ? (
              filtered ? (
                <div className="state" data-testid="no-results">
                  <Icon name="nothing" size={28} />
                  <h2>
                    No events match{' '}
                    <code>{[...chips.map(clauseToSearch), text].filter(Boolean).join(' ')}</code> in{' '}
                    {windowName}
                  </h2>
                  <p>{`${num(unfilteredTotal)} events came in during that time, none with this value.`}</p>
                  <div className="rowline">
                    {range !== '24h' && !zoom && (
                      <button className="btn" type="button" onClick={() => pickRange('24h')}>
                        Search last 24h
                      </button>
                    )}
                    <button className="btn" type="button" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </div>
                </div>
              ) : !status?.newest_event_at ? (
                <div className="state" data-testid="waiting">
                  <h2>Waiting for the first event</h2>
                  <p>Connect a source and send one event. It shows up here on its own.</p>
                  <div className="rowline">
                    <Link
                      className="btn primary"
                      to={`/sources?project=${encodeURIComponent(project.id)}&new=1`}
                    >
                      Connect a source
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="state" data-testid="no-results">
                  <Icon name="nothing" size={28} />
                  <h2>No events in {windowName}</h2>
                  <p>{`The newest event arrived ${ago(status.newest_event_at)} (${hms(status.newest_event_at)} UTC).`}</p>
                  <div className="rowline">
                    <button className="btn" type="button" onClick={() => pickRange('7d')}>
                      Search last 7 days
                    </button>
                  </div>
                </div>
              )
            ) : (
              <>
                {phase === 'loading' && (
                  <div className="list-refreshing">
                    <Loader size="sm" inline label="Loading events" />
                  </div>
                )}
                {events.map((e, i) => {
                  const open = selected === e.id;
                  return (
                    <div
                      key={e.id}
                      className={`ev${open ? ' open' : ''}${cursor === i ? ' cursor' : ''}${freshIds.has(e.id) ? ' fresh' : ''}`}
                      data-testid="event"
                      data-id={e.id}
                    >
                      <button
                        className="row"
                        type="button"
                        tabIndex={-1}
                        aria-pressed={open}
                        onClick={() => {
                          setCursor(i);
                          setSelected(open ? null : e.id);
                        }}
                      >
                        <span className="t">{relative ? ago(e.ts) : eventTime(e.ts, dated)}</span>
                        <span className={`lvl ${e.level}`}>{e.level.toUpperCase()}</span>
                        <span className="src" title={e.source}>
                          {e.source}
                        </span>
                        <span className="msg">{e.message}</span>
                        <span className="chev" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
        {panelEvent && (
          <EventPanel
            e={panelEvent}
            projectId={project.id}
            onClose={() => {
              setSelected(null);
              listRef.current?.focus();
            }}
            onFilter={(field, value) => addFilter(field, value)}
            onAround={() => {
              clearFilters();
              focusId.current = panelEvent.id;
              setZoom({ from: panelEvent.ts - 30_000, to: panelEvent.ts + 30_000 });
            }}
          />
        )}
      </div>

      <div className="tfoot">
        <span>
          {phase === 'ready'
            ? `Showing ${num(events.length)} of ${num(hist?.total ?? 0)} · newest first `
            : ''}
          {nextCursor && (
            <button className="btn" type="button" onClick={loadOlder}>
              Load older
            </button>
          )}
        </span>
        <span>
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> details · <kbd>/</kbd> search
        </span>
      </div>
    </>
  );
}

/** @param {any} s */
function isDismissed(s) {
  try {
    return localStorage.getItem(dismissKey({ s })) === '1';
  } catch {
    return false;
  }
}

/** @param {{ initial: { from: number, to: number }, onApply: (r: { from: number, to: number }) => void }} props */
function CustomRange({ initial, onApply }) {
  const toLocal = (/** @type {number} */ ts) => new Date(ts).toISOString().slice(0, 16);
  const [from, setFrom] = useState(toLocal(initial.from));
  const [to, setTo] = useState(toLocal(initial.to));
  return (
    <div className="custom-range">
      <span className="muted">UTC</span>
      <input
        type="datetime-local"
        aria-label="From (UTC)"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      →
      <input type="datetime-local" aria-label="To (UTC)" value={to} onChange={(e) => setTo(e.target.value)} />
      <button
        className="btn"
        type="button"
        onClick={() => {
          const f = Date.parse(`${from}Z`);
          const t = Date.parse(`${to}Z`);
          if (!(f < t)) return toast('Pick a start before the end');
          if (t - f > RANGES['7d']) return toast('Custom ranges are limited to 7 days');
          onApply({ from: f, to: t });
        }}
      >
        Apply
      </button>
    </div>
  );
}

/**
 * @param {{ hist: any, phase: string, zoom: { from: number, to: number } | null, windowRange: { from: number, to: number }, summaryWindow: string,
 *   hidden: string[], onToggle: (k: string) => void, onZoom: (z: { from: number, to: number } | null) => void }} props
 */
function Histogram({ hist, phase, zoom, windowRange, summaryWindow, hidden, onToggle, onZoom }) {
  if (!hist) {
    return (
      <div className="hist">
        <div className="summary">
          {phase === 'loading' ? <Loader size="sm" inline label="Loading histogram" /> : <span />}
        </div>
      </div>
    );
  }
  const total = (/** @type {any} */ b) => b.debug + b.info + b.warn + b.error + b.fatal;
  const max = Math.max(1, ...hist.buckets.map(total));
  const longRange = windowRange.to - windowRange.from > 86_400_000;
  return (
    <div className="hist">
      <div className="summary">
        <span>
          <span data-testid="summary">
            <b>{num(hist.total)}</b> {`events · ${summaryWindow} · `}
            <span className="bad">{`${num(hist.errors)} errors`}</span>
          </span>
          {zoom && (
            <span className="zoomed">
              {`${hms(zoom.from)}–${hms(zoom.to)} UTC`}
              <button className="btn" type="button" onClick={() => onZoom(null)}>
                Back to now
              </button>
            </span>
          )}
        </span>
        <span className="legend" role="group" aria-label="Show levels">
          {LEGEND.map(([key]) => (
            <button
              key={key}
              type="button"
              aria-pressed={!hidden.includes(key)}
              onClick={() => onToggle(key)}
            >
              <span className={`sw ${key}`} />
              {key}
            </button>
          ))}
        </span>
      </div>
      <div className="plot">
        <div className="yaxis" aria-hidden="true">
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="bars" data-testid="histogram">
          {hist.buckets.map((/** @type {any} */ b) => {
            const end = b.t + hist.interval_ms;
            const label = `${hms(b.t)} UTC · info ${b.info + b.debug}, warn ${b.warn}, error ${b.error + b.fatal} · click to zoom`;
            const dim = zoom && (b.t !== zoom.from || end !== zoom.to);
            return (
              <button
                key={b.t}
                className={`bar${dim ? ' dim' : ''}${total(b) ? '' : ' empty'}`}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => onZoom({ from: b.t, to: end })}
              >
                {LEVEL_ORDER.filter((lv) => b[lv]).map((lv) => (
                  <span key={lv} className={`seg-${lv}`} style={{ height: `${(b[lv] / max) * 64}px` }} />
                ))}
              </button>
            );
          })}
        </div>
      </div>
      <div className="xaxis" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i}>
            {hm(windowRange.from + ((windowRange.to - windowRange.from) * i) / 4, longRange)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * @param {{ e: LogEvent, projectId: string, onClose: () => void, onFilter: (field: string, value: unknown) => void, onAround: () => void }} props
 */
function EventPanel({ e, projectId, onClose, onFilter, onAround }) {
  /** @type {[string, unknown, string | null][]} */
  const rows = [
    ['timestamp', new Date(e.ts).toISOString(), null],
    ['source', e.source, 'source'],
    ['level', e.level, 'level'],
    ...flatten(e.fields).map(
      ([k, v]) => /** @type {[string, unknown, string | null]} */ ([k, v, `fields.${k}`]),
    ),
  ];
  const chartHref = (/** @type {string} */ f) =>
    `/dashboard?project=${encodeURIComponent(projectId)}&chart=${encodeURIComponent(f)}`;
  return (
    <aside className="evpanel" aria-label="Event details">
      <div className="detail">
        <div className="panelhead">
          <div>
            <span className={`lvl ${e.level}`}>{e.level.toUpperCase()}</span>
            <span className="mono small muted">{` ${hmsms(e.ts)} UTC · ${e.source}`}</span>
          </div>
          <button className="iconbtn" type="button" aria-label="Close details" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <p className="panelmsg">{e.message}</p>
        <div className="fields">
          {rows.map(([k, v, field]) => (
            <div key={k} className="f">
              <span className="k" title={k}>
                {k}
              </span>
              <span className="v">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
              <span className="acts">
                {field && (v === null || typeof v !== 'object') && (
                  <button
                    className="btn"
                    type="button"
                    title="Filter on this value"
                    onClick={() => onFilter(field, v)}
                  >
                    = Filter
                  </button>
                )}
                {field && (
                  <Link className="btn" to={chartHref(field)} title="Chart this field">
                    Chart
                  </Link>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="side">
          <button
            className="btn"
            type="button"
            onClick={async () =>
              toast((await copyText(JSON.stringify(e, null, 2))) ? 'Copied as JSON' : 'Copy failed')
            }
          >
            Copy as JSON
          </button>
          <button className="btn" type="button" onClick={onAround}>
            View events around this
          </button>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              const url = `${window.location.origin}/tail?project=${encodeURIComponent(projectId)}&at=${e.ts}&event=${encodeURIComponent(e.id)}`;
              toast((await copyText(url)) ? 'Link copied' : 'Copy failed');
            }}
          >
            Copy link to event
          </button>
        </div>
      </div>
    </aside>
  );
}
