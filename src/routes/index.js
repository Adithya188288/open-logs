// Route table for the app API (`/api/*`). Ingest lives in `ingest.js`.
import { Router } from '../router.js';
import * as auth from './auth.js';
import * as boards from './boards.js';
import * as projects from './projects.js';
import * as query from './query.js';

/** Routes that don't need a session. Everything else under /api requires one. */
export const PUBLIC_ROUTES = new Set([
  'POST /api/auth/login',
  'GET /api/config',
  'GET /api/invites/:token',
  'POST /api/invites/:token/accept',
]);

export const api = new Router()
  .on('GET', '/api/config', ({ env }) => Response.json({ team_name: env.TEAM_NAME ?? 'Open Logs' }))
  .on('POST', '/api/auth/login', auth.login)
  .on('POST', '/api/auth/logout', auth.logout)
  .on('GET', '/api/me', auth.me)
  .on('GET', '/api/users', auth.listUsers)
  .on('DELETE', '/api/users/:id', auth.deleteUser)
  .on('POST', '/api/invites', auth.createInvite)
  .on('GET', '/api/invites/:token', auth.getInvite)
  .on('POST', '/api/invites/:token/accept', auth.acceptInvite)
  .on('GET', '/api/projects', projects.listProjects)
  .on('POST', '/api/projects', projects.createProject)
  .on('GET', '/api/projects/:id', projects.getProject)
  .on('PATCH', '/api/projects/:id', projects.renameProject)
  .on('DELETE', '/api/projects/:id', projects.deleteProject)
  .on('GET', '/api/projects/:id/sources', projects.listSources)
  .on('POST', '/api/projects/:id/sources', projects.createSource)
  .on('POST', '/api/sources/:id/regenerate', projects.regenerateSource)
  .on('DELETE', '/api/sources/:id', projects.deleteSource)
  .on('POST', '/api/query', query.query)
  .on('POST', '/api/histogram', query.histogram)
  .on('POST', '/api/aggregate', query.aggregate)
  .on('GET', '/api/status', query.status)
  .on('GET', '/api/projects/:id/views', boards.listViews)
  .on('POST', '/api/projects/:id/views', boards.createView)
  .on('DELETE', '/api/views/:id', boards.deleteView)
  .on('GET', '/api/projects/:id/dashboards', boards.listDashboards)
  .on('POST', '/api/projects/:id/dashboards', boards.createDashboard)
  .on('GET', '/api/dashboards/:id', boards.getDashboard)
  .on('PATCH', '/api/dashboards/:id', boards.renameDashboard)
  .on('DELETE', '/api/dashboards/:id', boards.deleteDashboard)
  .on('POST', '/api/dashboards/:id/charts', boards.createChart)
  .on('PATCH', '/api/charts/:id', boards.updateChart)
  .on('POST', '/api/charts/:id/duplicate', boards.duplicateChart)
  .on('DELETE', '/api/charts/:id', boards.deleteChart);
