import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor', 'ocr', 'weekly');
const publicWeekly = path.join(root, 'public', 'ocr', 'weekly');
const publicOrt = path.join(root, 'public', 'ort');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MODEL_SHA = '92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08';
const DICT_SHA = '8aa03fad51cd719c83590dfc4d7e3edea6f2a01f07a08fc476250f42322bb403';
const FILE_LIMIT = 25 * 1024 * 1024;

const model = await readFile(path.join(vendor, 'inference.onnx'));
const dictBytes = await readFile(path.join(vendor, 'dict.json'));
assert.equal(sha256(model), MODEL_SHA, 'WEEKLY_PADDLE_MODEL_INTEGRITY_MISMATCH');
assert.equal(sha256(dictBytes), DICT_SHA, 'WEEKLY_PADDLE_DICTIONARY_INTEGRITY_MISMATCH');
assert.ok(model.length > 0 && model.length <= FILE_LIMIT, 'CLOUDFLARE_MODEL_FILE_LIMIT');
assert.ok(dictBytes.length > 0 && dictBytes.length <= FILE_LIMIT, 'CLOUDFLARE_DICTIONARY_FILE_LIMIT');
assert.ok(!dictBytes.toString('utf8').trimStart().startsWith('<'), 'WEEKLY_PADDLE_DICTIONARY_HTML_FALLBACK');
const alphabet = JSON.parse(dictBytes.toString('utf8'));
assert.ok(Array.isArray(alphabet) && alphabet.length === 11946 &&
  alphabet.includes('강') && alphabet.includes('0') &&
  alphabet.at(-1) === ' ' && alphabet.every(char => typeof char === 'string'),
  'WEEKLY_PADDLE_DICTIONARY_INVALID');
const pkg = JSON.parse(await readFile(path.join(root, 'node_modules', 'onnxruntime-web', 'package.json'), 'utf8'));
assert.equal(pkg.version, '1.23.2', 'WEEKLY_PADDLE_ORT_VERSION_MISMATCH');

const runtimeFiles = (await readdir(ortDist))
  .filter(name => /^ort-wasm-[a-z0-9.-]+\.(mjs|wasm)$/.test(name))
  .sort();
for (const name of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  assert.ok(runtimeFiles.includes(name), 'WEEKLY_PADDLE_REQUIRED_ORT_ASSET_MISSING: ' + name);
}
assert.ok(runtimeFiles.length >= 2, 'WEEKLY_PADDLE_ORT_ASSETS_MISSING');
const runtimeContent = [];
for (const name of runtimeFiles) {
  const bytes = await readFile(path.join(ortDist, name));
  assert.ok(bytes.length > 0 && bytes.length <= FILE_LIMIT, 'CLOUDFLARE_ORT_FILE_LIMIT: ' + name);
  if (name.endsWith('.mjs')) {
    assert.ok(!bytes.toString('utf8').trimStart().startsWith('<'),
      'WEEKLY_PADDLE_ORT_JS_HTML_FALLBACK: ' + name);
  }
  runtimeContent.push({name, bytes});
}

// Regenerate only the weekly model and the ORT distribution. Tesseract under
// public/ocr is owned by prepare-ocr-assets and must never be removed here.
await rm(publicWeekly, {recursive: true, force: true});
await rm(publicOrt, {recursive: true, force: true});
await mkdir(publicWeekly, {recursive: true});
await mkdir(publicOrt, {recursive: true});
await copyFile(path.join(vendor, 'inference.onnx'), path.join(publicWeekly, 'inference.onnx'));
await copyFile(path.join(vendor, 'dict.json'), path.join(publicWeekly, 'dict.json'));

const assets = [
  {url: '/ocr/weekly/inference.onnx', sha256: MODEL_SHA, bytes: model.length},
  {url: '/ocr/weekly/dict.json', sha256: DICT_SHA, bytes: dictBytes.length},
];
for (const {name, bytes} of runtimeContent) {
  await copyFile(path.join(ortDist, name), path.join(publicOrt, name));
  assets.push({url: '/ort/' + name, sha256: sha256(bytes), bytes: bytes.length});
}
const manifest = {
  kind: 'COMEBACKHOME_OFFICIAL_KOREAN_PP_OCRV5_WEEKLY',
  version: 1,
  modelSha256: MODEL_SHA,
  onnxRuntimeWeb: '1.23.2',
  sameOrigin: true,
  assets,
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
assert.ok(manifestBytes.length <= FILE_LIMIT, 'CLOUDFLARE_MANIFEST_FILE_LIMIT');
await writeFile(path.join(publicWeekly, 'integrity.json'), manifestBytes);

// Fail during build, never at the user's runtime.
for (const asset of assets) {
  const bytes = await readFile(path.join(root, 'public', asset.url.slice(1)));
  assert.equal(bytes.length, asset.bytes, 'WEEKLY_PADDLE_STAGED_SIZE_MISMATCH: ' + asset.url);
  assert.equal(sha256(bytes), asset.sha256, 'WEEKLY_PADDLE_STAGED_HASH_MISMATCH: ' + asset.url);
}
assert.deepEqual(JSON.parse(await readFile(path.join(publicWeekly, 'integrity.json'), 'utf8')), manifest);
console.log('CBH_WEEKLY_CLEAN_PRODUCTION_ASSETS_PASS=' + JSON.stringify({
  modelSha256: MODEL_SHA, dictionarySha256: DICT_SHA, characters: alphabet.length,
  ortVersion: pkg.version, assetCount: assets.length,
  totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
  remoteDownloads: 0, privateImages: 0, productionD1Writes: 0,
}));
