// Every piece of server data the UI uses, with its React Query key. Load once, keep it:
// nothing refetches on its own unless a screen says so (live tail, dashboard freshness), nothing
// refetches in a background tab, and changes refresh exactly the data they affect via `refresh.*`.
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { api } from './api.js';
import { chartQuery, DEFAULT_DASHBOARD_RANGE, fetchTail, RANGES, tailKey } from './live.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
});

/** @param {string} id */
const enc = (id) => encodeURIComponent(id);

export const q = {
  me: () => queryOptions({ queryKey: ['me'], queryFn: () => api('/api/me') }),
  /** Projects with their sources and 24h stats (cards, sidebar, switcher). Refreshed when visited after 5 min. */
  projects: () =>
    queryOptions({
      queryKey: ['projects'],
      queryFn: async () => (await api('/api/projects')).projects,
      staleTime: 5 * 60_000,
    }),
  team: () => queryOptions({ queryKey: ['team'], queryFn: () => api('/api/users') }),
  settings: () =>
    queryOptions({ queryKey: ['settings'], queryFn: async () => (await api('/api/settings')).settings }),
  /** Storage mode and ingest lag; never changes while the app runs. */
  status: () => queryOptions({ queryKey: ['status'], queryFn: () => api('/api/status') }),
  /** @param {string} projectId */
  sources: (projectId) =>
    queryOptions({
      queryKey: ['project', projectId, 'sources'],
      queryFn: async () => (await api(`/api/projects/${enc(projectId)}/sources`)).sources,
    }),
  /** @param {string} id */
  source: (id) =>
    queryOptions({
      queryKey: ['source', id],
      queryFn: async () => (await api(`/api/sources/${enc(id)}`)).source,
    }),
  /** @param {string} projectId */
  dashboards: (projectId) =>
    queryOptions({
      queryKey: ['project', projectId, 'dashboards'],
      queryFn: async () => (await api(`/api/projects/${enc(projectId)}/dashboards`)).dashboards,
    }),
  /** @param {string} dashboardId */
  charts: (dashboardId) =>
    queryOptions({
      queryKey: ['dashboard', dashboardId, 'charts'],
      queryFn: async () => (await api(`/api/dashboards/${enc(dashboardId)}`)).charts,
    }),
  /** @param {string} projectId */
  views: (projectId) =>
    queryOptions({
      queryKey: ['project', projectId, 'views'],
      queryFn: async () => (await api(`/api/projects/${enc(projectId)}/views`)).views,
    }),
  /**
   * Time of the newest event in a project: the cheap "has new data landed?" check behind dashboard refresh.
   * @param {string} projectId
   * @param {number} everyMs
   */
  newest: (projectId, everyMs) =>
    queryOptions({
      queryKey: ['project', projectId, 'newest'],
      queryFn: async () => (await api(`/api/status?project_id=${enc(projectId)}`)).newest_event_at ?? 0,
      refetchInterval: everyMs,
      refetchOnWindowFocus: true,
      // Coming back to the dashboard (or the tab) re-checks only if the last check is 30s+ old.
      staleTime: 30_000,
    }),
};

/** After a change, refresh exactly what it affects. */
export const refresh = {
  team: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  settings: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  projects: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  /** Sources changed: the list, the sidebar count and the project cards. @param {string} projectId */
  sources: (projectId) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'sources'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ]),
  /** @param {string} projectId */
  dashboards: (projectId) =>
    queryClient.invalidateQueries({ queryKey: ['project', projectId, 'dashboards'] }),
  /** @param {string} dashboardId */
  charts: (dashboardId) => queryClient.invalidateQueries({ queryKey: ['dashboard', dashboardId, 'charts'] }),
  /** @param {string} projectId */
  views: (projectId) => queryClient.invalidateQueries({ queryKey: ['project', projectId, 'views'] }),
};

/** Workspace-wide data: loaded once at start-up, not again when switching project. */
let workspaceLoad = /** @type {Promise<unknown> | null} */ (null);
function loadWorkspace() {
  workspaceLoad ??= Promise.allSettled([
    queryClient.fetchQuery(q.team()),
    queryClient.fetchQuery(q.settings()),
    queryClient.fetchQuery(q.status()),
  ]);
  return workspaceLoad;
}

/** @type {Map<string, Promise<unknown>>} */
const projectLoads = new Map();

/**
 * Everything a project's screens show, loaded up front so moving between them never waits:
 * sources, saved views, every dashboard's chart list, the first dashboard's chart data (default range)
 * and the live tail's latest rows (default view). Failures don't block: that part loads on its screen.
 * @param {string} projectId
 * @param {boolean} hasSources  a project without sources can't have logs, so its charts and tail aren't queried
 */
export function loadProject(projectId, hasSources) {
  let load = projectLoads.get(projectId);
  if (!load) {
    load = Promise.allSettled([
      loadWorkspace(),
      queryClient.fetchQuery(q.sources(projectId)),
      queryClient.fetchQuery(q.views(projectId)),
      (async () => {
        const dashboards = await queryClient.fetchQuery(q.dashboards(projectId));
        const lists = await Promise.all(
          dashboards.map((/** @type {any} */ d) => queryClient.fetchQuery(q.charts(d.id))),
        );
        if (hasSources && lists[0]) {
          await Promise.allSettled(
            lists[0].map((/** @type {any} */ c) =>
              queryClient.fetchQuery(chartQuery(projectId, c, DEFAULT_DASHBOARD_RANGE)),
            ),
          );
        }
      })(),
      (async () => {
        const key = tailKey(projectId);
        if (queryClient.getQueryData(key)) return;
        const to = Date.now() + 1000;
        queryClient.setQueryData(
          key,
          await fetchTail(projectId, [], { from: to - RANGES['15m'], to }, false),
        );
      })(),
    ]);
    projectLoads.set(projectId, load);
  }
  return load;
}

/** @param {string} projectId */
export function isProjectLoaded(projectId) {
  return (
    projectLoads.has(projectId) && queryClient.getQueryData(['project', projectId, 'sources']) !== undefined
  );
}
