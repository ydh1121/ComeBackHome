import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestName='ocr/weekly/integrity.json';
const publicBase=path.join(root,'public');
const distBase=path.join(root,'dist');
const readJson=async p=>JSON.parse(await readFile(p,'utf8'));
const manifest=await readJson(path.join(publicBase,manifestName));
const shipped=await readJson(path.join(distBase,manifestName));
assert.deepEqual(shipped,manifest,'Build must retain exact source manifest');
assert.equal(manifest.kind,'COMEBACKHOME_OFFICIAL_KOREAN_PP_OCRV5_WEEKLY');
assert.equal(manifest.sameOrigin,true);
assert.equal(manifest.onnxRuntimeWeb,'1.23.2');
assert.match(manifest.modelSha256,/^[0-9a-f]{64}$/);
assert.ok(Array.isArray(manifest.assets)&&manifest.assets.length>=4);
const required=['/ocr/weekly/inference.onnx','/ocr/weekly/dict.json',
  '/ort/ort-wasm-simd-threaded.wasm','/ort/ort-wasm-simd-threaded.mjs'];
for(const asset of manifest.assets){
  assert.match(asset.url,/^\/(?:ocr\/weekly|ort)\/[a-z0-9_.-]+$/);
  assert.match(asset.sha256,/^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(asset.bytes)&&asset.bytes>0&&asset.bytes<=25*1024*1024);
  const relative=asset.url.slice(1);
  for(const base of [publicBase,distBase]){
    const bytes=await readFile(path.join(base,relative));
    assert.equal(bytes.byteLength,asset.bytes,'Size mismatch: '+asset.url);
    assert.equal(hash(bytes),asset.sha256,'Digest mismatch: '+asset.url);
  }
}
for(const url of required)assert.equal(manifest.assets.filter(a=>a.url===url).length,1,
  'Missing or duplicate product runtime asset: '+url);
assert.equal(manifest.assets.find(a=>a.url===required[0]).sha256,manifest.modelSha256);
const html=await readFile(path.join(distBase,'index.html'),'utf8');
assert.match(html,/\/assets\//,'Product Vite bundle entry must exist');
const output=await readdir(path.join(distBase,'assets'));
const scripts=[];
for(const file of output.filter(name=>name.endsWith('.js'))){
  scripts.push(await readFile(path.join(distBase,'assets',file),'utf8'));
}
assert.ok(scripts.some(x=>x.includes('WEEKLY_PADDLE_MODEL_INTEGRITY_MISMATCH')),
  'App production bundle must include actual Paddle runtime integrity enforcement');
assert.ok(scripts.some(x=>x.includes('WEEKLY_3COL_UNSUPPORTED_LAYOUT_REVIEW_REQUIRED')),
  'App production bundle must retain unsupported-layout failure policy');
console.log('CBH_WEEKLY_PRODUCT_BUNDLE_ASSETS_PASS='+JSON.stringify({
  manifest:manifestName,assets:manifest.assets.length,
  hashesVerified:manifest.assets.length*2, sameOrigin:true,
  productionPaddleBundlePresent:true,
  distBytes:(await stat(path.join(distBase,required[0].slice(1)))).size,
  deployed:false,productionD1Mutations:0,
}));
