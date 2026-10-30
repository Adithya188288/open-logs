// Light/dark theme, remembered in localStorage (theme-init.js applies it before first paint).

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** @returns {'light' | 'dark'} the new theme */
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('logs-theme', next);
  } catch {}
  return next;
}
