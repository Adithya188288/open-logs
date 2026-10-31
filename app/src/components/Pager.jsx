// Previous / next for the paged tables (Projects, Sources). Shown only when there is more than one page.

/**
 * `page` is the page of the rows on screen, so the label never runs ahead of them; `busy` while the next loads.
 * @param {{ page: number, pageSize: number, total: number, busy?: boolean, onPage: (page: number) => void }} props
 */
export function Pager({ page, pageSize, total, busy = false, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button className="btn" type="button" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="small muted">{`Page ${page} of ${pages}`}</span>
      <button className="btn" type="button" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}
