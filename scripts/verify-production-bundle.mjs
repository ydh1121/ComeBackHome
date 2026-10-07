import { readdir, readFile, stat } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const failures = [];

async function collect(dirUrl) {
  const out = [];
  for (const name of await readdir(dirUrl)) {
    const url = new URL(name + '/', dirUrl);
    let info;
    try { info = await stat(url); } catch { info = await stat(new URL(name, dirUrl)); }
    if (info.isDirectory()) out.push(...await collect(url));
    else out.push(new URL(name, dirUrl));
  }
  return out;
}

const files = await collect(dist);
const textFiles = files.filter((file) => /\.(js|css|html)$/.test(file.pathname));
const contents = await Promise.all(textFiles.map(async (file) => [file.pathname, await readFile(file, 'utf8')]));

for (const [path, source] of contents) {
  for (const forbidden of [
    'mock-person-1',
    'mock-import-1',
    'QaStateMatrixPage',
    'qa-desktop-drop',
    '/__qa/states',
    'comebackhome-private-ocr-eval/v2',
  ]) {
    if (source.includes(forbidden)) failures.push('production bundle contains DEV/fixture marker ' + forbidden + ' in ' + path);
  }
}
if (files.some((file) => /mockComposition/i.test(file.pathname))) {
  failures.push('production bundle emitted a mockComposition chunk');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ result: 'PASS', scannedFiles: textFiles.length, mockFixtureLeakage: 0, qaLeakage: 0 }, null, 2));
