import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {makeWeeklyXlsx} from '../test/fixtures/import/anonymous-weekly-xlsx-builder.mjs';

// Invoked by the existing Phase B runner: real product, isolated local D1,
// synthetic staff only. No external OCR calls or private-image artifacts.
export async function verifyScheduleRefresh({page,api,origin,engine,settleReads}) {
  const created=await api('/people','POST',{name:'화면검증'+engine,relation:'합성'});
  assert.equal(created.status,201);
  const person=created.body.person;
  await page.evaluate(id=>localStorage.setItem('cbh:selected-person-id',id),person.id);
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00+09:00'));
  await mkdir('.artifacts/ux-refresh',{recursive:true});
  const shot=async name=>{await page.locator('.page-reveal[aria-busy="false"]').waitFor();await page.screenshot({path:'.artifacts/ux-refresh/'+engine+'-'+name+'.png',fullPage:true,animations:'disabled'});};
  const open=async path=>{await settleReads();await page.goto(origin+path,{waitUntil:'networkidle'});await settleReads();};
  const dates=start=>Array.from({length:7},(_,i)=>new Date(Date.parse(start+'T00:00:00Z')+86400000*i).toISOString().slice(0,10));
  const latest=async()=>(await api('/people/'+person.id+'/schedules/latest-import')).body.latestImport;
  const firstWeek=dates('2026-10-19'),nextWeek=dates('2026-10-26');
  const upload=async week=>{
    const source=[
      ['업무',...Array.from({length:21},(_,i)=>i%3===0?'주간 '+Math.floor(i/3):null)],
      [null,...Array.from({length:21},(_,i)=>i%3===0?week[Math.floor(i/3)]:null)],
      ['직원',...Array.from({length:21},(_,i)=>['출근','퇴근','쉬는시간'][i%3])],
      [person.name,...Array.from({length:21},(_,i)=>i>=18?null:[9.5,18.5,0.5][i%3])],
      ['미등록합성직원',...Array.from({length:21},(_,i)=>[10,19,1][i%3])],
    ];
    await open('/import');
    await page.locator('input[accept=".xlsx"]').setInputFiles({name:'synthetic-roster.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(makeWeeklyXlsx(source))});
    await page.getByRole('button',{name:'인식 결과 보기'}).click();
    await page.locator('[data-page="ImportPersonMatchPage"]').waitFor();
    assert.equal(await page.locator('.mapping-row').nth(1).locator('select').inputValue(),'__ignore__');
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.locator('[data-page="ImportReviewPage"]').waitFor();
    assert.equal(await page.locator('[data-page="ImportStructurePage"]').count(),0);
    assert.equal(await page.locator('.import-review-item').count(),7,'only included employee');
    assert.equal(await page.locator('.review-row input:checked').count(),6,'valid shifts selected by default');
    const blank=page.locator('.import-review-item').last();
    assert.equal(await blank.locator('.review-row input').isChecked(),false,'blank is never silently OFF');
    await blank.locator('.review-edit > summary').click();
    await blank.getByRole('checkbox',{name:'휴무로 변경',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.review-row input:checked').length===7);
    await blank.locator('.review-edit > summary').click();
    await page.locator('button.cta:enabled').waitFor();
  };
  await page.setViewportSize({width:390,height:844});
  await upload(firstWeek);
  assert.equal(await latest(),null,'unapproved upload cannot be current roster');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForURL(/\/schedule$/);
  const first=await latest();
  assert.deepEqual(first.dates,firstWeek);
  await page.locator('.roster-row').nth(6).waitFor();
  assert.equal(await page.locator('.roster-row').count(),7,'no three-day truncation');
  await api('/people/'+person.id+'/schedules','PUT',{schedules:[{id:crypto.randomUUID(),personId:person.id,date:'2026-11-20',enabled:true,start:'06:00',end:'15:00'}]});
  await upload(nextWeek);
  assert.equal((await latest()).id,first.id,'new preview does not change current roster');
  for(const width of [360,390]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'review fits '+width);
    const heights=await page.locator('.import-review-item').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
    assert.ok(heights.every(height=>height<160),'collapsed rows remain compact, not vertically fragmented');
    await shot('review-'+width);
  }
  await page.route('**/api/workbooks/approved-import',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic import outage"}'}));
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal((await latest()).id,first.id,'failed save does not advance current roster');
  await page.unroute('**/api/workbooks/approved-import');
  let posts=0;
  await page.route('**/api/workbooks/approved-import',async route=>{if(route.request().method()==='PUT') posts++;await route.continue();});
  await page.evaluate(()=>{const button=document.querySelector('button.cta');button.click();button.click();});
  await page.waitForURL(/\/schedule$/);
  assert.equal(posts,1,'one explicit gesture batch despite duplicate click');
  await page.unroute('**/api/workbooks/approved-import');
  assert.deepEqual((await latest()).dates,nextWeek);
  const newest=await latest();
  await upload(firstWeek);
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForURL(/\/schedule$/);
  assert.equal((await latest()).id,newest.id,'older upload does not replace newer work dates');
  await page.waitForLoadState('networkidle');
  await settleReads();await page.reload({waitUntil:'networkidle'});await settleReads();
  await page.locator('.roster-row').nth(6).waitFor();
  assert.deepEqual(await page.locator('.roster-row').evaluateAll(rows=>rows.map(row=>row.dataset.date)),nextWeek);
  assert.equal(await page.locator('.roster-row[data-date="2026-11-20"]').count(),0,'manual date outside latest upload stays in history');
  await shot('schedule');
  await page.getByRole('button',{name:'월별 이력',exact:false}).click();
  await page.locator('[data-page="ScheduleHistoryPage"]').waitFor();
  await page.getByLabel('조회 월').fill('2026-10');
  assert.equal(await page.locator('[data-date="2026-10-19"]').getAttribute('data-schedule-state'),'WORK');
  assert.equal(await page.locator('[data-date="2026-10-25"]').getAttribute('data-schedule-state'),'OFF');
  assert.equal(await page.locator('[data-date="2026-10-01"]').getAttribute('data-schedule-state'),'UNREGISTERED');
  await shot('history');
  await page.locator('.schedule-cell[data-date="2026-10-19"]').click();
  await page.locator('[data-page="ScheduleDayEditPage"]').waitFor();
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForURL(/\/schedule\/history\?month=2026-10$/);
  assert.equal(await page.getByLabel('조회 월').inputValue(),'2026-10','history edit returns to the same month');
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00+09:00'));
  await open('/schedule/history');
  assert.equal(await page.locator('[data-date="2026-10-19"]').getAttribute('data-schedule-state'),'WORK','past work does not become OFF');
  await open('/schedule');
  assert.equal(await page.locator('.roster-row').count(),6,'past imported date hidden without deleting');
  assert.equal((await api('/people/'+person.id+'/schedules')).body.schedules.length,15);
  await open('/');
  await page.locator('.today-meta').first().waitFor();
  assert.ok((await page.locator('.today-meta').first().innerText()).includes('09:30'),'today start visible');
  const sizes=await page.locator('.today-meta b').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));
  assert.ok(sizes.every(size=>size>=24),'today start/end and next dates remain readable in two columns');
  assert.ok((await page.getByRole('button',{name:'설정',exact:true}).locator('svg').boundingBox()).width>=26,'settings icon visible');
  await shot('today');
  await open('/notifications');
  await page.locator('[data-page="NotificationSetupPage"] button.rule').first().waitFor();
  assert.equal(await page.locator('[data-page="NotificationSetupPage"] button.rule').count(),2);
  await shot('notifications');
  await open('/settings');
  assert.equal(await page.getByRole('button',{name:'퇴근 · 귀가 기록 연결',exact:true}).count(),0);
  return {latestReceiptAcrossReload:true,fullRoster:true,unknownPeopleSkipped:true,compactMobileReview:true,defaultShifts:true,blankExplicitOnly:true,approvalOnly:true,failedSaveUnchanged:true,duplicateSaveOnce:true,monthlyHistory:true,missingNotOff:true,pastWorkPreserved:true,todayStart:true,readableTimes:true};
}
