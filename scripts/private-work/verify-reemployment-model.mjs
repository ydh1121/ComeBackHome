import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function verifyReemploymentModel(vite) {
  const { getReemploymentContext: context, reemploymentStorageKey } = await vite.ssrLoadModule('/src/modules/injury/advisor/reemployment.ts');
  const { guidanceId } = await vite.ssrLoadModule('/src/modules/injury/content/model.ts');
  const { adviceScriptId } = await vite.ssrLoadModule('/src/modules/injury/advisor/scenarios.ts');
  let checks = 0;
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const syntheticCaseId = '11111111-1111-4111-8111-111111111111';
  const storageIds = [];
  for (const stage of ['applied', 'treatment', 'ended', 'disability', 'unemployment', 'unknown']) {
    for (const intent of ['planned', 'working']) {
      const key = reemploymentStorageKey(stage, intent);
      for (const suffix of ['reason', 'steps', 'caution', 'materials', 'physician', 'agency']) {
        const id = (['physician', 'agency'].includes(suffix) ? adviceScriptId : guidanceId)(syntheticCaseId, key + '-' + suffix);
        equal(id.length <= 80, true, `${stage}/${intent}/${suffix} record ID fits a real UUID case`);
        storageIds.push(id);
      }
    }
  }
  equal(new Set(storageIds).size, 72, 'all stage, intent and content records have distinct IDs');
  const date = '2030-06-15';
  const record = (id, kind, data, certainty = 'reported') => ({
    id, caseId: 'synthetic-case', kind,
    payload: { title: 'Synthetic ' + kind, body: 'Synthetic only', certainty, sourceIds: [], data },
    revision: 1, updatedBy: 'synthetic-actor', updatedAt: '2030-06-01T00:00:00Z', archivedAt: null,
  });
  const job = (patch = {}, certainty = 'reported') => record('job', 'employment', {
    employerName: 'Synthetic workplace', actualOrSimulated: 'actual', hireDate: '2030-06-01',
    firstWorkDate: '2030-06-02', lastWorkDate: '2030-06-10', jobTitle: 'Synthetic duties',
    weeklyHours: 20, wage: 100, wageType: 'hourly', ...patch,
  }, certainty);
  const treatment = (patch = {}, certainty = 'reported') => record('care', 'treatment', {
    status: 'pending', from: '2030-06-05', to: '2030-06-12', ...patch,
  }, certainty);
  const review = (a = job(), b = treatment(), now = date) => context([a, b], now).overlaps[0];
  equal(context([], date), { employments: [], periods: [], overlaps: [], hasUncertainRecords: false });
  assert.throws(() => context([], '2030-02-30'), /INVALID_REVIEW_DATE/); checks++;
  equal(review().kind, 'actual_overlap');
  equal([review().from, review().to], ['2030-06-05', '2030-06-10']);
  equal(review().recordIds, ['job', 'care']);
  equal(review().reasons, ['records_not_agency_determination']);
  equal(review(job({ firstWorkDate: '' })).reasons, ['employment_dates_not_work_days', 'records_not_agency_determination']);
  const summary = context([job()], date).employments[0];
  equal([summary.hireDate, summary.firstWorkDate, summary.lastWorkDate, summary.from, summary.to, summary.basis],
    ['2030-06-01', '2030-06-02', '2030-06-10', '2030-06-02', '2030-06-10', 'work_dates']);
  equal([summary.jobTitle, summary.weeklyHours, summary.wage, summary.wageType, summary.certainty],
    ['Synthetic duties', 20, 100, 'hourly', 'reported']);

  // Closed ranges are inclusive: touching on one day still needs review.
  for (const [from, to, expected] of [
    ['2030-05-01', '2030-06-01', null], ['2030-05-01', '2030-06-02', ['2030-06-02', '2030-06-02']],
    ['2030-06-10', '2030-06-15', ['2030-06-10', '2030-06-10']], ['2030-06-11', '2030-06-15', null],
    ['2030-06-03', '2030-06-08', ['2030-06-03', '2030-06-08']], ['2030-05-01', '2030-07-01', ['2030-06-02', '2030-06-10']],
  ]) {
    const actual = review(job(), treatment({ from, to }));
    equal(actual ? [actual.from, actual.to] : null, expected, `inclusive bounds ${from}/${to}`);
  }
  const planned = job({ actualOrSimulated: 'planned', hireDate: '2030-07-01', firstWorkDate: '', lastWorkDate: '', contractEnd: '2030-07-31' });
  const futureCare = treatment({ from: '2030-07-01', to: '2030-07-20' });
  equal(review(planned, futureCare).kind, 'planned_overlap');
  equal(context([planned], date).employments[0].to, '2030-07-31');
  equal(review(job({ actualOrSimulated: 'unknown' })).kind, 'possible_overlap');
  equal(review(job({ actualOrSimulated: undefined })).kind, 'possible_overlap');
  equal(review(job({ lastWorkDate: '', contractEnd: '2030-12-31' })).kind, 'possible_overlap');
  equal(context([job({ lastWorkDate: '', contractEnd: '2030-12-31' })], date).employments[0].to, null, 'actual work end never copied from contract expiry');
  equal(review(job({ lastWorkDate: '' })).to, null, 'missing end not filled with today');
  equal(review(job({ lastWorkDate: '' }), treatment({ to: '' })).kind, 'possible_overlap');
  equal(review(job({ lastWorkDate: '' }), treatment({ from: '2030-05-01', to: '2030-06-01' })), undefined, 'known separated open range is not a warning');
  equal(review(job(), treatment({ from: '', to: '2030-06-01' })), undefined, 'known end can exclude overlap despite unknown start');

  for (const [target, patch] of [
    ['job', { hireDate: '', firstWorkDate: '' }], ['care', { from: '' }],
    ['job', { firstWorkDate: '2030-02-30' }], ['job', { lastWorkDate: '2030-05-31' }],
    ['care', { from: '2030-06-20', to: '2030-06-01' }], ['care', { to: 'not-a-date' }],
    ['job', { hireDate: 42 }], ['care', { from: true }],
  ]) {
    const actual = review(target === 'job' ? job(patch) : job(), target === 'care' ? treatment(patch) : treatment());
    equal(actual.kind, 'date_review', `malformed or missing ${target}`);
  }
  const invalid = review(job({ lastWorkDate: '2030-05-31' }));
  equal([invalid.from, invalid.to], [null, null], 'invalid periods do not produce fabricated overlap dates');
  const futureActual = job({ firstWorkDate: '2030-07-01', lastWorkDate: '2030-07-05' });
  equal(review(futureActual, futureCare).kind, 'possible_overlap');
  equal(review(futureActual, futureCare).reasons.includes('future_actual_dates'), true);
  equal(review(futureActual, futureCare, '2030-07-05').kind, 'actual_overlap', 'future classification uses the supplied review date');

  const claims = ['workers_comp_leave', 'unemployment'].map((benefitType, i) => record('claim-' + i, 'benefit_claim', {
    benefitType, status: 'approved', from: '2030-06-05', to: '2030-06-12',
    dailyRate: 7, expectedAmount: 70, workedDays: 2, wagesReceived: 20, officialRemainingDays: 4,
  }, 'official'));
  const all = context([job(), treatment(), ...claims], date);
  equal(all.periods.map(value => value.kind), ['treatment', 'workers_comp_leave', 'unemployment']);
  equal(all.overlaps.map(value => value.periodKind), ['treatment', 'workers_comp_leave', 'unemployment']);
  equal(context([job(), treatment({ status: 'ended' })], date).overlaps.length, 1, 'historical overlap remains a recorded comparison, not an active benefit decision');
  equal(context([job(), ...['medical_expense', 'disability', 'severance'].map((benefitType, i) => record('unrelated-' + i, 'benefit_claim', { benefitType, from: '2030-06-01', to: '2030-06-12' }))], date).periods, []);
  equal(context([{ ...job(), archivedAt: '2030-06-14' }, treatment()], date).overlaps, []);
  equal(context([job(), { ...treatment(), archivedAt: '2030-06-14' }], date).overlaps, []);
  for (const certainty of ['reported', 'estimated', 'documented', 'official']) {
    const actual = context([job({}, certainty), treatment({}, certainty)], date);
    equal(actual.employments[0].certainty, certainty);
    equal(actual.periods[0].certainty, certainty);
    equal(actual.overlaps[0].kind, 'actual_overlap', 'recorded overlap does not promote source certainty');
    equal(actual.hasUncertainRecords, certainty !== 'official');
  }

  const a = job(), b = treatment();
  a.payload.sourceIds = ['synthetic-source-a', 'synthetic-shared'];
  b.payload.sourceIds = ['synthetic-shared', 'synthetic-source-b'];
  equal(review(a, b).sourceIds, ['synthetic-source-a', 'synthetic-shared', 'synthetic-source-b']);
  const captured = context([a, b], date);
  captured.employments[0].sourceIds.push('output-only');
  equal(a.payload.sourceIds, ['synthetic-source-a', 'synthetic-shared'], 'output arrays never alias the original source');
  const malformedAmounts = context([job({ wage: '200', weeklyHours: Infinity, wageType: '' })], date).employments[0];
  equal([malformedAmounts.wage, malformedAmounts.weeklyHours, malformedAmounts.wageType], [null, null, null]);
  const zero = context([job({ wage: 0, weeklyHours: 0 })], date).employments[0];
  equal([zero.wage, zero.weeklyHours], [0, 0], 'known zero differs from unknown');

  const caseData = { records: [a, b, ...claims], payments: [{ id: 'synthetic-payment', amount: 70, event_type: 'decision', recognized_days: 10 }] };
  const before = structuredClone(caseData);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } };
  freeze(caseData);
  context(caseData.records, date);
  equal(caseData, before, 'viewing advice never modifies employment, approval, amounts, recognized days, or payment events');
  console.log('PRIVATE_REEMPLOYMENT_MODEL_PASS checks=' + checks + ' uuid_storage_ids_inclusive_bounds_planned_actual_unknown_open_dates_source_certainty_immutable_ledger');
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try { await verifyReemploymentModel(vite); }
  finally { await vite.close(); }
}
