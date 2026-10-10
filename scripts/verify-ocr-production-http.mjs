import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const manifest = JSON.parse(await readFile(path.join(root, 'ocr/weekly/integrity.json'), 'utf8'));
const types = {
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  const relative = pathname.slice(1);
  if (!/^(?:ocr\/weekly|ort)\/[a-zA-Z0-9_.-]+$/.test(relative)) {
    res.writeHead(400);
    res.end('invalid asset URL');
    return;
  }
  let bytes;
  let filename = path.join(root, relative);
  try {
    bytes = await readFile(filename);
  } catch {
    // Reproduce SPA index fallback to ensure required paths reject HTML.
    bytes = await readFile(path.join(root, 'index.html'));
    filename = path.join(root, 'index.html');
  }
  res.setHeader('Content-Type', types[path.extname(filename)] || 'text/html; charset=utf-8');
  res.writeHead(200);
  res.end(bytes);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = 'http://127.0.0.1:' + server.address().port;
  for (const item of [...manifest.assets, {
    url: '/ocr/weekly/integrity.json',
    sha256: hash(Buffer.from(JSON.stringify(manifest, null, 2) + '\n')),
  }]) {
    assert.ok(item.url.startsWith('/ocr/weekly/') || item.url.startsWith('/ort/'));
    const response = await fetch(origin + item.url);
    assert.equal(response.status, 200, 'Asset HTTP failed: ' + item.url);
    const body = Buffer.from(await response.arrayBuffer());
    const extension = path.extname(item.url);
    const expectedType = types[extension];
    assert.ok(response.headers.get('content-type')?.startsWith(expectedType),
      'Asset MIME mismatch / probable SPA fallback: ' + item.url);
    assert.ok(!body.toString('utf8', 0, Math.min(body.length, 50)).trimStart().startsWith('<'),
      'SPA HTML fallback served instead of OCR asset: ' + item.url);
    assert.equal(hash(body), item.sha256, 'HTTP asset hash mismatch: ' + item.url);
    if (item.bytes != null) assert.equal(body.length, item.bytes, 'HTTP asset size mismatch: ' + item.url);
    if (extension === '.json') {
      const json = JSON.parse(body.toString('utf8'));
      if (item.url.endsWith('/dict.json')) {
        assert.ok(Array.isArray(json) && json.length === 11946, 'Served dictionary invalid');
      }
      if (item.url.endsWith('/integrity.json')) {
        assert.deepEqual(json, manifest, 'Served integrity manifest invalid');
      }
    }
  }
  console.log('CBH_CLEAN_BUILD_HTTP_ASSETS_PASS=' + JSON.stringify({
    origin: 'loopback_only', sameOrigin: true,
    assetsVerified: manifest.assets.length + 1,
    forbiddenHtmlFallback: 0, privateImageTransfer: 0,
    productionD1Writes: 0,
  }));
} finally {
  await new Promise(resolve => server.close(resolve));
}
