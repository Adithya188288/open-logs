// Previous / next for the paged tables (Projects, Sources). Shown only when there is more than one page.

/**
 * @param {{ page: number, pageSize: number, total: number, onPage: (page: number) => void }} props
 */
export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button className="btn" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="small muted">{`Page ${page} of ${pages}`}</span>
      <button className="btn" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}
