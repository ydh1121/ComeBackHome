// Runs before application CSS/React so a saved dark preference never flashes white.
(() => {
  const key = 'cbh:theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = valid(localStorage.getItem(key)); } catch { /* Private storage may be unavailable. */ }
  function apply() {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    const color = theme === 'dark' ? '#141b27' : '#ffffff';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    window.dispatchEvent(new Event('cbh:theme-change'));
  }
  window.addEventListener('cbh:theme-preference', event => {
    preference = valid(event.detail);
    try { localStorage.setItem(key, preference); } catch { /* Keep this session usable. */ }
    apply();
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = valid(event.key === null ? null : event.newValue); apply();
    }
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  apply();
})();
