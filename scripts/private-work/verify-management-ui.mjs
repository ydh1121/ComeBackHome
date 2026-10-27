import assert from 'node:assert/strict';
import {resolve} from 'node:path';

// Run only against the existing isolated D1 runtime, after policy installation.
export async function verifyManagement(page,ctx,base,label){
  assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'isolated runtime only');
  const snapshot=async()=>await(await ctx.request.get(base+'/api/private/case')).json();
  const before=await snapshot();
  const openCalculator=async()=>{
    await page.goto(base+'/injury?section=payments');
    await page.getByText('기간·예상금액 계산 도구',{exact:true}).click();
    await page.getByText('예상금액·기간 계산',{exact:true}).click();
    return page.locator('.management-estimate');
  };
  await page.route('**/api/private/case',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    const response=await route.fetch(),body=await response.json();
    await route.fulfill({response,json:{...body,policies:[]}});
  });
  let calc=await openCalculator();
  await calc.getByRole('status').filter({hasText:'아직 계산 근거가 준비되지 않았어요'}).waitFor();
  assert(await calc.getByRole('button',{name:'예상 계산',exact:true}).isDisabled());
  assert(await calc.getByLabel('확인한 하루 평균임금 (원)',{exact:true}).isDisabled());
  await page.unroute('**/api/private/case');
  calc=await openCalculator();
  await calc.getByLabel('계산 기준일',{exact:true}).fill('2026-10-24');
  const workPolicy=before.policies.filter(p=>p.key==='work_injury'&&p.status==='effective'&&p.effectiveFrom<='2026-10-24'&&p.effectiveTo>='2026-10-24');
  assert.equal(workPolicy.length,1,'synthetic fixture has one eligible policy');
  assert.equal(await calc.getByLabel('계산 근거',{exact:true}).inputValue(),workPolicy[0].id);
  assert.equal(await calc.locator('.calculation-basis').getAttribute('open'),null,'policy controls stay secondary');
  await calc.getByLabel('확인한 하루 평균임금 (원)',{exact:true}).fill('100000');
  await calc.getByLabel('실제로 일하지 못한 날짜 수',{exact:true}).fill('4');
  await calc.getByRole('button',{name:'예상 계산',exact:true}).click();
  await calc.getByText('280,000원',{exact:true}).waitFor();
  await calc.getByLabel('계산 기준일',{exact:true}).fill('1900-01-01');
  assert.equal(await calc.locator('.calculation-result').count(),0,'changed basis clears stale result');
  assert(await calc.getByRole('button',{name:'예상 계산',exact:true}).isDisabled());
  await calc.getByRole('status').filter({hasText:'선택한 날짜에 맞는 계산 근거가 없어요'}).waitFor();
  await calc.getByLabel('계산 기준일',{exact:true}).fill('2026-10-24');
  await calc.getByText('이런 경우가 있나요?',{exact:true}).click();
  await calc.getByLabel('이 기간에 일을 하거나 임금을 받은 날이 있어요',{exact:true}).check();
  await calc.getByRole('button',{name:'예상 계산',exact:true}).click();
  await calc.getByText('기관에 확인한 뒤 계산할 수 있어요',{exact:true}).waitFor();
  assert.equal(await calc.getByText('아직 계산할 수 없어요',{exact:true}).count(),2,'unknown is not displayed as zero');

  const select=calc.getByLabel('무엇을 알아볼까요?',{exact:true});
  await select.selectOption('unemployment');
  await calc.getByLabel('계산 기준일',{exact:true}).fill('2026-10-24');
  await calc.getByLabel('확인한 하루 평균임금 (원)',{exact:true}).fill('100000');
  await calc.getByLabel('확인한 하루 통상임금 (원)',{exact:true}).fill('90000');
  await calc.getByLabel('고용센터가 정한 날짜 수',{exact:true}).fill('100');
  await calc.getByLabel('계약상 하루 근무시간',{exact:true}).fill('4');
  await calc.getByRole('button',{name:'예상 계산',exact:true}).click();
  await calc.getByText('근무시간에 맞는 계산 기준을 먼저 확인해요',{exact:true}).waitFor();
  await select.selectOption('insurance_window');
  await calc.getByLabel('입사일',{exact:true}).fill('2026-10-01');
  await calc.getByLabel('마지막 근무일',{exact:true}).fill('2026-10-24');
  await calc.getByRole('button',{name:'예상 계산',exact:true}).click();
  await calc.getByText('달력상 재직일',{exact:true}).waitFor();
  await calc.getByText('서류 확인 유급일',{exact:true}).waitFor();
  await select.selectOption('simulation');
  await calc.getByLabel('입사일',{exact:true}).fill('2026-10-01');
  await calc.getByLabel('마지막 근무일',{exact:true}).fill('2026-10-24');
  await calc.locator('input[name=weekday][value="1"]').check();
  await calc.getByRole('button',{name:'예상 계산',exact:true}).click();
  await calc.getByText('가상 직장 유급일',{exact:true}).waitFor();
  await select.selectOption('payroll');
  await calc.getByLabel('계산 기준일',{exact:true}).fill('2026-10-24');
  await calc.getByLabel('확인한 시급 (원)',{exact:true}).fill('12000');
  assert(await calc.getByRole('button',{name:'예상 계산',exact:true}).isDisabled(),'condition review is explicit');
  await calc.getByText('추가 근무·이미 받은 수당 확인',{exact:true}).click();
  await calc.getByLabel('추가 조건을 열어 실제 근무시간·인원·정산 내역을 확인했어요',{exact:true}).check();
  await calc.getByRole('button',{name:'예상 계산',exact:true}).click();
  await calc.getByText('근로조건과 증빙을 먼저 확인해요',{exact:true}).waitFor();
  await select.selectOption('severance');
  await calc.getByLabel('입사일',{exact:true}).fill('2025-10-01');
  await calc.getByLabel('마지막 근무일',{exact:true}).fill('2026-10-24');
  await calc.getByLabel('확인한 하루 평균임금 (원)',{exact:true}).fill('100000');
  await calc.getByLabel('확인한 하루 통상임금 (원)',{exact:true}).fill('90000');
  await calc.getByText('근무 조건·이미 받은 퇴직금·연차 확인',{exact:true}).click();
  await calc.getByLabel('추가 조건을 열어 실제 근무시간·인원·정산 내역을 확인했어요',{exact:true}).check();
  await calc.getByRole('button',{name:'예상 계산',exact:true}).click();
  await calc.getByRole('heading',{name:'입력값 기준 예상',exact:true}).waitFor();
  assert.deepEqual((await snapshot()).records,before.records,'all six estimates preserve records');
  assert.deepEqual((await snapshot()).payments,before.payments,'estimates create no decisions or deposits');
  const assertReadableResults=async()=>{
    const values=await calc.locator('.calculation-result dd').evaluateAll(nodes=>nodes.map(node=>{
      const box=node.getBoundingClientRect(),style=getComputedStyle(node);
      return {text:node.textContent.trim(),width:box.width,height:box.height,lineHeight:parseFloat(style.lineHeight),overflow:node.scrollWidth>node.clientWidth+1};
    }));
    assert(values.length>0,'calculation results are present for readability checks');
    for(const value of values){
      assert(value.width>=180,'result value has readable width: '+JSON.stringify(value));
      assert.equal(value.overflow,false,'result value is not clipped: '+value.text);
      if(/^[\d,]+(?:원|일)$/.test(value.text))assert(value.height<=value.lineHeight*1.2,'numeric result stays on one line: '+JSON.stringify(value));
      else assert(value.height<=value.lineHeight*3.2,'short status does not wrap into a vertical column: '+JSON.stringify(value));
    }
  };
  for(const width of [375,390,768,1024,1440]){
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await assertReadableResults();
    await page.screenshot({path:resolve('artifacts/private-work',`${label}-management-calculation-${width}.png`),fullPage:true,animations:'disabled'});
  }
  const priorTheme=await page.evaluate(()=>({theme:document.documentElement.getAttribute('data-theme'),colorScheme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}));
  for(const theme of ['light','dark']){
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    await page.emulateMedia({colorScheme:theme});
    for(const width of [375,390]){
      await page.setViewportSize({width,height:844});
      await assertReadableResults();
      await calc.locator('.calculation-result').screenshot({path:resolve('artifacts/private-work',`${label}-management-result-${theme}-${width}.png`),animations:'disabled'});
    }
  }
  await page.evaluate(value=>{if(value===null)document.documentElement.removeAttribute('data-theme');else document.documentElement.dataset.theme=value;},priorTheme.theme);
  await page.emulateMedia({colorScheme:priorTheme.colorScheme});
  await page.setViewportSize({width:390,height:844});

  const source=before.documents.find(d=>d.status==='ready');
  assert(source,'synthetic verified original exists');
  const title='Synthetic management claim '+label,sourceTitle='Synthetic management decision '+label;
  const seed=await ctx.request.post(base+'/api/private/case/import',{headers:{Origin:base},data:{version:'cbh-case-seed/v1',approved:true,records:[
    {kind:'benefit_claim',payload:{title,body:'Synthetic claim',certainty:'reported',sourceIds:[],data:{benefitType:'workers_comp_leave',status:'estimate',expectedAmount:500000}}},
    {kind:'content',payload:{title:sourceTitle,body:'Synthetic official source',certainty:'official',sourceIds:[source.id],data:{category:'reference',medium:'none'}}},
  ]}});
  assert(seed.ok(),await seed.text());
  const seeded=await snapshot(),claim=seeded.records.find(r=>r.payload.title===title),evidence=seeded.records.find(r=>r.payload.title===sourceTitle);
  assert(claim&&evidence,'synthetic claim and verified-source record were both imported');
  await page.goto(base+'/injury?section=payments');
  const emptyLedger=page.locator('.payment-workspace article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  for(const field of ['기관에서 정한 금액','실제 들어온 돈','기관이 인정한 날짜 수'])assert.equal(await emptyLedger.locator('dl>div').filter({has:page.getByText(field,{exact:true})}).locator('dd').textContent(),'아직 확인하지 않았어요','missing event is unknown, not zero');
  const entry=page.locator('.payment-entry');await entry.locator(':scope > summary').click();
  const begin=async(type)=>{
    await entry.getByRole('button',{name:type==='decision'?'기관에서 정한 금액':'통장에 들어온 돈',exact:true}).click();
    await entry.getByLabel('어떤 급여에 관한 내용인가요?',{exact:true}).selectOption(claim.id);
    await entry.getByRole('button',{name:'다음',exact:true}).click();
    await entry.getByLabel('확인한 금액 (원)',{exact:true}).fill('123400');
    await entry.getByLabel('통지서·입금 내역의 날짜',{exact:true}).fill('2026-10-24');
    if(type==='decision')assert.equal(await entry.getByLabel('기관이 인정한 날짜 수',{exact:true}).inputValue(),'','unconfirmed recognized days start blank');
    await entry.getByRole('button',{name:'다음',exact:true}).click();
    if(type==='decision')await entry.locator('.payment-review').getByText('일수 확인 필요',{exact:true}).waitFor();
    await entry.getByLabel('이 내용을 확인한 기록',{exact:true}).selectOption(evidence.id);
  };
  await begin('decision');
  assert.deepEqual((await snapshot()).payments,seeded.payments,'review alone writes zero');
  await entry.getByRole('button',{name:'취소',exact:true}).click();
  assert.deepEqual((await snapshot()).payments,seeded.payments,'cancel writes zero');
  await begin('decision');
  let lost=true;const attempts=[];
  await page.route('**/api/private/case/payments',async route=>{
    attempts.push(route.request().postDataJSON());
    if(lost){lost=false;const response=await route.fetch();assert(response.ok(),await response.text());return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'PRIVATE_SERVICE_UNAVAILABLE'})});}
    await route.continue();
  });
  await entry.getByRole('button',{name:'확인한 내역 저장',exact:true}).click();
  await entry.getByRole('alert').filter({hasText:'입력한 내용은 그대로예요'}).waitFor();
  assert.equal((await snapshot()).payments.length,seeded.payments.length+1,'lost response retains committed event');
  await entry.getByRole('button',{name:'확인한 내역 저장',exact:true}).click();
  await entry.getByRole('status').filter({hasText:'내역을 저장했어요'}).waitFor();
  assert.equal(attempts[0].reference,attempts[1].reference,'retry keeps the draft reference');
  assert.equal((await snapshot()).payments.length,seeded.payments.length+1,'retry does not duplicate the decision');
  await page.unroute('**/api/private/case/payments');
  await begin('deposit');
  await entry.getByRole('button',{name:'확인한 내역 저장',exact:true}).click();
  await entry.getByRole('status').filter({hasText:'내역을 저장했어요'}).waitFor();
  const saved=await snapshot(),events=saved.payments.filter(e=>e.claim_id===claim.id);
  assert.equal(events.length,2,'separate deposit is not merged with the same amount decision');
  assert.deepEqual(events.map(e=>e.event_type).sort(),['decision','deposit']);
  assert.deepEqual(saved.records,seeded.records,'ledger entry does not alter claims or sources');
  for(const old of seeded.payments)assert.deepEqual(saved.payments.find(p=>p.id===old.id),old);
  const ledger=page.locator('.payment-workspace article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await ledger.getByText('일수 확인 필요',{exact:true}).first().waitFor();
  assert.equal(await ledger.locator('dl>div').filter({has:page.getByText('기관이 인정한 날짜 수',{exact:true})}).locator('dd').textContent(),'일수 확인 필요','legacy zero is not displayed as a known zero day count');
  assert.equal(await ledger.locator('dl>div').filter({has:page.getByText('남은 날짜 수',{exact:true})}).locator('dd').textContent(),'아직 계산되지 않았어요');
  await ledger.locator('summary').click();
  const depositText=await ledger.locator('details p').filter({hasText:'통장에 들어온 돈'}).textContent();
  assert(!/0일/.test(depositText),'a deposit has no recognized-day label');
  await entry.getByText('이전 내역을 정정하거나 돈을 돌려줬어요',{exact:true}).click();
  await entry.getByRole('button',{name:'돌려준 돈',exact:true}).click();
  await entry.getByRole('button',{name:'다음',exact:true}).click();
  await entry.getByLabel('확인한 금액 (원)',{exact:true}).fill('1000');
  await entry.getByRole('button',{name:'다음',exact:true}).click();
  await entry.getByLabel('이 내용을 확인한 기록',{exact:true}).selectOption(evidence.id);
  const oldEvents=await entry.getByLabel('바로잡을 이전 내역',{exact:true}).locator('option').allTextContents();
  assert.equal(oldEvents.length,2,'refund selector contains only its prior deposit');
  await entry.getByRole('button',{name:'취소',exact:true}).click();
  assert.deepEqual((await snapshot()).payments,saved.payments,'cancelled correction preserves the ledger');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve('artifacts/private-work',`${label}-management-payments-390.png`),fullPage:true,animations:'disabled'});
  // One-off benefit types never require a day count; only the read fixture varies.
  let fixtureType='medical_expense';
  await page.route('**/api/private/case',async route=>{
    const response=await route.fetch(),body=await response.json();
    await route.fulfill({response,json:{...body,records:body.records.map(r=>r.id===claim.id?{...r,payload:{...r.payload,data:{...r.payload.data,benefitType:fixtureType}}}:r)}});
  });
  for(const type of ['medical_expense','disability','severance']){
    fixtureType=type;await page.goto(base+'/injury?section=payments');
    await entry.locator(':scope > summary').click();
    await entry.getByLabel('어떤 급여에 관한 내용인가요?',{exact:true}).selectOption(claim.id);
    await entry.getByRole('button',{name:'다음',exact:true}).click();
    assert.equal(await entry.locator('input[name=days]').count(),0,type+' has no irrelevant day input');
    assert.equal(await ledger.getByText('기관이 인정한 날짜 수',{exact:true}).count(),0,type+' has no irrelevant ledger day row');
    await entry.getByRole('button',{name:'취소',exact:true}).click();
  }
  await page.unroute('**/api/private/case');
  assert.deepEqual((await snapshot()).records,saved.records,'benefit display fixtures do not change stored records');
  assert.deepEqual((await snapshot()).payments,saved.payments,'display and cancellation do not change stored events');
  await page.goto(base+'/injury?section=payments');
  console.log('PRIVATE_MANAGEMENT_UI_PASS '+label+' six_calculators_no_writes_explicit_review_lost_response_replay_preserved_ledger');
}
