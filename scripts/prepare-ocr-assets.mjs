import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultOutput = resolve(root, 'public/ocr/tesseract-7.0.0-data-1.0.0');
const outputArgIndex = process.argv.indexOf('--output');
const output = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
  ? resolve(process.cwd(), process.argv[outputArgIndex + 1])
  : defaultOutput;

const EXPECTED_PACKAGES = {
  'tesseract.js': '7.0.0',
  'tesseract.js-core': '7.0.0',
  '@tesseract.js-data/kor': '1.0.0',
  '@tesseract.js-data/eng': '1.0.0',
};

const files = [];

async function packageRoot(name) {
  return resolve(root, 'node_modules', ...name.split('/'));
}

async function readPackage(name) {
  const pkgRoot = await packageRoot(name);
  const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'));
  const expected = EXPECTED_PACKAGES[name];
  if (pkg.version !== expected) {
    throw new Error(name + ' version mismatch: expected ' + expected + ', got ' + pkg.version);
  }
  return { root: pkgRoot, pkg };
}

async function sha256(path) {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

async function copyTracked(source, destinationRelative, sourcePackage) {
  const destination = join(output, destinationRelative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const info = await stat(destination);
  files.push({
    path: destinationRelative.replaceAll('\\', '/'),
    bytes: info.size,
    sha256: await sha256(destination),
    sourcePackage,
  });
}

async function copyLicenseIfPresent(pkgName, pkgRoot) {
  const entries = await readdir(pkgRoot);
  const license = entries.find((name) => /^licen[sc]e(?:\.|$)/i.test(name));
  if (!license) return;
  await copyTracked(
    join(pkgRoot, license),
    'licenses/' + pkgName.replaceAll('@', '').replaceAll('/', '__') + '-' + license,
    pkgName,
  );
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const installed = {};
for (const name of Object.keys(EXPECTED_PACKAGES)) {
  const loaded = await readPackage(name);
  installed[name] = loaded;
  await copyLicenseIfPresent(name, loaded.root);
}

await copyTracked(
  join(installed['tesseract.js'].root, 'dist', 'worker.min.js'),
  'worker/worker.min.js',
  'tesseract.js',
);

const coreEntries = (await readdir(installed['tesseract.js-core'].root))
  .filter((name) => /^tesseract-core.*\.(?:js|wasm)$/.test(name))
  .sort();

if (coreEntries.length < 12) {
  throw new Error('Unexpected tesseract.js-core runtime file set: ' + coreEntries.join(', '));
}

for (const name of coreEntries) {
  await copyTracked(
    join(installed['tesseract.js-core'].root, name),
    'core/' + name,
    'tesseract.js-core',
  );
}

for (const language of ['kor', 'eng']) {
  const pkgName = '@tesseract.js-data/' + language;
  const source = join(
    installed[pkgName].root,
    '4.0.0_best_int',
    language + '.traineddata.gz',
  );
  await copyTracked(
    source,
    'lang/' + language + '.traineddata.gz',
    pkgName,
  );
}

files.sort((left, right) => left.path.localeCompare(right.path));

const manifest = {
  schemaVersion: 1,
  runtimeId: 'tesseract-7.0.0-data-1.0.0',
  packages: Object.fromEntries(
    Object.entries(EXPECTED_PACKAGES).map(([name, version]) => [name, version]),
  ),
  publicPaths: {
    workerPath: '/ocr/tesseract-7.0.0-data-1.0.0/worker/worker.min.js',
    corePath: '/ocr/tesseract-7.0.0-data-1.0.0/core/',
    langPath: '/ocr/tesseract-7.0.0-data-1.0.0/lang/',
  },
  files,
};

await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
  'utf8',
);

console.log(JSON.stringify({
  result: 'PASS',
  output,
  runtimeId: manifest.runtimeId,
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  externalDownloads: 0,
}, null, 2));
