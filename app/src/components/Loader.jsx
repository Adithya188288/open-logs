// Loading indicator: a small green dot with a soft pulse. Shown only while data has never loaded yet.

/**
 * @param {{ label?: string, size?: 'sm' | 'md' | 'lg', inline?: boolean }} props
 */
export function Loader({ label = 'Loading', size = 'md', inline = false }) {
  return (
    <span className={`loader loader-${size}${inline ? ' inline' : ''}`} role="status" aria-label={label}>
      <span className="pulse-dot" aria-hidden="true" />
    </span>
  );
}
