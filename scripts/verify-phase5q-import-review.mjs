import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const reviewSource = await read('../src/pages/ImportReviewPage.tsx');
const matchSource = await read('../src/pages/ImportPersonMatchPage.tsx');
const commitSource = await read('../src/application/use-cases/commitImportReview.ts');

for (const text of [
  'visibleReviewItems.map',
  'const allReviewed',
  "item.resolution === 'SKIP'",
  "item.resolution === 'NEW' && importedTimeComplete(item)",
  'exactDuplicate',
  "item.resolution === 'NEW' ? 'SKIP' : 'NEW'",
  "disabled={!allReviewed || saveState === 'saving'}",
  "disabled={!item.personId || !importedComplete}",
  'services.actions.importReview.setImportedTime',
  'TimeRangeWheelPicker',
]) {
  expect(reviewSource.includes(text), 'multi-item review UI missing ' + text);
}
expect(!reviewSource.includes('batch.reviewItems[0]'), 'review UI must not collapse real import to first item');
expect(!reviewSource.includes('type="time"'), 'import review must not use native time inputs on iPhone');
expect(matchSource.includes('const allResolved'), 'person match completion gate missing');
expect(matchSource.includes('<option value="">연결 안 됨</option>'), 'unmatched person label must be explicit');
expect(matchSource.includes('새 사람으로 등록'), 'detected person create option missing');
expect(matchSource.includes('가져오지 않음'), 'detected person ignore option missing');
expect(matchSource.includes('disabled={!allResolved || includedCount === 0}'), 'person match next CTA must block unresolved/empty imports');
expect(commitSource.includes("Import contains unresolved people."), 'unresolved person commit guard missing');
expect(commitSource.includes("Import contains unreviewed schedules."), 'unreviewed schedule commit guard missing');
expect(commitSource.includes("Import contains incomplete schedule times."), 'incomplete imported time commit guard missing');

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const commitModule = await vite.ssrLoadModule('/src/application/use-cases/commitImportReview.ts');
  const selectionModule = await vite.ssrLoadModule('/src/application/services/WorkbookImportFileSelectionAction.ts');
  const reposModule = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

  const selectionStore = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  selectionStore.mutate((state) => {
    state.importBatches = [];
  });
  const selectionImports = new reposModule.MockImportRepository(selectionStore);
  const selectionPeople = new reposModule.MockPersonRepository(selectionStore);
  const selectionSchedules = new reposModule.MockScheduleRepository(selectionStore);
  const selection = new selectionModule.WorkbookImportFileSelectionAction(
    selectionImports,
    selectionPeople,
    selectionSchedules,
    {
      async parse() {
        return {
          detectedPeople: [{ sourceName: '여자친구', confidence: 0.92 }],
          scheduleCandidates: [],
          reviewCandidates: [{
            sourcePersonName: '여자친구',
            date: '2099-01-31',
            start: '09:00',
            end: null,
            sourceRow: 2,
            confidence: 0.91,
          }],
          structure: {
            sheet: '근무표',
            headerRow: 1,
            personColumn: 'A',
            dateColumn: 'B',
            shiftColumn: 'C:D',
            needsReview: true,
          },
          confidence: 0.91,
        };
      },
    },
  );
  const selectionBatchId = await selection.accept([{
    kind: 'WORKBOOK',
    file: {
      name: 'incomplete-review.xlsx',
      async arrayBuffer() { return new ArrayBuffer(0); },
    },
  }]);
  const selectionBatch = await selectionImports.getBatch(selectionBatchId);
  expect(
    selectionBatch?.reviewItems.length === 1 &&
      selectionBatch.reviewItems[0]?.imported.start === '09:00' &&
      selectionBatch.reviewItems[0]?.imported.end == null &&
      selectionBatch.reviewItems[0]?.resolution === 'NEW',
    'one-sided parser review candidate must survive and default selected',
  );

  const store = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  store.mutate((state) => {
    state.schedules = state.schedules.filter((entry) => !['2099-02-01', '2099-02-02'].includes(entry.date));
    state.importBatches = [{
      id: 'phase5q-batch',
      files: [{
        id: 'phase5q-file',
        name: 'phase5q.xlsx',
        kind: 'XLSX',
        progress: 100,
        status: 'READY',
      }],
      detectedPeople: [{
        id: 'phase5q-person',
        sourceName: '여자친구',
        matchedPersonId: 'mock-person-1',
        confidence: 1,
      }],
      structure: {
        sheet: '근무표',
        headerRow: 1,
        personColumn: 'A',
        dateColumn: 'B',
        shiftColumn: 'C:D',
        needsReview: false,
      },
      reviewItems: [
        {
          id: 'phase5q-review-1',
          detectedPersonId: 'phase5q-person',
          personId: 'mock-person-1',
          date: '2099-02-01',
          imported: { start: '09:00', end: '18:00' },
          resolution: null,
        },
        {
          id: 'phase5q-review-2',
          detectedPersonId: 'phase5q-person',
          personId: 'mock-person-1',
          date: '2099-02-02',
          imported: { start: '10:00', end: null },
          resolution: null,
        },
      ],
      committed: false,
    }];
  });

  const imports = new reposModule.MockImportRepository(store);
  const schedules = new reposModule.MockScheduleRepository(store);
  const commit = new commitModule.CommitImportReview(imports, schedules);

  let zeroReviewedBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    zeroReviewedBlocked = error instanceof Error &&
      error.message === 'Import contains unreviewed schedules.';
  }
  expect(zeroReviewedBlocked, 'zero-reviewed batch must be blocked');

  await imports.setResolution('phase5q-batch', 'phase5q-review-1', 'SKIP');
  let partialReviewedBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    partialReviewedBlocked = error instanceof Error &&
      error.message === 'Import contains unreviewed schedules.';
  }
  expect(partialReviewedBlocked, 'partially reviewed batch must remain blocked');
  expect(await schedules.getByDate('mock-person-1', '2099-02-01') === null, 'SKIP review must not mutate first schedule');

  await imports.setResolution('phase5q-batch', 'phase5q-review-2', 'NEW');

  let incompleteBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    incompleteBlocked = error instanceof Error &&
      error.message === 'Import contains incomplete schedule times.';
  }
  expect(incompleteBlocked, 'incomplete NEW schedule must remain blocked');

  await imports.setImportedTime('phase5q-batch', 'phase5q-review-2', 'end', '19:00');
  await commit.execute('phase5q-batch');

  const first = await schedules.getByDate('mock-person-1', '2099-02-01');
  const second = await schedules.getByDate('mock-person-1', '2099-02-02');
  expect(first === null, 'SKIP schedule must remain uncommitted');
  expect(second?.start === '10:00' && second?.end === '19:00', 'fully reviewed second schedule commit mismatch');
  expect((await imports.getBatch('phase5q-batch'))?.committed === true, 'fully reviewed batch not marked committed');

  store.mutate((state) => {
    const batch = state.importBatches[0];
    batch.committed = false;
    batch.reviewItems[0].personId = null;
  });
  let unresolvedBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    unresolvedBlocked = error instanceof Error &&
      error.message === 'Import contains unresolved people.';
  }
  expect(unresolvedBlocked, 'unresolved person must block even a resolved schedule choice');

  // Weekly OCR imports require deliberate per-cell approval, unlike the
  // preexisting XLSX import behavior tested above. No private image or D1.
  const weeklyStore = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  weeklyStore.mutate((state) => {
    state.importBatches = [];
    state.schedules = state.schedules.filter((entry) =>
      !['2099-04-05', '2099-04-06'].includes(entry.date)
    );
    // Already-existing exact WORK must also be reviewed in this OCR format.
    state.schedules.push({
      id:'weekly-existing-identical',personId:'mock-person-1',
      date:'2099-04-05',enabled:true,start:'09:30',end:'23:30',
    });
  });
  const weeklyImports = new reposModule.MockImportRepository(weeklyStore);
  const weeklyPeople = new reposModule.MockPersonRepository(weeklyStore);
  const weeklySchedules = new reposModule.MockScheduleRepository(weeklyStore);
  const weeklySelection = new selectionModule.WorkbookImportFileSelectionAction(
    weeklyImports, weeklyPeople, weeklySchedules,
    { async parse() { throw Error('Workbook must not be used for weekly image'); } },
    { async parse() {
      return {
        detectedPeople: [{ sourceName: '여자친구', confidence: 0.99 }],
        scheduleCandidates: [{
          sourcePersonName: '여자친구', date: '2099-04-05',
          start: '09:30', end: '23:30', sourceRow: 1, confidence: .95,
        }],
        reviewCandidates: [
          {
            sourcePersonName: '여자친구', date: '2099-04-06',
            start: null, end: null, sourceRow: 1, confidence: .1,
            recognitionState: 'OFF_CANDIDATE', enabled: true,
          },
          {
            // Negative control: a blank-looking work shift can be recovered
            // manually. OCR may never turn either candidate into OFF.
            sourcePersonName: '여자친구', date: '2099-04-07',
            start: null, end: null, sourceRow: 1, confidence: .1,
            recognitionState: 'OFF_CANDIDATE', enabled: true,
          },
        ],
        structure: {
          sheet: 'weekly 7 day x start/end/break physical matrix',
          headerRow: 0, personColumn: 'pixel label',
          dateColumn: 'observed OCR', shiftColumn: 'start/end/break',
          needsReview: true,
        },
        confidence: .90,
      };
    } },
  );
  const weeklyId = await weeklySelection.accept([{
    kind: 'IMAGE', file: { name: 'generated-weekly-fixture.png' },
  }]);
  const weeklyBatch = await weeklyImports.getBatch(weeklyId);
  expect(weeklyBatch?.reviewItems.length === 3,
    'weekly fixture must keep WORK, genuine OFF candidate, and false OFF candidate');
  expect(weeklyBatch?.reviewItems.every((item) => item.resolution === null),
    'weekly matched person must not auto-approve WORK or blank');
  const weeklyBlank = weeklyBatch?.reviewItems.find((item) => item.date === '2099-04-06');
  const weeklyWork = weeklyBatch?.reviewItems.find((item) => item.date === '2099-04-05');
  const weeklyFalseOff = weeklyBatch?.reviewItems.find((item) => item.date === '2099-04-07');
  expect(weeklyFalseOff?.recognitionState === 'OFF_CANDIDATE' &&
    weeklyFalseOff.imported.enabled === true,
    'uncertain blank-looking WORK cannot be automatically saved as OFF');
  expect(weeklyBlank?.imported.enabled === true &&
    weeklyBlank.recognitionState === 'OFF_CANDIDATE',
    'blank must stay a review-only OFF_CANDIDATE, never auto-confirmed OFF');
  if (weeklyBlank && weeklyWork && weeklyFalseOff) {
    const weeklyCommit = new commitModule.CommitImportReview(weeklyImports, weeklySchedules);
    await weeklyImports.setDetectedPersonMatch(weeklyId, weeklyBlank.detectedPersonId, 'mock-person-1');
    const afterMatch = await weeklyImports.getBatch(weeklyId);
    expect(afterMatch?.reviewItems.every((item) => item.resolution === null),
      'person match must not implicitly approve weekly rows');

    let blocked = false;
    try { await weeklyCommit.execute(weeklyId); }
    catch (error) { blocked = String(error).includes('unreviewed'); }
    expect(blocked, 'unreviewed weekly import must not commit');
    expect(await weeklySchedules.getByDate('mock-person-1', '2099-04-06') === null,
      'unreviewed blank must not mutate schedules');

    await weeklyImports.setImportedEnabled(weeklyId, weeklyBlank.id, false);
    const beforeApproval = await weeklyImports.getBatch(weeklyId);
    expect(beforeApproval?.reviewItems.find((item) => item.id === weeklyBlank.id)?.resolution === null,
      'explicit OFF toggle must reopen approval');
    await weeklyImports.setResolution(weeklyId, weeklyBlank.id, 'NEW');
    await weeklyImports.setResolution(weeklyId, weeklyWork.id, 'NEW');
    await weeklyImports.setImportedTime(weeklyId, weeklyFalseOff.id, 'start', '09:30');
    await weeklyImports.setImportedTime(weeklyId, weeklyFalseOff.id, 'end', '23:30');
    await weeklyImports.setResolution(weeklyId, weeklyFalseOff.id, 'NEW');
    // Editing an already-approved weekly OCR time MUST reopen review.
    await weeklyImports.setImportedTime(weeklyId, weeklyFalseOff.id, 'start', '10:30');
    const changed = await weeklyImports.getBatch(weeklyId);
    expect(changed?.reviewItems.find((item) => item.id === weeklyFalseOff.id)?.resolution === null,
      'weekly OCR time change must invalidate stale approval');
    let editBlocked = false;
    try { await weeklyCommit.execute(weeklyId); }
    catch (error) { editBlocked = String(error).includes('unreviewed'); }
    expect(editBlocked, 'unapproved corrected weekly WORK must not save');
    await weeklyImports.setImportedTime(weeklyId, weeklyFalseOff.id, 'start', '09:30');
    await weeklyImports.setResolution(weeklyId, weeklyFalseOff.id, 'NEW');
    await weeklyCommit.execute(weeklyId);
    const off = await weeklySchedules.getByDate('mock-person-1', '2099-04-06');
    const work = await weeklySchedules.getByDate('mock-person-1', '2099-04-05');
    const correctedWork = await weeklySchedules.getByDate('mock-person-1', '2099-04-07');
    expect(off?.enabled === false,
      'OFF can be saved only after user explicitly toggles and approves');
    expect(correctedWork?.enabled === true && correctedWork.start === '09:30' &&
      correctedWork.end === '23:30',
      'false OFF candidate must save as corrected WORK, never as OFF');
    expect(work?.enabled !== false && work?.start === '09:30' && work?.end === '23:30',
      'approved weekly decimal-time schedule did not save correctly');
    expect(work?.id === 'weekly-existing-identical',
      'approved identical weekly OCR row must retain existing schedule identity');
  }
  // Generalized recovery safety: date glyphs may be entirely absent.
  // Synthetic review-contract fixture only, not an OCR accuracy result.
  const recoverState=new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  recoverState.mutate(st=>{
    st.importBatches=[];
    st.schedules=st.schedules.filter(row=>!row.date.startsWith('2026-12-') &&
      !row.date.startsWith('2027-01-'));
  });
  const recoverImports=new reposModule.MockImportRepository(recoverState);
  const recoverPeople=new reposModule.MockPersonRepository(recoverState);
  const recoverSchedules=new reposModule.MockScheduleRepository(recoverState);
  const recoverSelection=new selectionModule.WorkbookImportFileSelectionAction(
    recoverImports,recoverPeople,recoverSchedules,
    {async parse(){throw Error('Workbook excluded from weekly fixture');}},
    {async parse(){return {
      detectedPeople:[{sourceName:'여자친구',confidence:.2}],
      scheduleCandidates:[],
      reviewCandidates:[
        {sourcePersonName:'여자친구',date:null,dayIndex:0,
          start:'09:30',end:'23:30',breakMinutes:null,
          breakReviewRequired:true,sourceRow:0,confidence:.3,
          recognitionState:'INCOMPLETE',enabled:true},
        {sourcePersonName:'여자친구',date:null,dayIndex:6,
          start:null,end:null,sourceRow:0,confidence:0,
          recognitionState:'OFF_CANDIDATE',enabled:true},
      ],
      structure:{sheet:'weekly 7 day x start/end/break physical matrix',
        headerRow:0,personColumn:'observed',dateColumn:'not observed',
        shiftColumn:'observed',needsReview:true,
        weeklyReview:{status:'PARTIAL_REVIEW_REQUIRED',
          startDate:null,confirmed:false}},
      confidence:.2,
    };}},
  );
  const recoverId=await recoverSelection.accept([{
    kind:'IMAGE',file:{name:'synthetic-loss-of-date.png'},
  }]);
  const recoverBatch=await recoverImports.getBatch(recoverId);
  expect(recoverBatch?.reviewItems.length===2 &&
    recoverBatch.reviewItems.every(item=>item.date===null&&item.resolution===null),
    'zero date glyphs must preserve original recognized shift evidence');
  const recoverCommit=new commitModule.CommitImportReview(recoverImports,recoverSchedules);
  let blockedWithoutWeek=false;
  try{await recoverCommit.execute(recoverId)}
  catch(e){blockedWithoutWeek=String(e).includes('WEEKLY_DATES_NOT_CONFIRMED');}
  expect(blockedWithoutWeek,'zero-date schedule must not write without explicit week');
  let rejectedNonMonday=false;
  try{await recoverImports.setWeeklyStartDate(recoverId,'2026-12-29')}
  catch(e){rejectedNonMonday=String(e).includes('MONDAY');}
  expect(rejectedNonMonday,'week start must be a Monday');
  await recoverImports.setWeeklyStartDate(recoverId,'2026-12-28');
  const preview=await recoverImports.getBatch(recoverId);
  expect(preview.reviewItems.find(x=>x.dayIndex===6)?.date==='2027-01-03',
    'year-crossing week must retain seven continuous dates');
  let blockedBeforeConfirmation=false;
  try{await recoverCommit.execute(recoverId)}
  catch(e){blockedBeforeConfirmation=String(e).includes('WEEKLY_DATES_NOT_CONFIRMED');}
  expect(blockedBeforeConfirmation,'selecting date is not user confirmation');
  await recoverImports.confirmWeeklyDates(recoverId);
  const recovered=await recoverImports.getBatch(recoverId);
  for(const row of recovered.reviewItems){
    await recoverImports.setDetectedPersonMatch(recoverId,row.detectedPersonId,'mock-person-1');
    if(row.dayIndex===0){
      await recoverImports.setImportedBreakMinutes(recoverId,row.id,30);
    }else{
      await recoverImports.setImportedEnabled(recoverId,row.id,false);
    }
    await recoverImports.setResolution(recoverId,row.id,'NEW');
  }
  expect(await recoverSchedules.getByDate('mock-person-1','2026-12-28')===null,
    'manual review not committed before explicit final approval');
  await recoverCommit.execute(recoverId);
  const recoveryWork=await recoverSchedules.getByDate('mock-person-1','2026-12-28');
  const recoveryOff=await recoverSchedules.getByDate('mock-person-1','2027-01-03');
  expect(recoveryWork?.start==='09:30'&&recoveryWork?.end==='23:30'&&
    recoveryWork?.breakMinutes===30,'reviewed shift minutes must survive date recovery');
  expect(recoveryOff?.enabled===false,'OFF_CANDIDATE requires explicit toggle and approval');
  console.log('WEEKLY_ZERO_DATE_RECOVERY_AND_YEAR_BOUNDARY_APPROVAL_PASS');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5Q explicit multi-item import review verification passed');
