// Alert side panel for one chart: add, edit or remove the chart's alert. The alert watches the chart's own
// filter and measure; here you set when it opens an incident, the period, the quiet time and the webhook.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import { filterText, measureLabel, QUIET, quietLabel, WINDOWS } from '../lib/alerts.js';
import { q } from '../lib/queries.js';
import { confirmDelete } from './Dialogs.jsx';
import { Icon } from './Icon.jsx';
import { Loader } from './Loader.jsx';

const HTTPS = /^https:\/\/[^\s/]+\.[^\s]+$/;

/**
 * @param {{ chart: { id: string, title: string, measure: string, field?: string | null, filter: { where: any[] } },
 *   onClose: () => void, onSaved: (alert: any | null) => void }} props
 */
export function AlertDrawer({ chart, onClose, onSaved }) {
  const { data: existing, isPending } = useQuery(q.chartAlert(chart.id));
  const [form, setForm] = useState({
    name: `${chart.title} alert`,
    kind: 'above',
    threshold: '',
    window: 5,
    quiet: 5,
    webhook: '',
  });
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [tested, setTested] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      kind: existing.kind,
      threshold: String(existing.threshold),
      window: existing.window_minutes,
      quiet: existing.quiet_minutes,
      webhook: existing.webhook_url,
    });
  }, [existing]);

  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** @param {keyof typeof form} key @param {string | number} value */
  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors(({ [key]: _, form: __, ...rest }) => rest);
    if (key === 'webhook') setTested('');
  };

  const what = measureLabel(chart);
  const counting = chart.measure === 'count' || chart.measure === 'count_over_time';
  const unit = form.kind === 'increase' ? '%' : counting ? 'logs' : '';
  const verb = counting ? 'Logs' : what;

  const validate = () => {
    /** @type {Record<string, string>} */
    const e = {};
    if (!form.name.trim()) e.name = 'Enter a name.';
    const n = Number(form.threshold);
    if (!form.threshold.trim() || !Number.isFinite(n) || n <= 0) e.threshold = 'Enter a number above 0.';
    if (!HTTPS.test(form.webhook.trim())) e.webhook = 'Enter a webhook URL starting with https://';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const { alert } = await api(`/api/charts/${chart.id}/alert`, {
        method: 'PUT',
        body: {
          name: form.name.trim(),
          kind: form.kind,
          threshold: Number(form.threshold),
          window_minutes: form.window,
          quiet_minutes: form.quiet,
          webhook_url: form.webhook.trim(),
        },
      });
      onSaved(alert);
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Could not save the alert' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!HTTPS.test(form.webhook.trim())) {
      setErrors((e) => ({ ...e, webhook: 'Enter a webhook URL starting with https://' }));
      return;
    }
    setTested('Sending…');
    try {
      const { result } = await api('/api/webhooks/test', { body: { url: form.webhook.trim() } });
      setTested(/^\d+$/.test(result) ? `Test sent: the URL answered ${result}.` : `Test ${result}.`);
    } catch (err) {
      setTested(err instanceof ApiError ? err.message : 'Could not send the test');
    }
  };

  const remove = () =>
    confirmDelete({
      title: `Remove the alert on “${chart.title}”?`,
      body: 'Its incidents are removed too. An open incident is resolved first and its webhook sent.',
      confirmLabel: 'Remove alert',
      onConfirm: async () => {
        try {
          await api(`/api/charts/${chart.id}/alert`, { method: 'DELETE' });
          onSaved(null);
          return null;
        } catch (err) {
          return err instanceof ApiError ? err.message : 'Remove failed';
        }
      },
    });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed backdrop closes the drawer; Escape does too
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Edit alert' : 'Add alert'}
      >
        <div className="dhead">
          <h2>{existing ? 'Edit alert' : 'Add alert'}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {isPending ? (
          <div className="dbody">
            <Loader size="sm" inline label="Loading alert" />
          </div>
        ) : (
          <>
            <div className="dbody">
              <div className="alertsrc" data-testid="alert-chart">
                <div>
                  <span className="muted">Chart </span>
                  <b>{chart.title}</b>
                </div>
                <div>
                  <span className="muted">Filter </span>
                  <span className="mono">{filterText(chart.filter.where) || 'all logs'}</span>
                </div>
                <div>
                  <span className="muted">Measures </span>
                  {what}
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="al-name">
                  Alert name
                </label>
                <input
                  id="al-name"
                  className="input"
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
                {errors.name && <span className="error-text">{errors.name}</span>}
              </div>
              <div className="field">
                <span className="label">Open an incident when</span>
                <div className="alertrow">
                  <select
                    className="select"
                    aria-label="Condition"
                    value={form.kind}
                    onChange={(e) => set('kind', e.target.value)}
                  >
                    <option value="above">{`${verb} go${counting ? '' : 'es'} above`}</option>
                    <option value="increase">{`${verb} increase${counting ? '' : 's'} by`}</option>
                  </select>
                  <input
                    className="input num"
                    aria-label="Threshold"
                    inputMode="decimal"
                    placeholder={form.kind === 'increase' ? '50' : counting ? '100' : '800'}
                    value={form.threshold}
                    onChange={(e) => set('threshold', e.target.value)}
                  />
                  {unit && <span className="small muted">{unit}</span>}
                </div>
                <div className="alertrow">
                  <span className="small muted">
                    {form.kind === 'increase' ? 'comparing the last' : 'in the last'}
                  </span>
                  <select
                    className="select"
                    aria-label="Time period"
                    value={form.window}
                    onChange={(e) => set('window', Number(e.target.value))}
                  >
                    {WINDOWS.map((w) => (
                      <option key={w} value={w}>
                        {`${w} min`}
                      </option>
                    ))}
                  </select>
                  {form.kind === 'increase' && <span className="small muted">with the period before</span>}
                </div>
                {errors.threshold && <span className="error-text">{errors.threshold}</span>}
                <span className="small muted">
                  Checked every minute. An incident opens about 5–6 minutes after it happens.
                </span>
              </div>
              <div className="field">
                <label className="label" htmlFor="al-quiet">
                  After an incident resolves, wait before opening a new one
                </label>
                <select
                  id="al-quiet"
                  className="select"
                  value={form.quiet}
                  onChange={(e) => set('quiet', Number(e.target.value))}
                >
                  {QUIET.map((m) => (
                    <option key={m} value={m}>
                      {quietLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="al-hook">
                  Webhook URL
                </label>
                <div className="alertrow">
                  <input
                    id="al-hook"
                    className="input mono"
                    placeholder="https://example.com/hooks/alerts"
                    value={form.webhook}
                    onChange={(e) => set('webhook', e.target.value)}
                  />
                  <button className="btn" type="button" onClick={test}>
                    Send test
                  </button>
                </div>
                {errors.webhook ? (
                  <span className="error-text">{errors.webhook}</span>
                ) : (
                  <span className="small muted" data-testid="webhook-test">
                    {tested || 'We POST JSON here when an incident opens and when it resolves.'}
                  </span>
                )}
              </div>
              <p className="small muted">
                One incident at a time. It resolves on its own once things are back to normal, or you can
                resolve it by hand.
              </p>
              <p className="error-text" role="alert">
                {errors.form ?? ''}
              </p>
            </div>
            <div className="dfoot">
              <button className="btn primary" type="button" disabled={busy} onClick={save}>
                {existing ? 'Save alert' : 'Create alert'}
              </button>
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
              {existing && (
                <button className="btn danger" type="button" onClick={remove}>
                  Remove alert
                </button>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
