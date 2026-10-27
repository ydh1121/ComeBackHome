import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
try {
    const m = await vite.ssrLoadModule('/src/modules/injury/advisor/model.ts');
    const { validatePayload } = await vite.ssrLoadModule('/src/modules/injury/domain/records.ts');
    let checks = 0;
    const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
    check(m.advisorSummary([], null), { label: '아직 신청 단계를 확인하지 않았어요', review: false, source: '내 상황을 알려주면 다음에 할 일을 안내해요' });
    check(m.QUESTIONS.length, 3);
    const blank = m.emptyProfile();
    check(blank.answers, [null, null, null]);
    check(m.advisorSummary([], { ...blank, deferred: true }).review, false);
    check(m.advisorSummary([], { ...blank, confirmed: true, answers: [null, 'working', null] }).review, false);
    check(m.advisorSummary([], { ...blank, confirmed: true, answers: ['before', 'working', 'checking'] }).review, false);
    check(m.advisorSummary([], { ...blank, confirmed: true, answers: ['filed', 'working', null] }).review, true);
    const record = { id: m.profileId('case-fixture'), caseId: 'case-fixture', kind: 'content', payload: m.profilePayload(blank), revision: 1, updatedBy: 'synthetic-member', updatedAt: '2026-10-26', archivedAt: null };
    check(validatePayload('content', record.payload), record.payload);
    check(m.readProfile(record), blank);
    for (const patch of [{ answers: [false, null, null] }, { answers: ['approved', null, null] }, { answers: [null, null] }, { cursor: 4 }, { version: 2 }, { confirmed: 'yes' }])
        check(m.readProfile({ ...record, payload: { ...record.payload, body: JSON.stringify({ ...blank, ...patch }) } }), null);
    check(m.readProfile({ ...record, archivedAt: '2026-10-26' }), null);
    const reported = { ...blank, confirmed: true, answers: ['decision', 'left', 'document'] };
    check(m.profilePayload(reported).certainty, 'reported');
    check(m.profilePayload(reported).sourceIds, []);
    check(m.advisorSummary([], reported).label, '결과를 받았어요');
    const existing = [{ ...record, kind: 'intake', payload: { title: 'synthetic claim', body: 'synthetic', certainty: 'reported', sourceIds: [], data: { status: 'filed' } } }];
    const before = structuredClone(existing);
    check(m.advisorSummary(existing, reported).label, '공단 접수 확인 중');
    check(existing, before);
    assert(!/승인|퇴사|지급/.test(m.advisorSummary([], blank).label));
    checks++;
    check(m.scriptPayload(m.HOSPITAL_SCRIPT).certainty, 'reported');
    validatePayload('content', m.scriptPayload(m.HOSPITAL_SCRIPT));
    checks++;
    assert(!/\d[\d,.]*\s*만원|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|010[-\d]{8,10}/.test(m.HOSPITAL_SCRIPT));
    checks++;
    await (await import('./private-work/verify-advisor-r2-model.mjs')).verifyAdvisorR2Model(vite);
    await (await import('./private-work/verify-materials-model.mjs')).verifyMaterialsModel(vite);
    await (await import('./private-work/verify-content-model.mjs')).verifyContentModel(vite);
    await (await import('./private-work/verify-management-model.mjs')).verifyManagementModel(vite);
    console.log('PRIVATE_ADVISOR_R1_MODEL_PASS checks=' + checks + ' empty_case_unknown_not_false_reported_not_official_existing_records_unchanged_no_private_seed');
}
finally {
    await vite.close();
}
