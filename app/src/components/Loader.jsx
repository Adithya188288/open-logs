// The app logo with its green dot pulsing: used for every loading state.

/**
 * @param {{ label?: string, size?: 'sm' | 'md' | 'lg', inline?: boolean }} props
 */
export function Loader({ label = 'Loading', size = 'md', inline = false }) {
  return (
    <div className={`loader loader-${size}${inline ? ' inline' : ''}`} role="status" aria-label={label}>
      <span className="logo" aria-hidden="true" />
      {size !== 'sm' && <span className="loader-label">{label}…</span>}
    </div>
  );
}
