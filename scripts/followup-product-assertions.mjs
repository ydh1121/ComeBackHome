import assert from 'node:assert/strict';
export async function verifyFollowupUi({ page, api, id, base, todayKst }) {
  const open = async path => {
    await page.waitForLoadState('networkidle');
    await page.goto(base + path, {waitUntil:'domcontentloaded'});
  };
  await page.setViewportSize({width:375,height:812});
  await open('/people/'+id);
  await page.locator('[data-page="PersonDetailPage"][data-state="DETAIL"]').waitFor();
  assert.equal(await page.getByRole('region',{name:'출발지',exact:true}).count(),1);
  assert.equal(await page.getByRole('region',{name:'도착지',exact:true}).count(),1);
  assert.equal(await page.getByRole('region',{name:'주로 오는 길',exact:true}).count(),1);
  assert.ok(await page.locator('[data-transit-mode="BUS"]').count());
  assert.ok(await page.locator('[data-transit-mode="SUBWAY"]').count());
  assert.ok(await page.locator('[data-transit-mode="WALKING"]').count());
  assert.equal(await page.getByRole('region',{name:'도착지',exact:true}).locator('[data-transit-mode="SUBWAY"] svg').evaluate(el=>getComputedStyle(el).color),'rgb(164, 157, 135)','official RGB Line 9 color');
  assert.equal(await page.getByRole('region',{name:'주로 오는 길',exact:true}).locator('[data-transit-mode="SUBWAY"] svg').evaluate(el=>getComputedStyle(el).color),'rgb(102, 112, 133)','unknown line fallback');
  const width = await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(width.scroll<=width.viewport,'mobile UI overflow');
  const before=(await api('/people/'+id+'/commute?kind=origin')).body.preferredRouteCandidateId;
  assert.ok(before);
  await api('/people/'+id+'/commute/preferred-route','PUT',{routeCandidateId:'nonexistent-synthetic-route'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('저장한 경로를 확인할 수 없습니다. 경로 설정에서 다시 선택해 주세요.').waitFor();
  assert.equal(await page.locator('.route-line-row').count(),0,'stale preference must not become first route');
  await api('/people/'+id+'/commute/preferred-route','PUT',{routeCandidateId:before});

  const historyDate=new Date(Date.parse(todayKst+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const prior=(await api('/people/'+id+'/schedules')).body.schedules;
  await api('/people/'+id+'/schedules','PUT',{schedules:[{id:crypto.randomUUID(),personId:id,date:historyDate,enabled:true,start:'03:10',end:'04:20'}]});
  await open('/schedule');await page.locator('[data-page="SchedulePage"] .schedule-history-toggle').waitFor();
  assert.equal(await page.locator('.schedule-day-card').filter({hasText:'03:10'}).count(),0);
  await page.getByRole('button',{name:'과거 일정 보기',exact:true}).click();
  await page.locator('.schedule-day-card').filter({hasText:'03:10'}).waitFor();
  await page.getByRole('button',{name:'과거 일정 숨기기',exact:true}).click();
  assert.ok((await api('/people/'+id+'/schedules')).body.schedules.some(row=>row.date===historyDate),'history must remain in D1');
  assert.ok(prior.length,'baseline schedule missing');
  const midnightContext = await page.context().browser().newContext({storageState:await page.context().storageState(),serviceWorkers:'block'});
  const midnight = await midnightContext.newPage();
  await midnight.clock.install({time:new Date(todayKst+'T23:59:58+09:00')});
  await midnight.clock.pauseAt(new Date(todayKst+'T23:59:59+09:00'));
  await midnight.goto(base+'/schedule',{waitUntil:'domcontentloaded'});
  await midnight.locator('.schedule-day-card[data-date="'+todayKst+'"]').waitFor();
  await midnight.clock.runFor(2200);
  assert.equal(await midnight.locator('.schedule-day-card[data-date="'+todayKst+'"]').count(),0,'KST midnight hides yesterday without deleting');
  await midnightContext.close();

  await open('/');await page.locator('.departure-estimate').waitFor();
  assert.ok((await page.locator('.big-time').innerText()).includes('–'),'ETA range is missing');
  assert.equal(await page.locator('[data-page="TodayPage"]').getAttribute('data-state'),'WORKING','no fabricated departure');
  await open('/notifications');
  const reminder=page.getByRole('button',{name:'예상 도착 10분 전에',exact:true});await reminder.waitFor();
  const initial=await reminder.getAttribute('aria-pressed');await reminder.click();
  await page.waitForFunction(wanted=>document.querySelector('.rule')?.getAttribute('aria-pressed')===wanted,initial==='true'?'false':'true');
  assert.equal((await api('/notifications/settings')).body.settings.arrivalAdvanceEnabled,initial!=='true');
  await reminder.click();

  await open('/settings');await page.locator('[data-page="SettingsPage"]').waitFor();
  assert.equal(await page.getByRole('button',{name:'iPhone 시계 알람',exact:true}).count(),0,'deferred manual Clock bridge must not be offered in Settings');
  await open('/settings/alarms');
  await page.locator('[data-page="SettingsPage"]').waitFor();
  assert.equal(await page.locator('[data-page="AlarmPage"]').count(),0,'production route must not expose deferred Clock actions');

  // A real File input cancellation and retry. Delay read without mocking the
  // application action; abort must prevent any late review publication.
  await open('/import');await page.locator('input[accept=".xlsx"]').waitFor();
  await page.evaluate(()=>{
    const original=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=async function(){await new Promise(r=>setTimeout(r,1000));return original.call(this);};
  });
  await page.locator('input[accept=".xlsx"]').setInputFiles({name:'cancel-fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic invalid workbook')});
  await page.getByRole('button',{name:'가져오기 취소',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'취소'}).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('input[accept=".xlsx"]').inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'인식 결과 보기'}).isDisabled(),true);
  await page.locator('input[accept=".xlsx"]').setInputFiles({name:'cancel-fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic invalid workbook')});
  await page.getByRole('alert').filter({hasText:'일정을 인식하지 못했습니다.'}).waitFor();
  assert.equal(await page.locator('input[accept=".xlsx"]').inputValue(),'');
  await page.locator('input[accept=".xlsx"]').setInputFiles({name:'leave-fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic invalid workbook')});
  await page.getByRole('button',{name:'가져오기 취소',exact:true}).waitFor();
  await open('/');
  await page.locator('[data-page="TodayPage"][data-state="WORKING"]').waitFor();
  await open('/import');
  await page.locator('input[accept=".xlsx"]').waitFor();
  assert.equal(await page.getByRole('button',{name:'인식 결과 보기'}).isDisabled(),true,'page exit cancels unfinished import');
  await open('/');
  await page.locator('[data-page="TodayPage"][data-state="WORKING"]').waitFor();
  return {mobileSvg:true,preferredOnly:true,historyPreserved:true,etaRange:true,arrivalRuleD1:true,manualClockExcluded:true,cancelAndRetry:true};
}

