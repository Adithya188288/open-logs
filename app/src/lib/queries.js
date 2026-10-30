// Every piece of server data the UI uses, with its React Query key. Load once, keep it:
// nothing refetches on its own unless a screen says so (live tail, dashboard freshness), nothing
// refetches in a background tab, and changes refresh exactly the data they affect via `refresh.*`.
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { api } from './api.js';

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

/**
 * Loads a project's screens' data in the background so the first visit to each is instant.
 * @param {string} projectId
 */
export async function preloadProject(projectId) {
  queryClient.prefetchQuery(q.team());
  queryClient.prefetchQuery(q.settings());
  queryClient.prefetchQuery(q.status());
  queryClient.prefetchQuery(q.sources(projectId));
  queryClient.prefetchQuery(q.views(projectId));
  const dashboards = await queryClient.fetchQuery(q.dashboards(projectId)).catch(() => []);
  for (const d of dashboards) queryClient.prefetchQuery(q.charts(d.id));
}
