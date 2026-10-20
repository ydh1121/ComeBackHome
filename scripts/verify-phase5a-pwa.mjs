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

for (const text of ["import.meta.env.PROD","'serviceWorker' in navigator","navigator.serviceWorker.register(SERVICE_WORKER_URL, {"]) {
  if (!register.includes(text)) failures.push('service worker registration missing ' + text);
}
if (!main.includes("import { registerPwaServiceWorker } from './pwa/registerServiceWorker';") || !main.includes('registerPwaServiceWorker();')) {
  failures.push('main service-worker bootstrap missing');
}

for (const text of ["self.addEventListener('install'","self.addEventListener('activate'","self.addEventListener('fetch'","cache.addAll(SHELL_URLS)","request.mode === 'navigate'","cache.match('/')","url.pathname.startsWith('/api/')","cbh-shell-'","v5", "'/theme.js'"]) {
  if (!sw.includes(text)) failures.push('service worker shell behavior missing ' + text);
}
if (!html.includes('<script src="/theme.js"></script>') || html.indexOf('/theme.js') > html.indexOf('/src/main.tsx')) failures.push('appearance must initialize before React');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5A PWA shell verification passed');

// Execute the actual early bootstrap with unavailable storage and OS changes.
const {runInNewContext} = await import('node:vm');
const {default:assert} = await import('node:assert/strict');
const themeSource = await readText('../public/theme.js');
function themeHarness(saved, dark=false, blocked=false) {
  const listeners={}, root={dataset:{},style:{}}, values={}; let changed;
  const media={matches:dark,addEventListener:(_,fn)=>{changed=fn;}};
  const meta={setAttribute(key,value){this[key]=value;}};
  runInNewContext(themeSource,{
    document:{documentElement:root,querySelector:()=>meta},matchMedia:()=>media,
    Event:class{constructor(type){this.type=type;}},
    window:{addEventListener:(type,fn)=>{listeners[type]=fn;},dispatchEvent:()=>{}},
    localStorage:{getItem:()=>{if(blocked)throw Error('denied');return saved;},setItem:(key,value)=>{if(blocked)throw Error('denied');values[key]=value;}},
  });
  return {root,meta,values,set:value=>listeners['cbh:theme-preference']({detail:value}),os:value=>{media.matches=value;changed();},storage:value=>listeners.storage({key:'cbh:theme',newValue:value})};
}
let appearance=themeHarness(null,true);
assert.equal(appearance.root.dataset.theme,'dark');appearance.os(false);assert.equal(appearance.root.dataset.theme,'light');
appearance.set('dark');appearance.os(false);assert.equal(appearance.root.dataset.theme,'dark');assert.equal(appearance.values['cbh:theme'],'dark');
appearance.storage('light');assert.equal(appearance.root.dataset.theme,'light');
appearance=themeHarness('invalid',true);assert.equal(appearance.root.dataset.themePreference,'system');
appearance=themeHarness(null,true,true);appearance.set('light');assert.equal(appearance.root.dataset.theme,'light');assert.equal(appearance.meta.content,'#ffffff');
console.log('theme startup, system changes, override, cross-tab and unavailable storage passed');
