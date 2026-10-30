// CSV export, done in the browser from data already on screen.

/** @param {unknown} v */
function cell(v) {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Quote everything; neutralise spreadsheet formulas in attacker-controlled log text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * @param {string[]} header
 * @param {unknown[][]} rows
 */
export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/**
 * @param {string} filename
 * @param {string} csv
 */
export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
