import { useState } from 'react';
import { currentTheme, toggleTheme } from '../lib/theme.js';
import { ThemeIcon } from './Icon.jsx';

/** Theme toggle for screens without the sidebar (sign-in, invite). */
export function ThemeButton() {
  const [label, setLabel] = useState(currentTheme() === 'dark' ? 'Light mode' : 'Dark mode');
  return (
    <button
      className="btn"
      type="button"
      data-testid="theme-toggle"
      onClick={() => setLabel(toggleTheme() === 'dark' ? 'Light mode' : 'Dark mode')}
    >
      <span className="sr">Toggle theme: </span>
      <ThemeIcon />
      <span>{label}</span>
    </button>
  );
}
