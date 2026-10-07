import { readFile } from 'node:fs/promises';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readBinary = (path) => readFile(new URL(path, import.meta.url));
const failures = [];

const manifestText = await readText('../public/manifest.webmanifest');
const manifest = JSON.parse(manifestText);
const sw = await readText('../public/sw.js');
const register = await readText('../src/pwa/registerServiceWorker.ts');
const main = await readText('../src/main.tsx');
const html = await readText('../index.html');

for (const [key, expected] of [
  ['name', 'ComeBackHome'],
  ['short_name', 'ComeBackHome'],
  ['id', '/'],
  ['start_url', '/'],
  ['scope', '/'],
  ['display', 'standalone'],
  ['background_color', '#ffffff'],
  ['theme_color', '#ffffff'],
]) {
  if (manifest[key] !== expected) failures.push('manifest ' + key + ' mismatch');
}
if (manifest.lang !== 'ko-KR') failures.push('manifest lang mismatch');

for (const [src, sizes] of [
  ['/icons/icon-192.png', '192x192'],
  ['/icons/icon-512.png', '512x512'],
]) {
  const icon = manifest.icons?.find((item) => item.src === src);
  if (!icon || icon.sizes !== sizes || icon.type !== 'image/png') failures.push('manifest icon missing ' + src);
}

for (const path of ['../public/icons/icon-180.png','../public/icons/icon-192.png','../public/icons/icon-512.png']) {
  const bytes = await readBinary(path);
  if (bytes.length < 100 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') failures.push('invalid PNG ' + path);
}

for (const text of ['rel="manifest" href="/manifest.webmanifest"','rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png"','name="theme-color" content="#ffffff"']) {
  if (!html.includes(text)) failures.push('index metadata missing ' + text);
}

for (const text of ["import.meta.env.PROD","'serviceWorker' in navigator","navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' })"]) {
  if (!register.includes(text)) failures.push('service worker registration missing ' + text);
}
if (!main.includes("import { registerPwaServiceWorker } from './pwa/registerServiceWorker';") || !main.includes('registerPwaServiceWorker();')) {
  failures.push('main service-worker bootstrap missing');
}

for (const text of ["self.addEventListener('install'","self.addEventListener('activate'","self.addEventListener('fetch'","cache.addAll(SHELL_URLS)","request.mode === 'navigate'","cache.match('/')","url.pathname.startsWith('/api/')","cbh-shell-'","v2"]) {
  if (!sw.includes(text)) failures.push('service worker shell behavior missing ' + text);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5A PWA shell verification passed');