// Reference-only browser coverage runs against Vite DEV with the same isolated D1.
export async function verifyClockReferenceUi({page,base}) {
  await page.goto(base+'/settings/alarms',{waitUntil:'domcontentloaded'});await page.locator('[data-page="AlarmPage"]').waitFor();
  assert.equal(await page.locator('[data-page="AlarmPage"]').getAttribute('data-device-applied'),'false');
  assert.equal(await page.getByRole('button',{name:'단축어에서 확인하고 적용'}).isDisabled(),true);
  // No real shortcut URL is opened: only the generated contract is inspected.
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'알람 데이터 다운로드'}).click();
  const download=await downloadPromise;assert.equal(download.suggestedFilename(),'ComeBackHome-clock-plan.json');
  await page.getByText('단축어 설정 방법',{exact:true}).click();
  const guidePromise=page.waitForEvent('popup');
  await page.getByRole('link',{name:'단축어 만들기: 액션 순서와 입력값'}).click();
  const guide=await guidePromise;
  await guide.getByRole('heading',{name:'iPhone 시계 알람 단축어 만들기',exact:true}).waitFor();
  await guide.setViewportSize({width:360,height:780});
  assert.equal(await guide.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'setup guide fits mobile viewport');
  assert.ok((await guide.locator('body').innerText()).includes('clock-ledger.json'));
  assert.ok((await guide.locator('body').innerText()).includes('실기기에서 아직 검증하지 않았습니다'));
  await guide.close();

  return {alarmContractOnly:true,alarmReceiverGuide:true};
}
