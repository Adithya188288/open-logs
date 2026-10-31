// "Requests are being rejected": a sender still using an old token. Ingest records the latest rejected request
// on the source (at most once a minute), and the warning shows while that was in the last 15 minutes.

export const REJECTION_WINDOW_MS = 15 * 60 * 1000;

/** @param {{ last_rejected_at: number | null }} source @param {number} [now] */
export function rejectedRecently(source, now = Date.now()) {
  return Boolean(source.last_rejected_at && now - source.last_rejected_at < REJECTION_WINDOW_MS);
}
