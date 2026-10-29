import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Run against the existing isolated D1 browser harness, never production.
// Every record below is synthetic; provider and push execution stay disabled.
export async function verifyReemployment(page, ctx, base, label) {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'synthetic reemployment fixtures may only run against loopback');
  const api = (path, method = 'GET', data) => ctx.request.fetch(base + '/api/' + path, {
    method, headers: { Origin: base }, ...(data === undefined ? {} : { data }),
  });
  const snapshot = async () => {
    const response = await api('private/case');
    assert.equal(response.status(), 200);
    return response.json();
  };
  const stubClipboard = () => page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async value => { window.__reemploymentCopied = value; } },
  }));
  const payload = (title, data) => ({
    title: `Synthetic reemployment ${label} ${title}`, body: '', certainty: 'reported', sourceIds: [], data,
  });
  const employment = (title, data) => ({ kind: 'employment', payload: payload(title, {
    employerName: 'Synthetic workplace', jobTitle: 'Synthetic duties', employmentType: 'temporary',
    weeklyHours: 12, wage: 12000, wageType: 'hourly', ...data,
  }) });
  const seedRecords = [
    employment('actual', { actualOrSimulated: 'actual', hireDate: '2025-02-05', firstWorkDate: '2025-02-05', lastWorkDate: '2025-02-08' }),
    employment('planned', { actualOrSimulated: 'planned', hireDate: '2025-02-06', contractEnd: '2025-02-09' }),
    employment('open', { actualOrSimulated: 'actual', hireDate: '2025-02-07' }),
    { kind: 'treatment', payload: payload('treatment', { status: 'pending', extensionStatus: 'none', from: '2025-02-01', to: '2025-02-10' }) },
    { kind: 'treatment', payload: payload('missing dates', { status: 'pending', extensionStatus: 'none' }) },
    ...['workers_comp_leave', 'unemployment'].map(benefitType => ({ kind: 'benefit_claim', payload: payload(benefitType, {
      benefitType, status: 'estimate', from: '2025-02-01', to: '2025-02-10',
      expectedAmount: 400000, dailyRate: 40000, allocatedDays: 10,
    }) })),
  ];
  const seed = await api('private/case/import', 'POST', { version: 'cbh-case-seed/v1', approved: true, records: seedRecords });
  assert.equal(seed.status(), 200, await seed.text());
  const before = await snapshot();
  const fixtureIds = seedRecords.map(record => {
    const matches = before.records.filter(candidate => candidate.payload.title === record.payload.title);
    assert.equal(matches.length, 1, 'each synthetic fixture is imported once');
    return matches[0].id;
  });
  const cases = [];
  let writes = 0;
  const remoteRequests = [];
  const observe = request => {
    const url = new URL(request.url());
    if (url.origin === base && url.pathname.startsWith('/api/private/case') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes++;
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) remoteRequests.push(url.origin);
  };
  page.on('request', observe);
  const region = () => page.getByRole('region', { name: '재취업 안내', exact: true });
  const enter = async () => {
    await page.goto(base + '/injury?section=today');
    await page.getByRole('button', { name: '다른 직장에 취업해도 될까요?', exact: true }).click();
    await region().getByRole('heading', { name: '지금 어떤 상황인가요?', exact: true }).waitFor();
  };
  const choose = async (stage, intent) => {
    const reset = region().getByRole('button', { name: '상황 다시 선택', exact: true });
    if (await reset.count()) await reset.click();
    await region().getByRole('button', { name: stage[1], exact: true }).click();
    await region().getByRole('heading', { name: '새 직장에 취업했나요?', exact: true }).waitFor();
    await region().getByRole('button', { name: intent === 'planned' ? '취업할 예정이에요' : '이미 일하고 있어요', exact: true }).click();
    await region().getByRole('heading', { name: intent === 'planned' ? '취업 전에 확인할 일' : '취업 후 확인할 일', exact: true }).waitFor();
    const result = page.locator(`[data-reemployment-stage="${stage[0]}"][data-reemployment-intent="${intent}"]`);
    assert.equal(await result.count(), 1, 'the selected state and intent stay explicit');
    return result;
  };
  const stages = [
    ['applied', '신청·심사 중이에요'], ['treatment', '치료를 받는 중이에요'],
    ['ended', '치료가 끝났어요'], ['disability', '장해급여를 받은 뒤예요'],
    ['unemployment', '구직급여를 받는 중이에요'], ['unknown', '아직 잘 모르겠어요'],
  ];
  try {
    await page.goto(base + '/injury?section=help');
    await page.getByRole('button', { name: '다른 직장에 취업해도 될까요?', exact: true }).click();
    await region().getByRole('heading', { name: '지금 어떤 상황인가요?', exact: true }).waitFor();
    cases.push('help_entry_reuses_advisor');
    await enter();
    assert.equal(await region().locator('input,textarea,select').count(), 0, 'no complex form before the two questions');
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'first question fits at ' + width);
      await page.screenshot({ path: resolve('artifacts/private-work', `${label}-reemployment-question-${width}.png`), animations: 'disabled' });
      cases.push('first_question_' + width);
    }
    for (const stage of stages) for (const intent of ['planned', 'working']) {
      const result = await choose(stage, intent);
      const prefix = `reemployment-${stage[0]}-${intent}-`;
      for (const key of ['reason', 'steps']) {
        const block = result.locator(`[data-guidance-key="${prefix}${key}"]`);
        await block.waitFor();
        assert((await block.innerText()).trim().length > 30, `${stage[0]} ${intent} has actionable ${key}`);
      }
      await result.locator('summary').filter({ hasText: /^준비할 서류$/ }).click();
      const materials = result.locator(`[data-guidance-key="${prefix}materials"]`);
      await materials.waitFor();
      assert((await materials.innerText()).trim().length > 30, 'documents are explained rather than an empty section');
      const actionText = await result.locator(`[data-guidance-key="${prefix}steps"]`).innerText();
      if (stage[0] === 'unemployment') {
        assert(actionText.includes('고용24') && actionText.includes('취업사실 신고'), 'unemployment advice reuses the actual employment-reporting path');
        assert(actionText.includes(intent === 'planned' ? '입사 예정일' : '입사일'), 'planned and actual employment dates stay distinct');
        assert.equal(await result.locator('summary').filter({ hasText: /^고용센터에 물어볼 말$/ }).count(), 1);
        assert.equal(await result.locator('summary').filter({ hasText: /^의사에게 물어볼 말$/ }).count(), 0, 'unemployment reporting does not insert an unrelated medical step');
      }
      if (stage[0] === 'treatment') {
        assert(actionText.includes('부분휴업급여') && actionText.includes('의사'), 'treatment guidance requires medical and agency confirmation');
        const caution = await result.locator(`[data-guidance-key="${prefix}caution"]`).innerText();
        assert(caution.includes('전액') && caution.includes('판단할 수는 없어요'), 'employment alone cannot determine leave benefit cancellation or full payment');
      }
      const agencyText = await result.locator('.reemployment-script .advisor-script-body').last().textContent();
      assert(agencyText.startsWith(intent === 'planned' ? '새 직장에 취업할 예정입니다.' : '새 직장에서 이미 일을 시작했습니다.'), 'agency script matches selected intent');
      if (intent === 'working') assert(!/일하려고 합니다|취업할 예정입니다|일할 예정이거나/.test(agencyText), 'actual employment script cannot contradict itself with a planned start');
      assert.equal(await result.locator('input[type="number"]').count(), 0, 'advice creates no duplicate benefit calculator');
      cases.push(`${stage[0]}_${intent}`);
    }
    assert.equal(writes, 0, 'viewing and answering all twelve paths causes zero case writes');
    let after = await snapshot();
    assert.deepEqual(after.records, before.records, 'state selection leaves eligibility, amounts, dates and record status untouched');
    assert.deepEqual(after.payments, before.payments, 'state selection leaves decisions and deposits untouched');
    cases.push('twelve_paths_preserve_d1');
    await page.reload();
    await region().getByRole('heading', { name: '지금 어떤 상황인가요?', exact: true }).waitFor();
    cases.push('choices_not_persisted_or_inferred');

    const result = await choose(stages[1], 'working');
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: resolve('artifacts/private-work', `${label}-reemployment-result-collapsed-${width}.png`), animations: 'disabled' });
      cases.push('collapsed_result_' + width);
    }
    const notice = page.locator('[aria-label="취업 기간 확인"]');
    await notice.waitFor();
    await notice.locator('summary').click();
    for (const kind of ['actual_overlap', 'planned_overlap', 'possible_overlap', 'date_review']) {
      const item = notice.locator(`[data-reemployment-review-kind="${kind}"]`).first();
      await item.waitFor();
      assert((await item.innerText()).length > 30, `${kind} is explained distinctly`);
    }
    for (const title of ['새 직장에서 증상이 심해졌다면', '회사에 산재 이력을 알려야 하나요?', '등록한 직장 정보']) {
      const disclosure = result.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${title.replace(/[?]/g, '\\?')}$`) }) });
      await disclosure.locator(':scope > summary').click();
      assert((await disclosure.innerText()).length > title.length + 30, `${title} contains useful guidance`);
    }
    await result.getByText('Synthetic duties', { exact: false }).first().waitFor();
    cases.push('actual_planned_open_missing_dates_readonly', 'worsening_privacy_existing_employment');

    const doctor = result.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^의사에게 물어볼 말$/ }) });
    const agency = result.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^근로복지공단에 물어볼 말$/ }) });
    await doctor.locator(':scope > summary').click();
    await doctor.getByRole('button', { name: '문장 편집', exact: true }).click();
    await doctor.locator('textarea').fill('Synthetic doctor draft ' + label);
    await agency.locator(':scope > summary').click();
    await agency.getByRole('button', { name: '문장 편집', exact: true }).click();
    await agency.locator('textarea').fill('Synthetic agency draft ' + label);
    const ids = await result.locator('textarea').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2, 'two delivery editors have distinct label/input identities');
    for (const section of [doctor, agency]) {
      const id = await section.locator('textarea').getAttribute('id');
      assert.equal(await section.locator(`label[for="${id}"]`).count(), 1, 'each delivery input keeps its own accessible label');
    }
    await stubClipboard();
    await doctor.getByRole('button', { name: '문장 복사', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__reemploymentCopied), 'Synthetic doctor draft ' + label);
    await agency.locator(':scope > summary').click();
    await agency.locator(':scope > summary').click();
    assert.equal(await doctor.locator('textarea').inputValue(), 'Synthetic doctor draft ' + label);
    assert.equal(await agency.locator('textarea').inputValue(), 'Synthetic agency draft ' + label, 'closing another question preserves both drafts');
    await agency.getByRole('button', { name: '문장 복사', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__reemploymentCopied), 'Synthetic agency draft ' + label);
    for (const section of [doctor, agency]) await section.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(writes, 0, 'copying and cancelling delivery drafts causes zero writes');
    cases.push('two_script_ids_drafts_copy_cancel');

    for (const width of [375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow at ' + width);
      const bounds = await result.boundingBox();
      assert(bounds && bounds.width <= width, 'advice fits the viewport at ' + width);
      await page.screenshot({ path: resolve('artifacts/private-work', `${label}-reemployment-${width}.png`), fullPage: true, animations: 'disabled' });
      cases.push('viewport_' + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // Read-only links reuse the existing sections, including their shared overlap notice.
    for (const section of ['employment', 'payments', 'claim', 'tasks']) {
      const link = result.locator(`nav[aria-label="재취업 관련 기록"] a[href="/injury?section=${section}"]`);
      await link.waitFor();
      await link.click();
      await page.waitForURL(url => url.searchParams.get('section') === section);
      if (['employment', 'payments'].includes(section)) {
        await page.locator('[aria-label="취업 기간 확인"]').waitFor();
        await page.getByRole('link', { name: '재취업 안내 보기', exact: true }).click();
        await region().getByRole('heading', { name: '지금 어떤 상황인가요?', exact: true }).waitFor();
      } else await enter();
      await choose(stages[1], 'working');
      cases.push('existing_' + section + '_link');
    }
    assert.equal(writes, 0, 'link navigation never commits case changes');
    after = await snapshot();
    assert.deepEqual(after.records, before.records);
    assert.deepEqual(after.payments, before.payments);

    const key = 'reemployment-treatment-working-reason';
    const block = page.locator(`[data-guidance-key="${key}"]`);
    const originalBody = await block.locator('p').first().textContent();
    const edit = async () => {
      await block.getByRole('button', { name: '재취업 안내 이유 편집', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      return dialog;
    };
    let editor = await edit();
    await editor.locator('textarea').fill('Synthetic cancelled reemployment guidance ' + label);
    page.once('dialog', dialog => dialog.accept());
    await editor.getByRole('button', { name: '취소', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.deepEqual((await snapshot()).records, before.records, 'explicit editor cancellation preserves every record');
    cases.push('guidance_cancel');

    // The section-link checks above navigate to new documents. Install this
    // document's clipboard probe again before testing the guidance editor.
    await stubClipboard();
    editor = await edit();
    await editor.locator('textarea').fill('Synthetic reemployment guidance ' + label);
    await editor.getByRole('button', { name: '복사', exact: true }).click();
    assert((await page.evaluate(() => window.__reemploymentCopied)).includes('Synthetic reemployment guidance ' + label));
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const guideId = 'guide-v1-reemp-tr-w-reason-' + before.caseId;
    assert(guideId.length <= 80, 'guidance identity fits the existing record API with a UUID case');
    let guide = (await snapshot()).records.find(record => record.id === guideId);
    assert(guide, 'explicit save creates or updates only the existing editable-content contract');
    assert.equal(guide.payload.certainty, 'reported');
    editor = await edit();
    const own = 'Synthetic retained reemployment draft ' + label;
    await editor.locator('textarea').fill(own);
    const other = await api('private/case/records/' + guideId, 'PUT', { kind: 'content', revision: guide.revision, payload: { ...guide.payload, body: 'Synthetic other-device reemployment guidance ' + label } });
    assert.equal(other.status(), 200);
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await editor.getByRole('heading', { name: '다른 기기의 최신 저장본', exact: true }).waitFor();
    assert.equal(await editor.locator('textarea').inputValue(), own, 'revision conflict preserves the local draft');
    await editor.getByRole('button', { name: '최신본 확인 · 내 입력 계속 편집', exact: true }).click();
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const history = await (await api('private/case/records/' + guideId + '/history')).json();
    assert(history.history.length >= 3, 'explicit revisions retain author/time history');
    const final = await snapshot();
    for (const record of before.records.filter(record => record.id !== guideId)) assert.deepEqual(final.records.find(candidate => candidate.id === record.id), record, 'guidance editing cannot alter another record');
    assert.deepEqual(final.payments, before.payments, 'guidance editing cannot alter decisions or deposits');
    assert.deepEqual(final.deadlines, before.deadlines, 'guidance editing cannot reschedule deadlines');
    cases.push('guidance_copy_save_409_history', 'guidance_retains_other_records_and_payments');

    // Save both real delivery editors, not merely their browser-side drafts.
    // The harness uses a UUID case ID to exercise the production record limit.
    const scriptIds = [];
    for (const [section, suffix, recipient] of [[doctor, 'physician', '의사'], [agency, 'agency', '근로복지공단']]) {
      const scriptId = `advisor-script-v1-${before.caseId}-reemp-tr-w-${suffix}`;
      scriptIds.push(scriptId);
      assert(scriptId.length <= 80, 'delivery identity fits the existing record API with a UUID case');
      if (await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
      const original = await section.locator('.advisor-script-body').textContent();
      const body = `Synthetic saved ${suffix} delivery ${label}`;
      await section.getByRole('button', { name: '문장 편집', exact: true }).click();
      await section.locator('textarea').fill(body);
      await section.getByRole('button', { name: '문장 저장', exact: true }).click();
      await section.locator('.advisor-script-body').filter({ hasText: body }).waitFor();
      const saved = (await snapshot()).records.find(record => record.id === scriptId);
      assert(saved, 'an explicit delivery save reaches isolated D1');
      assert.equal(saved.payload.body, body);
      assert.equal(saved.payload.data.recipient, recipient);
      assert.equal(saved.payload.certainty, 'reported');
      const restored = await api('private/case/records/' + scriptId, 'PUT', { kind: 'content', revision: saved.revision, payload: { ...saved.payload, body: original } });
      assert.equal(restored.status(), 200);
      cases.push('delivery_' + suffix + '_explicit_d1_save');
    }
    const afterScripts = await snapshot();
    for (const record of final.records.filter(record => !scriptIds.includes(record.id))) assert.deepEqual(afterScripts.records.find(candidate => candidate.id === record.id), record, 'delivery saves cannot alter another record');
    assert.deepEqual(afterScripts.payments, before.payments);
    assert.deepEqual(afterScripts.deadlines, before.deadlines);

    // Restore the fallback body so Chromium and WebKit exercise the same guidance.
    guide = final.records.find(record => record.id === guideId);
    const restore = await api('private/case/records/' + guideId, 'PUT', { kind: 'content', revision: guide.revision, payload: { ...guide.payload, body: originalBody } });
    assert.equal(restore.status(), 200);
    assert.deepEqual(remoteRequests, [], 'the entire advice flow uses no external provider or push endpoint');
  } finally {
    page.off('request', observe);
    const current = await snapshot();
    for (const id of fixtureIds) {
      const record = current.records.find(candidate => candidate.id === id);
      if (record && !record.archivedAt) {
        const response = await api('private/case/records/' + id, 'DELETE', { revision: record.revision });
        assert.equal(response.status(), 200, 'archive only this helper\'s synthetic fixture');
      }
    }
  }
  await page.goto(base + '/injury?section=employment');
  await page.getByRole('button', { name: '기록 추가', exact: true }).waitFor();
  const archivedNotice = page.locator('[aria-label="취업 기간 확인"]');
  if (await archivedNotice.count()) assert(!(await archivedNotice.innerText()).includes(`Synthetic reemployment ${label}`), 'archived fixtures are excluded from overlap notices');
  cases.push('archived_records_excluded');
  // The encompassing legacy browser test resumes by opening its task editor.
  await page.goto(base + '/injury?section=tasks');
  await page.getByRole('button', { name: '기록 추가', exact: true }).waitFor();
  console.log('PRIVATE_REEMPLOYMENT_UI_PASS ' + label + ' ' + JSON.stringify({ cases: cases.length, covered: cases, externalRequests: remoteRequests.length }));
}
