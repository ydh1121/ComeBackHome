import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { createServer } from 'vite';
import { exportPortable } from './export-portable-modules.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = resolve(root, 'packages/portable');
async function walk(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? walk(resolve(dir, e.name)) : resolve(dir, e.name)))).flat(); }
const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const files = await walk(packageRoot);
const peers = new Set(Object.keys(pkg.peerDependencies));
for (const file of files.filter(f => /\.(ts|tsx|js)$/.test(f))) {
  const source = await readFile(file, 'utf8');
  const imports = ts.preProcessFile(source, true, true).importedFiles.map(x => x.fileName);
  for (const name of imports) {
    if (name.startsWith('.')) assert(!relative(packageRoot, resolve(dirname(file), name)).startsWith('..'), `Module escapes package: ${file} -> ${name}`);
    else assert([...peers].some(p => name === p || name.startsWith(p + '/')), `Undeclared dependency: ${name}`);
  }
  assert(!/cbh[.:]|come-back-home\.pages\.dev|\/api\/people|VAPID_PRIVATE_KEY=/.test(source), `Application configuration leaked into ${file}`);
}
// Every adapter must actually reach its implementation; metadata cannot make an unrelated file satisfy a contract.
const ownership = JSON.parse(await readFile(resolve(root, 'test/portable-adapters.json'), 'utf8'));
async function dependencies(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = await readFile(file, 'utf8');
  const names = ts.preProcessFile(text, true, true).importedFiles.map(x => x.fileName);
  for (const name of names.filter(n => n.startsWith('.'))) {
    const base = resolve(dirname(file), name);
    for (const suffix of ['', '.ts', '.tsx', '.js', '/index.ts']) {
      try { await readFile(base + suffix); await dependencies(base + suffix, seen); break; } catch (e) { if (!['ENOENT','EISDIR'].includes(e.code)) throw e; }
    }
  }
  return seen;
}
for (const [adapter, implementations] of Object.entries(ownership)) {
  const reachable = await dependencies(resolve(root, adapter));
  for (const implementation of implementations) assert(reachable.has(resolve(root, implementation)), `${adapter} does not use ${implementation}`);
}
execFileSync(process.execPath, ['scripts/prepare-theme.mjs', '--check'], { cwd: root, stdio: 'pipe' });
const temp = await mkdtemp(resolve(tmpdir(), 'portable-isolation-'));
let vite;
try {
  const selected = await exportPortable(resolve(temp, 'selected'), ['core', 'http', 'browser']);
  const selectedPackage = JSON.parse(await readFile(resolve(selected, 'package.json'), 'utf8'));
  assert.deepEqual(selectedPackage.peerDependencies, {});
  assert.deepEqual(JSON.parse(await readFile(resolve(selected, 'tsconfig.json'), 'utf8')).compilerOptions.types, []);
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(selected, 'tsconfig.json'), '--pretty', 'false'], { cwd: selected, stdio: 'pipe' });
  const copied = await exportPortable(resolve(temp, 'portable'));
  await assert.rejects(() => exportPortable(copied), /EEXIST/);
  await assert.rejects(() => exportPortable(resolve(temp, 'invalid'), ['unknown']), /Unknown module/);
  await symlink(resolve(root, 'node_modules'), resolve(copied, 'node_modules'), 'dir');
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(copied, 'tsconfig.json'), '--pretty', 'false'], { cwd: copied, stdio: 'pipe' });
  vite = await createServer({ root: copied, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true } });
  const load = path => vite.ssrLoadModule('/' + path);
  const { createReadCache } = await load('browser/read-cache.ts');
  const storage = new Map();
  const storageAPI = { getItem: key => storage.get(key) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
  let time = 100, calls = 0, finish;
  const opts = { dataKey: 'other:reads', settingKey: 'other:enabled', storage: () => storageAPI, defaultEnabled: () => true, isCacheableRead: p => p === '/items', now: () => time, ttlMs: 50, maxEntries: 1 };
  const cache = createReadCache(opts);
  const delayed = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const a = cache.read('a','/items',delayed), b = cache.read('a','/items',delayed);
  assert.equal(calls,1); finish({ value:1 }); const [av,bv] = await Promise.all([a,b]); av.value=2; assert.equal(bv.value,1);
  assert.equal((await cache.read('a','/items',delayed)).value,1);
  time += 51; await assert.rejects(cache.read('a','/items',async()=>{throw Error('offline');}), /offline/);
  const pending = cache.read('a','/items',delayed); cache.invalidate(); finish({value:3}); await pending;
  assert.equal(cache.size(),0,'pre-mutation response must not fill cache');
  await cache.read('a','/items',async()=>({value:4})); await cache.read('b','/items',async()=>({value:5}));
  assert.deepEqual(Object.keys(JSON.parse(storage.get(opts.dataKey))),['b']);
  const other = createReadCache({...opts,dataKey:'independent:reads',settingKey:'independent:enabled'});
  assert.equal(other.size(),0); cache.setEnabled(false); assert.equal(cache.enabled(),false); assert.equal(other.enabled(),true);
  await cache.read('b','/items',async()=>({value:6})); assert.equal(cache.size(),0);
  await other.read('private','/secret',async()=>({secret:1})); assert.equal(other.size(),0);
  const memory = createReadCache({...opts,storage:()=>{throw Error('denied');}});
  await memory.read('x','/items',async()=>1); assert(memory.size()>0); memory.dispose();
  const { JsonHttpClient, HttpApiError } = await load('http/json-client.ts');
  let mutations=0, invalidations=0;
  const api = new JsonHttpClient('/inventory',()=>mutations++,{read:(_k,_p,read)=>read(),invalidate:()=>invalidations++},async(url,init)=>{
    assert.equal(url,'/inventory/items'); assert.equal(init.credentials,'same-origin');
    return Response.json(init.method==='POST'?{error:'conflict',reason:'DUPLICATE'}:{ok:true},{status:init.method==='POST'?409:200});
  });
  await api.get('/items'); assert.equal(invalidations,0);
  await assert.rejects(api.post('/items',{}),e=>e instanceof HttpApiError&&e.status===409&&e.reason==='DUPLICATE'); assert.equal(mutations,0);
  await api.put('/items',{}); assert.equal(invalidations,1); assert.equal(mutations,1);
  await assert.rejects(api.get('items'), /must start/);
  const { createChangeSignalController } = await load('core/change-signal.ts');
  const events = new EventTarget(); const signal = createChangeSignalController(events); let changes=0;
  const unsubscribe=signal.subscribe(()=>changes++); signal.emit(); events.dispatchEvent(new Event('pagehide')); signal.emit(); signal.emit(); assert.equal(changes,1);
  events.dispatchEvent(new Event('pageshow')); assert.equal(changes,2); assert.equal(signal.getVersion(),2); unsubscribe();
  const { FixedDelayRetryPolicy } = await load('core/retry.ts');
  const retry = new FixedDelayRetryPolicy([1,3]); assert.equal(retry.nextAttempt({attempts:2},Error(),new Date(0)),'1970-01-01T00:00:03.000Z'); assert.equal(retry.nextAttempt({attempts:3},Error(),new Date(0)),null);
  const { calendarDate, clockTime } = await load('calendar/time-zone.ts');
  assert.equal(calendarDate(new Date('2026-10-20T15:00:00Z'),'Asia/Seoul'),'2026-10-21'); assert.equal(clockTime(new Date('2026-10-20T15:00:00Z'),'Asia/Seoul'),'00:00');
  const { nextBirthday } = await load('calendar/birthday.ts');
  assert.deepEqual(nextBirthday({calendar:'solar',month:2,day:29,leapMonth:false},'2027-02-27'),{date:'2027-02-28',days:1});
  const { batchOrThrow } = await load('d1/batch.ts');
  await batchOrThrow({batch:()=>{throw Error('empty batch sent');}},[]);
  await assert.rejects(batchOrThrow({batch:async()=>[{success:true},{success:false}]},[{},{}]), /D1 batch/);
  const { decodeCtc } = await load('ocr/ctc.js');
  const ctc=decodeCtc({dims:[1,4,3],data:[.01,.98,.01,.01,.98,.01,.99,.005,.005,.01,.01,.98]},['A','B']);
  assert.equal(ctc.text,'AB'); assert(Math.abs(ctc.confidence-.98)<.00001); assert.throws(()=>decodeCtc({dims:[1,1,4],data:[]},['A']),/alphabet/);
  // Execute the actual blocking bootstrap in an isolated browser-like context.
  const media = new EventTarget(); media.matches=true;
  const win = new EventTarget(); const document={documentElement:{dataset:{},style:{}},querySelector:()=>({setAttribute:(_k,v)=>{document.themeColor=v;}})};
  class CustomEvent extends Event { constructor(type,{detail}) { super(type);this.detail=detail; } }
  const themeStorage=new Map([['cbh:theme','system']]);
  vm.runInNewContext(await readFile(resolve(root,'public/theme.js'),'utf8'),{window:win,document,matchMedia:()=>media,localStorage:{getItem:k=>themeStorage.get(k),setItem:(k,v)=>themeStorage.set(k,v)},Event,CustomEvent});
  assert.equal(document.documentElement.dataset.theme,'dark'); assert.equal(document.themeColor,'#141b27');
  win.dispatchEvent(new CustomEvent('cbh:theme-preference',{detail:'light'})); assert.equal(document.themeColor,'#ffffff'); assert.equal(themeStorage.get('cbh:theme'),'light');
  media.matches=false; win.dispatchEvent(new CustomEvent('cbh:theme-preference',{detail:'invalid'})); assert.equal(document.documentElement.dataset.themePreference,'system'); assert.equal(document.documentElement.dataset.theme,'light');
  cache.dispose(); other.dispose();
  console.log('PASS portable modules: independent copy/typecheck, dependency boundary, adapter ownership, cache races, HTTP errors, lifecycle, retry, calendar, D1, CTC, theme');
} finally { await vite?.close(); await rm(temp,{recursive:true,force:true}); }
