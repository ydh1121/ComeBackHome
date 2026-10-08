import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tempRoot = await mkdtemp(join(tmpdir(), 'comebackhome-ocr-assets-'));
const output = join(tempRoot, 'runtime');

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

function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}

try {
  const prepared = await run(process.execPath, [
    resolve(root, 'scripts/prepare-ocr-assets.mjs'),
    '--output',
    output,
  ]);

  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));

  assert(manifest.schemaVersion === 1, 'OCR asset manifest schema mismatch');
  assert(manifest.runtimeId === 'tesseract-7.0.0-data-1.0.0', 'OCR runtime id mismatch');
  assert(manifest.packages?.['tesseract.js'] === '7.0.0', 'Tesseract.js manifest version mismatch');
  assert(manifest.packages?.['tesseract.js-core'] === '7.0.0', 'Tesseract core manifest version mismatch');
  assert(manifest.packages?.['@tesseract.js-data/kor'] === '1.0.0', 'Korean traineddata package mismatch');
  assert(manifest.packages?.['@tesseract.js-data/eng'] === '1.0.0', 'English traineddata package mismatch');

  for (const value of Object.values(manifest.publicPaths ?? {})) {
    assert(typeof value === 'string' && value.startsWith('/') && !value.startsWith('//'), 'OCR public path must be root-relative');
    assert(!/^https?:/i.test(value), 'OCR public path must not use external HTTP origin');
  }

  const required = [
    'worker/worker.min.js',
    'lang/kor.traineddata.gz',
    'lang/eng.traineddata.gz',
    'core/tesseract-core.wasm.js',
    'core/tesseract-core-simd.wasm.js',
    'core/tesseract-core-lstm.wasm.js',
    'core/tesseract-core-simd-lstm.wasm.js',
  ];

  const paths = new Set(manifest.files.map((file) => file.path));
  required.forEach((path) => assert(paths.has(path), 'OCR asset missing ' + path));

  const coreFiles = manifest.files.filter((file) => file.path.startsWith('core/'));
  assert(coreFiles.length >= 12, 'OCR core runtime set is incomplete');
  assert(
    manifest.files.some((file) => file.path.startsWith('licenses/')),
    'OCR staged assets must include license material',
  );

  let totalBytes = 0;
  for (const file of manifest.files) {
    const absolute = join(output, file.path);
    await access(absolute);
    const data = await readFile(absolute);
    const info = await stat(absolute);
    assert(info.size === file.bytes, 'OCR asset byte size mismatch: ' + file.path);
    assert(hash(data) === file.sha256, 'OCR asset SHA-256 mismatch: ' + file.path);
    totalBytes += file.bytes;
  }

  const source = await readFile(
    resolve(root, 'src/providers/import/TesseractScheduleImageTextExtractor.ts'),
    'utf8',
  );
  const runtimeConfig = await readFile(
    resolve(root, 'src/providers/import/ocrRuntimeConfig.ts'),
    'utf8',
  );
  const prepareSource = await readFile(
    resolve(root, 'scripts/prepare-ocr-assets.mjs'),
    'utf8',
  );
  const composition = await readFile(resolve(root, 'src/app/composition.ts'), 'utf8');
  const gitignore = await readFile(resolve(root, '.gitignore'), 'utf8');
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

  assert(!source.includes('cdn.jsdelivr'), 'OCR extractor source contains CDN fallback');
  assert(!source.includes('unpkg.com'), 'OCR extractor source contains unpkg fallback');
  assert(!/https?:\/\//i.test(prepareSource), 'OCR staging script must not contain remote HTTP download paths');
  assert(!/\bfetch\s*\(/.test(prepareSource), 'OCR staging script must not fetch runtime assets');
  assert(runtimeConfig.includes("OCR_RUNTIME_ID = 'tesseract-7.0.0-data-1.0.0'"), 'OCR runtime config id mismatch');
  assert(runtimeConfig.includes(manifest.publicPaths.workerPath), 'OCR runtime worker path differs from manifest');
  assert(runtimeConfig.includes(manifest.publicPaths.corePath), 'OCR runtime core path differs from manifest');
  assert(runtimeConfig.includes(manifest.publicPaths.langPath), 'OCR runtime lang path differs from manifest');
  assert(gitignore.split(/\r?\n/).includes('public/ocr/'), 'Generated OCR runtime tree must remain gitignored');
  assert(composition.includes('TesseractScheduleImageTextExtractor'), 'Production OCR extractor must be active in application composition');
  assert(composition.includes('StructureFirstScheduleImageRecognizer'), 'Production structure-first image schedule recognizer must be active');
  assert(composition.includes('BrowserScheduleTableStructureDetector'), 'Production pixel table structure detector must be active');
  assert(
    packageJson.scripts?.prebuild === 'npm run prepare:ocr-assets && node scripts/generate-build-revision.mjs',
    'Production build must stage same-origin OCR assets before Vite build',
  );
  assert(
    packageJson.scripts?.build === 'tsc -b && vite build',
    'Production build command must remain typecheck + Vite build',
  );

  const preparedSummary = JSON.parse(prepared.stdout);
  assert(preparedSummary.externalDownloads === 0, 'OCR asset staging reported an external download');

  console.log(JSON.stringify({
    result: 'PASS',
    runtimeId: manifest.runtimeId,
    verifiedFiles: manifest.files.length,
    verifiedBytes: totalBytes,
    sameOriginOnly: true,
    productionActivation: true,
    externalDownloads: 0,
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
