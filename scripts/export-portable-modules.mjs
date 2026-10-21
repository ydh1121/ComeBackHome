import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../packages/portable/', import.meta.url));
const catalog = ['core', 'http', 'browser', 'react', 'calendar', 'd1', 'ocr', 'web-push'];
export async function exportPortable(destination, selected = catalog) {
  const target = resolve(destination);
  const rel = relative(source, target);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Export destination cannot be inside the source package.');
  if (!selected.length || selected.some(name => !catalog.includes(name))) throw new Error('Unknown module. Choose: ' + catalog.join(', '));
  // Refuse overwriting an existing directory. No data loss and no package-manager side effects.
  await mkdir(target);
  for (const name of new Set(selected)) await cp(resolve(source, name), resolve(target, name), { recursive: true, errorOnExist: true, force: false });
  for (const file of ['README.md', 'NOTICE.md', 'tsconfig.json']) await cp(resolve(source, file), resolve(target, file));
  if (!selected.includes('react')) {
    const config = JSON.parse(await readFile(resolve(target, 'tsconfig.json'), 'utf8'));
    config.compilerOptions.types = [];
    await writeFile(resolve(target, 'tsconfig.json'), JSON.stringify(config, null, 2) + '\n');
  }
  const pkg = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'));
  pkg.exports = Object.fromEntries(Object.entries(pkg.exports).filter(([key]) => selected.includes(key.split('/')[1])));
  const peers = new Set(selected.flatMap(name => ({ react: ['react', 'react-dom'], calendar: ['korean-lunar-calendar'], ocr: ['tesseract.js', 'onnxruntime-web'], 'web-push': ['@block65/webcrypto-web-push'] }[name] ?? [])));
  pkg.peerDependencies = Object.fromEntries(Object.entries(pkg.peerDependencies).filter(([key]) => peers.has(key)));
  pkg.peerDependenciesMeta = Object.fromEntries(Object.keys(pkg.peerDependencies).map(key => [key, { optional: true }]));
  await writeFile(resolve(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  return target;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const destination = args[args.indexOf('--to') + 1];
  if (!args.includes('--to') || !destination || destination.startsWith('--')) throw new Error('Usage: npm run export:portable -- --to <new-directory> [--modules core,http,browser]');
  const selected = args.includes('--modules') ? args[args.indexOf('--modules') + 1]?.split(',') : undefined;
  console.log('Exported reusable source to ' + await exportPortable(destination, selected));
}
