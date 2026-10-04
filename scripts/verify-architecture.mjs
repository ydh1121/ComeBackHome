import { readdir, readFile, stat } from 'node:fs/promises';
import { relative } from 'node:path';

const root = new URL('..', import.meta.url);
const sourceRoot = new URL('../src/', import.meta.url);

async function collect(dirUrl) {
  const files = [];
  for (const name of await readdir(dirUrl)) {
    const child = new URL(`${name}${name.includes('.') ? '' : '/'}`, dirUrl);
    const info = await stat(child);
    if (info.isDirectory()) files.push(...(await collect(child)));
    else files.push(child);
  }
  return files;
}

const files = await collect(sourceRoot);
const texts = await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')]));
const failures = [];
const required = [
  'src/application/contracts/actions.ts',
  'src/application/contracts/providers.ts',
  'src/application/contracts/repositories.ts',
  'src/application/contracts/runtime.ts',
  'src/application/queries/ComeBackHomeQueries.ts',
  'src/application/selectors/index.ts',
  'src/application/services/ApplicationActions.ts',
  'src/application/use-cases/commitImportReview.ts',
  'src/application/route-manifest.ts',
  'src/app/composition.ts',
  'src/domain/models.ts',
  'src/mocks/providers.ts',
  'src/mocks/repositories.ts',
  'src/mocks/state.ts',
  'src/providers/ports.ts',
];
const sourceNames = new Set(files.map((file) => relative(root.pathname, file.pathname)));
for (const path of required) if (!sourceNames.has(path)) failures.push(`missing required boundary: ${path}`);

for (const [file, content] of texts) {
  const path = relative(root.pathname, file.pathname);
  if (content.includes('Store.get(')) failures.push(`direct Store read is forbidden: ${path}`);
  if (!path.includes('/mocks/') && content.includes("q.includes('샘플')")) failures.push(`demo search shortcut leaked: ${path}`);
  if (!path.includes('/mocks/') && content.includes('Date.now(')) failures.push(`Date.now id generation is forbidden outside mocks: ${path}`);
  if (path.startsWith('src/pages/') && /from ['\"].*(mocks|providers)\//.test(content)) failures.push(`page imports infrastructure directly: ${path}`);
  if (path.startsWith('src/pages/') && content.includes('contracts/repositories')) failures.push(`page imports repositories directly: ${path}`);
  if (path.startsWith('src/application/') && content.includes('/mocks/')) failures.push(`application layer imports mocks: ${path}`);
}

const providers = await readFile(new URL('../src/application/contracts/providers.ts', import.meta.url), 'utf8');
if (!providers.includes('arrivals(providerStationId: string')) failures.push('RealtimeSubwayProvider must use providerStationId');
if (providers.includes('arrivals(stationName: string')) failures.push('RealtimeSubwayProvider must not use stationName as canonical input');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`architecture verification passed (${files.length} src files)`);
