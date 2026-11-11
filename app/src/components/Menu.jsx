// A button that opens a dropdown menu. Closes on outside click, Escape, or choosing an item.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * @param {{ className?: string, label?: string, title?: string, testId?: string, children: import('react').ReactNode, items: (close: () => void) => import('react').ReactNode }} props
 */
export function MenuButton({ className = 'btn', label, title, testId, children, items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const menu = useRef(/** @type {HTMLDivElement | null} */ (null));

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    setPos({
      top: r.bottom + window.scrollY + 4,
      left: Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 240)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const off = (/** @type {Event} */ e) => {
      const outside =
        !menu.current?.contains(/** @type {Node} */ (e.target)) &&
        !button.current?.contains(/** @type {Node} */ (e.target));
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : outside) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
    // Focus the current item when there is one (a long list then opens scrolled to it), else the first.
    const current = menu.current?.querySelector(/** @type {'a'} */ ('[aria-current="true"]'));
    (current ?? menu.current?.querySelector(/** @type {'button'} */ ('button, a')))?.focus();
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', off);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          // biome-ignore lint/a11y/useKeyWithClickEvents: clicks only close the menu; Escape and focus handle keyboards
          <div
            ref={menu}
            className="menu"
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            onClick={() => setOpen(false)}
          >
            {items(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}
