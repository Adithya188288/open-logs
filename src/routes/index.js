// Route table for the app API (`/api/*`). Ingest lives in `ingest.js`.
import { Router } from '../router.js';
import * as auth from './auth.js';

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
  .on('POST', '/api/invites/:token/accept', auth.acceptInvite);
