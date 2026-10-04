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
  'src/application/services/ImportWorkflowService.ts',
  'src/application/services/CommuteWorkflowService.ts',
  'src/application/use-cases/commitImportReview.ts',
  'src/application/route-manifest.ts',
  'src/app/ApplicationServicesContext.tsx',
  'src/app/composition.ts',
  'src/app/useRouteScrollRestoration.ts',
  'src/domain/models.ts',
  'src/mocks/commute-providers.ts',
  'src/mocks/import-actions.ts',
  'src/mocks/providers.ts',
  'src/mocks/repositories.ts',
  'src/mocks/state.ts',
  'src/pages/ImportPage.tsx',
  'src/pages/ImportPersonMatchPage.tsx',
  'src/pages/ImportStructurePage.tsx',
  'src/pages/ImportReviewPage.tsx',
  'src/features/commute/useCommuteWorkflow.ts',
  'src/features/people/usePeople.ts',
  'src/pages/PeoplePage.tsx',
  'src/pages/PersonCreatePage.tsx',
  'src/pages/PersonEditPage.tsx',
  'src/pages/PersonDetailPage.tsx',
  'src/pages/PlaceEditPage.tsx',
  'src/pages/CommuteRoutePage.tsx',
  'src/pages/CommuteManualPage.tsx',
  'src/pages/TransitAccessPage.tsx',
  'src/pages/TransitSearchPage.tsx',
  'src/pages/BusRoutePage.tsx',
  'src/pages/TodayPage.tsx',
  'src/providers/ports.ts',
  'src/shared/components/BackButton.tsx',
  'src/shared/components/Icon.tsx',
  'src/shared/components/SubpageHeader.tsx',
  'src/shared/layout/AppShell.tsx',
  'src/shared/layout/BottomNavigation.tsx',
  'src/shared/layout/TopUtility.tsx',
];
const sourceNames = new Set(files.map((file) => relative(root.pathname, file.pathname)));
for (const path of required) if (!sourceNames.has(path)) failures.push(`missing required boundary: ${path}`);

for (const [file, content] of texts) {
  const path = relative(root.pathname, file.pathname);
  if (content.includes('Store.get(')) failures.push(`direct Store read is forbidden: ${path}`);
  if (!path.includes('/mocks/') && content.includes("q.includes('샘플')")) failures.push(`demo search shortcut leaked: ${path}`);
  if (!path.includes('/mocks/') && content.includes('Date.now(')) failures.push(`Date.now id generation is forbidden outside mocks: ${path}`);
  if (path.startsWith('src/pages/') && (content.includes('/mocks/') || content.includes('/providers/'))) failures.push(`page imports infrastructure directly: ${path}`);
  if (path.startsWith('src/pages/') && content.includes('contracts/repositories')) failures.push(`page imports repositories directly: ${path}`);
  if (path.startsWith('src/application/') && content.includes('/mocks/')) failures.push(`application layer imports mocks: ${path}`);
  if (path.startsWith('src/shared/') && (content.includes('/mocks/') || content.includes('/providers/'))) failures.push(`shared UI imports infrastructure directly: ${path}`);
  if (path.startsWith('src/shared/') && content.includes('contracts/repositories')) failures.push(`shared UI imports repositories directly: ${path}`);
  if (path.startsWith('src/app/') && path !== 'src/app/composition.ts' && content.includes('/mocks/')) failures.push(`only composition may import mocks: ${path}`);
}

const providers = await readFile(new URL('../src/application/contracts/providers.ts', import.meta.url), 'utf8');
if (!providers.includes('arrivals(providerStationId: string')) failures.push('RealtimeSubwayProvider must use providerStationId');
if (providers.includes('arrivals(stationName: string')) failures.push('RealtimeSubwayProvider must not use stationName as canonical input');

const repositories = await readFile(new URL('../src/application/contracts/repositories.ts', import.meta.url), 'utf8');
if (!repositories.includes('export interface TodayRepository')) failures.push('TodayRepository application port missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`architecture verification passed (${files.length} src files)`);
