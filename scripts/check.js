// Checks that a freshly deployed install answers. A new workers.dev URL can take a few seconds to go live.
// Used by setup and update. It does not wait for Basin: logs become searchable 1–3 minutes after they arrive.
import { sleep } from './lib.js';

const TRIES = 10;
const PAUSE_MS = 3_000;

/**
 * @param {string} url  the install's workers.dev URL
 * @returns {Promise<boolean>}
 */
export async function checkUp(url) {
  for (let i = 0; i < TRIES; i++) {
    const res = await fetch(`${url}/api/health`).catch(() => null);
    if (res?.ok) return true;
    await sleep(PAUSE_MS);
  }
  return false;
}
