import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const list = await read('../src/pages/PeoplePage.tsx');
const create = await read('../src/pages/PersonCreatePage.tsx');
const edit = await read('../src/pages/PersonEditPage.tsx');
const detail = await read('../src/pages/PersonDetailPage.tsx');
const hooks = await read('../src/features/people/usePeople.ts');
const actions = await read('../src/application/services/ApplicationActions.ts');
const runtime = await read('../src/application/contracts/runtime.ts');
const query = await read('../src/application/queries/ComeBackHomeQueries.ts');
const router = await read('../src/app/router.tsx');
const css = await read('../src/pages/people-page.css');

for (const text of ['사람','사람 추가','navigate(\'/people/\'']) if (!list.includes(text)) failures.push('list missing ' + text);
for (const text of ['사람 추가','이름 입력','예: 연인, 가족','actions.people.create']) if (!create.includes(text)) failures.push('create missing ' + text);
for (const text of ['사람 수정','actions.people.update','navigate(\'/people/\'']) if (!edit.includes(text)) failures.push('edit missing ' + text);
for (const text of ['이동 경로','주로 오는 길','출발지 교통 수정','도착지 교통 수정','경로 설정']) if (!detail.includes(text)) failures.push('detail missing ' + text);
for (const path of ['/people','/people/new','/people/:personId/edit','/people/:personId']) if (!router.includes("'" + path + "'")) failures.push('route missing ' + path);

if (!actions.includes('class PersonService')) failures.push('PersonService missing');
if (!actions.includes('this.selection.select(person.id)')) failures.push('create must select new person');
if (!runtime.includes('people: PersonActions')) failures.push('PersonActions runtime missing');
if (!query.includes('getPerson(personId')) failures.push('getPerson query missing');
if (!query.includes('getPersonDetail(personId')) failures.push('getPersonDetail query missing');
if (!hooks.includes('usePeopleList') || !hooks.includes('usePersonDetail')) failures.push('people hooks missing');
if (!css.includes('.people-page .person-row')) failures.push('people list style missing');
if (!css.includes('.people-page .location-group')) failures.push('person detail style missing');

for (const [name, source] of [['list',list],['create',create],['edit',edit],['detail',detail]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}

if (detail.includes('delete') || detail.includes('삭제')) failures.push('unapproved delete scope added');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 4D people workflow verification passed');
