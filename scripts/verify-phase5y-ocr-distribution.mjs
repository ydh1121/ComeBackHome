import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const tempRoot = await mkdtemp(join(tmpdir(), 'comebackhome-ocr-distribution-'));
const tempPublic = join(tempRoot, 'public');
const tempDist = join(tempRoot, 'dist');
const runtimeId = 'tesseract-7.0.0-data-1.0.0';
const runtimeOutput = join(tempPublic, 'ocr', runtimeId);
const publicRuntimeBase = '/ocr/' + runtimeId + '/';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(command + ' failed with code ' + code + '\n' + stdout + stderr));
    });
  });
}

async function copyExistingPublic() {
  const sourcePublic = resolve(root, 'public');
  try {
    await access(sourcePublic);
    await cp(sourcePublic, tempPublic, { recursive: true });
  } catch {
    await mkdir(tempPublic, { recursive: true });
  }
}

async function closePreview(server) {
  await new Promise((resolvePromise, reject) => {
    server.httpServer.close((error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

let server = null;

try {
  await copyExistingPublic();

  const prepared = await run(process.execPath, [
    resolve(root, 'scripts/prepare-ocr-assets.mjs'),
    '--output',
    runtimeOutput,
  ]);
  const preparedSummary = JSON.parse(prepared.stdout);
  assert(preparedSummary.result === 'PASS', 'OCR staging did not report PASS');
  assert(preparedSummary.runtimeId === runtimeId, 'OCR staging runtime id mismatch');
  assert(preparedSummary.externalDownloads === 0, 'OCR staging reported external downloads');

  const stagedManifest = JSON.parse(
    await readFile(join(runtimeOutput, 'manifest.json'), 'utf8'),
  );
  assert(stagedManifest.runtimeId === runtimeId, 'Staged OCR manifest runtime id mismatch');

  await build({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    publicDir: tempPublic,
    build: {
      outDir: tempDist,
      emptyOutDir: true,
    },
    logLevel: 'error',
  });

  const distManifestPath = join(tempDist, 'ocr', runtimeId, 'manifest.json');
  const distManifest = JSON.parse(await readFile(distManifestPath, 'utf8'));
  assert(
    JSON.stringify(distManifest) === JSON.stringify(stagedManifest),
    'Built OCR manifest differs from staged manifest',
  );

  let distBytes = 0;
  for (const file of stagedManifest.files) {
    const distFile = join(tempDist, 'ocr', runtimeId, file.path);
    const data = await readFile(distFile);
    assert(data.byteLength === file.bytes, 'Built OCR byte size mismatch: ' + file.path);
    assert(sha256(data) === file.sha256, 'Built OCR SHA-256 mismatch: ' + file.path);
    distBytes += data.byteLength;
  }

  server = await preview({
    root,
    configFile: false,
    build: {
      outDir: tempDist,
    },
    preview: {
      host: '127.0.0.1',
      port: 4187,
      strictPort: true,
    },
    logLevel: 'error',
  });

  const origin = 'http://127.0.0.1:4187';
  const manifestResponse = await fetch(origin + publicRuntimeBase + 'manifest.json', {
    redirect: 'error',
  });
  assert(manifestResponse.ok, 'Same-origin OCR manifest HTTP request failed');
  assert(
    new URL(manifestResponse.url).origin === origin,
    'OCR manifest escaped the local same origin',
  );
  const servedManifest = await manifestResponse.json();
  assert(
    JSON.stringify(servedManifest) === JSON.stringify(stagedManifest),
    'Served OCR manifest differs from staged manifest',
  );

  let servedBytes = 0;
  let transparentlyDecodedGzipFiles = 0;
  for (const file of stagedManifest.files) {
    const response = await fetch(origin + publicRuntimeBase + file.path, {
      redirect: 'error',
    });
    assert(response.ok, 'Same-origin OCR asset request failed: ' + file.path);
    assert(
      new URL(response.url).origin === origin,
      'OCR asset escaped the local same origin: ' + file.path,
    );

    const data = Buffer.from(await response.arrayBuffer());
    const distFile = join(tempDist, 'ocr', runtimeId, file.path);
    const expectedCompressed = await readFile(distFile);

    if (data.byteLength === file.bytes && sha256(data) === file.sha256) {
      servedBytes += data.byteLength;
      continue;
    }

    if (file.path.endsWith('.traineddata.gz')) {
      const encoding = String(response.headers.get('content-encoding') ?? '').toLowerCase();
      const expectedRaw = gunzipSync(expectedCompressed);
      assert(
        encoding.includes('gzip'),
        'Traineddata body changed without gzip content-encoding: ' + file.path,
      );
      assert(
        data.byteLength === expectedRaw.byteLength,
        'Transparently decoded traineddata byte size mismatch: ' + file.path,
      );
      assert(
        sha256(data) === sha256(expectedRaw),
        'Transparently decoded traineddata SHA-256 mismatch: ' + file.path,
      );
      transparentlyDecodedGzipFiles += 1;
      servedBytes += data.byteLength;
      continue;
    }

    throw new Error('Served OCR byte/hash mismatch: ' + file.path);
  }

  const source = await readFile(
    resolve(root, 'src/app/composition.ts'),
    'utf8',
  );
  const packageJson = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  );

  assert(
    source.includes('TesseractScheduleImageTextExtractor'),
    'Production composition must include the local OCR extractor',
  );
  assert(
    source.includes('new Weekly3ColumnScheduleImageRecognizer') &&
      source.includes('new PaddleWeeklyRegionalTextExtractor') &&
      !source.includes('new StructureFirstScheduleImageRecognizer'),
    'Production composition must select weekly Paddle recognition, preserving Tesseract only for header OCR',
  );
  assert(
    source.includes('BrowserScheduleTableStructureDetector'),
    'Production composition must include the pixel table structure detector',
  );
  assert(
    packageJson.scripts?.prebuild === 'npm run prepare:ocr-assets && node scripts/generate-build-revision.mjs',
    'Production build must stage OCR assets',
  );
  assert(
    packageJson.scripts?.build === 'tsc -b && vite build',
    'Production build command must remain typecheck + Vite build',
  );

  console.log(JSON.stringify({
    result: 'PASS',
    runtimeId,
    servedOrigin: origin,
    verifiedFiles: stagedManifest.files.length,
    builtBytes: distBytes,
    servedBytes,
    transparentlyDecodedGzipFiles,
    sameOriginOnly: true,
    productionActivation: true,
    externalImageUpload: 0,
    externalOcrApi: 0,
  }, null, 2));
} finally {
  if (server) {
    await closePreview(server);
  }
  await rm(tempRoot, { recursive: true, force: true });
}
