/** Install before application CSS to avoid a theme flash. Returns listener cleanup. */
export function installTheme(config) {
  const { storageKey: key, changeEvent, preferenceEvent, colors } = config;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = valid(localStorage.getItem(key)); } catch { /* Private storage may be unavailable. */ }
  function apply() {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    const color = theme === 'dark' ? colors.dark : colors.light;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    window.dispatchEvent(new Event(changeEvent));
  }
  const onPreference = event => {
    preference = valid(event.detail);
    try { localStorage.setItem(key, preference); } catch { /* Keep this session usable. */ }
    apply();
  };
  const onStorage = event => {
    if (event.key === key || event.key === null) {
      preference = valid(event.key === null ? null : event.newValue); apply();
    }
  };
  const onMedia = () => { if (preference === 'system') apply(); };
  window.addEventListener(preferenceEvent, onPreference);
  window.addEventListener('storage', onStorage);
  media.addEventListener('change', onMedia);
  apply();
  return () => {
    window.removeEventListener(preferenceEvent, onPreference);
    window.removeEventListener('storage', onStorage);
    media.removeEventListener('change', onMedia);
  };
}
