import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
try {
    const m = await vite.ssrLoadModule('/src/modules/injury/advisor/model.ts');
    const { validatePayload } = await vite.ssrLoadModule('/src/modules/injury/domain/records.ts');
    let checks = 0;
    const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
    check(m.advisorSummary([], null), { label: '현재 단계 확인이 필요해요', review: false, source: '입력하지 않아도 안내를 볼 수 있어요' });
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
    check(m.advisorSummary(existing, reported).label, '공단 접수를 확인하는 단계');
    check(existing, before);
    assert(!/승인|퇴사|지급/.test(m.advisorSummary([], blank).label));
    checks++;
    check(m.scriptPayload(m.HOSPITAL_SCRIPT).certainty, 'reported');
    validatePayload('content', m.scriptPayload(m.HOSPITAL_SCRIPT));
    checks++;
    assert(!/7월|엽떡|신이본|MRI|330/.test(m.HOSPITAL_SCRIPT));
    checks++;
    console.log('PRIVATE_ADVISOR_R1_MODEL_PASS checks=' + checks + ' empty_case_unknown_not_false_reported_not_official_existing_records_unchanged_no_private_seed');
}
finally {
    await vite.close();
}
