// Team-wide settings stored in D1, falling back to Worker vars.

/** @param {Env} env */
export async function teamName(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'team_name'").first();
  return String(row?.value ?? env.TEAM_NAME ?? 'Open Logs');
}
