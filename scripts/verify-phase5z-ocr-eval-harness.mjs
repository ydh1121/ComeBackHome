import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const evalRoot = resolve(root, 'tools/ocr-eval');
const tempRoot = await mkdtemp(join(tmpdir(), 'comebackhome-ocr-eval-verify-'));
const tempPublic = join(tempRoot, 'public');
const tempDist = join(tempRoot, 'dist');
const runtimeId = 'tesseract-7.0.0-data-1.0.0';
const runtimeOutput = join(tempPublic, 'ocr', runtimeId);

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

try {
  const indexSource = await readFile(resolve(evalRoot, 'index.html'), 'utf8');
  const mainSource = await readFile(resolve(evalRoot, 'main.ts'), 'utf8');
  const launcherSource = await readFile(resolve(root, 'scripts/run-ocr-eval.mjs'), 'utf8');
  const composition = await readFile(resolve(root, 'src/app/composition.ts'), 'utf8');
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

  for (const forbidden of [
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'XMLHttpRequest',
    'FormData',
    'sendBeacon',
    'fetch(',
    'http://',
    'https://',
  ]) {
    assert(!mainSource.includes(forbidden), 'OCR evaluation page contains forbidden image persistence/upload primitive: ' + forbidden);
  }

  assert(
    indexSource.includes('multiple'),
    'OCR evaluation file input must allow multi-image batch selection',
  );
  assert(
    indexSource.includes('전체 QA 결과 복사'),
    'OCR evaluation page must expose one-click complete QA copy',
  );
  assert(
    indexSource.includes('결과 JSON 저장'),
    'OCR evaluation page must expose one-file QA export',
  );
  assert(
    mainSource.includes('comebackhome-private-ocr-eval/v2'),
    'OCR evaluation page must emit the batch QA bundle schema',
  );
  assert(
    mainSource.includes('navigator.clipboard.writeText'),
    'OCR evaluation page must support one-click complete QA copy',
  );
  assert(
    mainSource.includes("derivedEvidenceExport: 'user-triggered-only'"),
    'OCR evaluation bundle must mark derived-evidence export as user-triggered',
  );
  assert(
    mainSource.includes('sourceImagePersistence: 0'),
    'Batch QA export must keep source image persistence at zero',
  );

  assert(
    mainSource.includes('TesseractScheduleImageTextExtractor'),
    'OCR evaluation page must use the project Tesseract extractor',
  );
  assert(
    mainSource.includes('parseScheduleImageLayout'),
    'OCR evaluation page must use the adaptive schedule parser',
  );
  assert(
    mainSource.includes('externalImageUpload: 0'),
    'OCR evaluation page must expose external-image-upload boundary',
  );
  assert(
    mainSource.includes('imagePersistence: 0'),
    'OCR evaluation page must expose source-image persistence boundary',
  );

  assert(
    launcherSource.includes("host: '127.0.0.1'"),
    'OCR evaluation server must bind to loopback',
  );
  assert(
    !launcherSource.includes("host: '0.0.0.0'"),
    'OCR evaluation server must not bind publicly',
  );
  assert(
    launcherSource.includes('prepare-ocr-assets.mjs'),
    'OCR evaluation launcher must stage same-origin runtime assets',
  );
  assert(
    composition.includes('TesseractScheduleImageTextExtractor'),
    'Production app composition must activate the local OCR extractor',
  );
  assert(
    composition.includes('AdaptiveScheduleImageRecognizer'),
    'Production app composition must connect OCR to the schedule recognizer',
  );
  assert(
    !composition.includes('tools/ocr-eval'),
    'Private OCR evaluation harness must not be imported by app composition',
  );
  assert(
    packageJson.scripts?.build === 'tsc -b && vite build',
    'Private OCR evaluation harness must not change production build',
  );

  await copyExistingPublic();
  const prepared = await run(process.execPath, [
    resolve(root, 'scripts/prepare-ocr-assets.mjs'),
    '--output',
    runtimeOutput,
  ]);
  const preparedSummary = JSON.parse(prepared.stdout);
  assert(preparedSummary.result === 'PASS', 'OCR eval runtime staging did not report PASS');
  assert(preparedSummary.externalDownloads === 0, 'OCR eval runtime staging reported external downloads');

  await build({
    root: evalRoot,
    configFile: false,
    publicDir: tempPublic,
    build: {
      outDir: tempDist,
      emptyOutDir: true,
    },
    logLevel: 'error',
  });

  await access(join(tempDist, 'index.html'));
  await access(join(tempDist, 'ocr', runtimeId, 'manifest.json'));
  await access(join(tempDist, 'ocr', runtimeId, 'worker', 'worker.min.js'));
  await access(join(tempDist, 'ocr', runtimeId, 'lang', 'kor.traineddata.gz'));
  await access(join(tempDist, 'ocr', runtimeId, 'lang', 'eng.traineddata.gz'));

  const builtIndex = await readFile(join(tempDist, 'index.html'), 'utf8');
  assert(
    /assets\/.*\.js/.test(builtIndex),
    'Private OCR evaluation harness did not produce a Vite JS bundle',
  );

  console.log(JSON.stringify({
    result: 'PASS',
    runtimeId,
    localOnlyHost: '127.0.0.1',
    sourceImagePersistence: 0,
    externalImageUpload: 0,
    externalOcrApi: 0,
    productionRoute: false,
    productionActivation: false,
    harnessBuild: true,
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
