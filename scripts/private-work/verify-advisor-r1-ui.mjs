import assert from 'node:assert/strict';
import { resolve } from 'node:path';
export async function verifyAdvisorR1(page, ctx, base, label) {
    try {
        await verifyAdvisorR1Flow(page, ctx, base, label);
    } catch (error) {
        await page.screenshot({ path: resolve('artifacts/private-work', `${label}-advisor-failure.png`), fullPage: true }).catch(() => {});
        console.error('ADVISOR_FAILURE_UI', JSON.stringify(await page.evaluate(() => ({
            headings: [...document.querySelectorAll('h1,h2,h3,h4')].map(el => el.textContent),
            textareas: [...document.querySelectorAll('textarea')].map(el => ({ id: el.id, labels: [...el.labels].map(l => l.textContent), ariaLabel: el.getAttribute('aria-label') })),
            buttons: [...document.querySelectorAll('button')].map(el => ({ text: el.textContent, disabled: el.disabled }))
        })).catch(() => null)));
        throw error;
    }
}
async function verifyAdvisorR1Flow(page, ctx, base, label) {
    const api = async (path, method = 'GET', data) => ctx.request.fetch(base + '/api/' + path, { method, headers: { Origin: base }, ...(data === undefined ? {} : { data }) });
    await page.locator('.advisor-primary').waitFor();
    assert.equal(await page.getByRole('navigation', { name: '산재 메뉴', exact: true }).getByRole('button').count(), 3);
    assert.equal(await page.getByRole('button', { name: '기록 추가', exact: true }).count(), 0);
    assert.equal(await page.locator('.record-tools, .record-add, textarea, select').count(), 0, 'no record-entry prerequisites on home');
    for (const width of [375, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if ([375,390,1440].includes(width)) await page.screenshot({ path: resolve('artifacts/private-work', `${label}-advisor-home-${width}.png`) });
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({ path: resolve('artifacts/private-work', `${label}-advisor-home-390-full.png`), fullPage: true });
    // Explicit disconnected status: guidance remains usable; no file is claimed saved.
    await page.route('**/api/private/case/documents/status', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ owner: true, configured: false, connected: false, folderSelected: false, maxBytes: 20971520, chunkBytes: 1048576 }) }));
    await page.getByRole('button', { name: '내 자료', exact: true }).click();
    await page.getByText('원본을 지금 제출할 필요는 없습니다.', { exact: false }).waitFor();
    assert.equal(await page.locator('input[type=file]').count(), 0);
    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await page.unroute('**/api/private/case/documents/status');
    await page.getByRole('button', { name: '병원에 이렇게 말하기', exact: false }).click();
    await page.getByRole('heading', { name: '그대로 말하거나 보여 주세요', exact: true }).waitFor();
    await page.screenshot({ path: resolve('artifacts/private-work', `${label}-advisor-action-390.png`), fullPage: true });
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__advisorCopied = text; } } }); });
    await page.getByRole('button', { name: '문장 복사', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__advisorCopied), await page.locator('.advisor-script-body').first().innerText(), 'copy contains only the delivery script');
    await page.getByRole('button', { name: '문장 편집', exact: true }).click();
    const original = await page.getByLabel('전달할 문장', { exact: true }).inputValue();
    await page.getByLabel('전달할 문장', { exact: true }).fill('synthetic unsaved draft');
    await page.getByRole('button', { name: '문장 복사', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__advisorCopied), 'synthetic unsaved draft');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await page.locator('.advisor-script-body').first().innerText(), original, 'cancel preserves saved or fallback text');
    const scriptBody = page.locator('.advisor-script-body').first();
    await scriptBody.scrollIntoViewIfNeeded();
    const scriptBox = await scriptBody.boundingBox();
    await page.mouse.move(scriptBox.x + 15, scriptBox.y + 15);
    await page.mouse.down();
    try { await page.getByLabel('전달할 문장', { exact: true }).waitFor(); }
    finally { await page.mouse.up(); }
    const longText = ('합성 검토 문장입니다. 필요한 작업과 증상을 직접 설명합니다.\n').repeat(35);
    await page.getByLabel('전달할 문장', { exact: true }).fill(longText);
    await page.getByRole('button', { name: '문장 저장', exact: true }).click();
    await page.getByRole('button', { name: '문장 편집', exact: true }).waitFor();
    const position = await page.locator('.advisor-script').evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, height: el.getBoundingClientRect().height }));
    await page.evaluate(top => window.scrollTo(0, top + 250), position.top);
    const button = await page.getByRole('button', { name: '문장 복사', exact: true }).boundingBox(), card = await page.locator('.advisor-script').boundingBox();
    assert(button.y >= 0 && button.y < 80 && button.y + button.height <= card.y + card.height, 'copy follows page within its card');
    assert.equal(await page.locator('.advisor-script').evaluate(el => getComputedStyle(el).overflowY), 'visible', 'no nested script scrolling');
    await page.getByRole('button', { name: '문장 편집', exact: true }).click();
    await page.getByLabel('전달할 문장', { exact: true }).fill('내가 작성한 합성 문장 ' + label);
    let data = await (await api('private/case')).json();
    const script = data.records.find(r => r.id === 'advisor-hospital-v1-' + data.caseId);
    assert(script, 'edited fallback is stored in existing case records');
    const other = await api('private/case/records/' + script.id, 'PUT', { kind: 'content', revision: script.revision, payload: { ...script.payload, body: '다른 기기의 합성 문장' } });
    assert.equal(other.status(), 200);
    await page.getByRole('button', { name: '문장 저장', exact: true }).click();
    await page.getByRole('heading', { name: '다른 기기의 최신 문장', exact: true }).waitFor();
    assert.equal(await page.getByLabel('전달할 문장', { exact: true }).inputValue(), '내가 작성한 합성 문장 ' + label);
    await page.getByRole('button', { name: '최신 문장 확인 · 내 작성문 유지', exact: true }).click();
    await page.getByRole('button', { name: '문장 저장', exact: true }).click();
    await page.getByRole('button', { name: '문장 편집', exact: true }).waitFor();
    const history = await (await api('private/case/records/' + script.id + '/history')).json();
    assert(history.history.length >= 3, 'content history retained');
    await page.getByRole('button', { name: '← 오늘로 돌아가기', exact: true }).click();
    await page.getByRole('button', { name: '내 상황 알려주기', exact: true }).click();
    // A previously confirmed profile opens at its review; explicitly choose edit.
    if (await page.getByRole('button', { name: '수정할래요', exact: true }).count())
        await page.getByRole('button', { name: '수정할래요', exact: true }).click();
    await page.getByRole('button', { name: '잘 모르겠어요', exact: true }).click();
    await page.getByRole('heading', { name: '지금 회사에 다니고 있나요?', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: '선택할 때마다 저장해요' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '내 상황 알려주기', exact: true }).click();
    await page.getByRole('heading', { name: '지금 회사에 다니고 있나요?', exact: true }).waitFor();
    const profilePath = '**/api/private/case/records/advisor-profile-v1-*';
    await page.route(profilePath, route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'PRIVATE_SERVICE_UNAVAILABLE' }) }) : route.continue());
    await page.getByRole('button', { name: '잘 모르겠어요', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '답변을 저장하지 못했어요' }).waitFor();
    await page.unroute(profilePath);
    await page.getByRole('button', { name: '내 선택 다시 저장', exact: true }).click();
    await page.getByRole('heading', { name: '병원에서 어떤 이야기를 들었나요?', exact: true }).waitFor();
    await page.getByRole('button', { name: '잘 모르겠어요', exact: true }).click();
    await page.getByRole('button', { name: '맞아요 · 답변 저장', exact: true }).click();
    await page.locator('.advisor-primary').waitFor();
    data = await (await api('private/case')).json();
    const profile = data.records.find(r => r.id === 'advisor-profile-v1-' + data.caseId), answers = JSON.parse(profile.payload.body);
    assert.deepEqual(answers.answers, [null, null, null]);
    assert.equal(answers.confirmed, true);
    assert.equal(profile.payload.certainty, 'reported');
    assert.deepEqual(profile.payload.sourceIds, []);
    assert.equal(data.records.filter(r => r.id === profile.id).length, 1, 'repeated answers update one versioned record');
    await page.getByRole('button', { name: '내 상황 알려주기', exact: true }).click();
    await page.getByRole('button', { name: '지금은 나중에 할래요', exact: true }).click();
    await page.locator('.advisor-primary').waitFor();
    await page.getByRole('button', { name: '병원에 이렇게 말하기', exact: false }).waitFor();
    // Restore all-unknown confirmed guidance for the second browser without changing other records.
    data = await (await api('private/case')).json();
    const latest = data.records.find(r => r.id === profile.id);
    const restored = await api('private/case/records/' + profile.id, 'PUT', { kind: 'content', revision: latest.revision, payload: { ...latest.payload, body: JSON.stringify({ ...JSON.parse(latest.payload.body), deferred: false }) } });
    assert.equal(restored.status(), 200);
    await page.getByRole('button', { name: '내 관리함', exact: true }).click();
    await page.getByRole('button', { name: '할 일', exact: true }).click();
    console.log('PRIVATE_ADVISOR_R1_UI_PASS ' + label + ' empty_home_three_tabs_copy_edit_cancel_conflict_persistent_unknown_retry_defer_legacy_access');
}
