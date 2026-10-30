// Runs before first paint so the saved theme never flashes.
try {
  if (localStorage.getItem('logs-theme') === 'dark') document.documentElement.dataset.theme = 'dark';
} catch {}
