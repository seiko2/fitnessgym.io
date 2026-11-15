(() => {
  const base = String(window.ELITE_API_BASE || '').replace(/\/$/, '');
  const route = document.body.dataset.workspace;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') throw new Error('HTTPS is required.');
    location.replace(url.origin + '/' + (route === 'staff' ? 'staff' : 'admin'));
  } catch (_) {
    document.getElementById('workspace-message').textContent = 'The secure workspace is not connected to this website yet. Please contact the gym administrator.';
  }
})();
