import assert from 'node:assert/strict';
import { resolve } from 'node:path';
export async function verifyMaterials(page,ctx,base,label){
  const snapshot=async()=>await(await ctx.request.get(base+'/api/private/case')).json();
  await page.goto(base+'/injury?section=library');
  const input=page.locator('.materials-upload input[type=file]');
  await input.waitFor();
  assert.equal(await input.getAttribute('multiple'),'');
  const fixture=n=>({name:`synthetic-batch-${label}-${n}.pdf`,mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-multi-'+label+'-'+n)});
  let failed=false,registrations=0;
  await page.route('**/api/private/case/documents',async route=>{
    if(route.request().method()==='POST'){
      registrations++;
      if(!failed&&route.request().postDataJSON().filename===fixture('retry').name){failed=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'UPLOAD_RETRY'})});}
    }
    await route.continue();
  });
  const before=await snapshot();
  await input.setInputFiles([fixture('first'),fixture('retry'),fixture('last')]);
  assert.equal((await snapshot()).documents.length,before.documents.length,'selection alone does not create D1 documents');
  await page.getByRole('button',{name:'선택한 3개 파일 보관',exact:true}).click();
  await page.getByRole('status').filter({hasText:'2개 보관 완료 · 1개'}).waitFor();
  assert.equal(await page.locator('[data-upload-state=done]').count(),2);
  const retry=page.locator('[data-upload-state=failed]').filter({hasText:fixture('retry').name});
  await retry.getByRole('button',{name:'재시도',exact:true}).click();
  await page.getByRole('status').filter({hasText:'원본 보관 확인 완료 · 1개'}).waitFor();
  assert.equal(await page.locator('[data-upload-state=done]').count(),3);
  assert.equal(registrations,4,'only failed original is retried');
  await input.setInputFiles(fixture('first'));
  await page.getByRole('button',{name:'선택한 1개 파일 보관',exact:true}).click();
  await page.getByRole('status').filter({hasText:'원본 보관 확인 완료 · 1개'}).waitFor();
  const stored=await snapshot();
  assert.equal(stored.documents.length,before.documents.length+3,'same content is not duplicated');
  assert(stored.documents.filter(d=>d.filename.includes('synthetic-batch-'+label)).every(d=>d.status==='ready'));
  await page.unroute('**/api/private/case/documents');
  await input.setInputFiles({name:'synthetic-invalid.html',mimeType:'text/html',buffer:Buffer.from('<p>synthetic</p>')});
  await page.locator('[data-upload-state=failed]').filter({hasText:'synthetic-invalid.html'}).waitFor();
  assert.equal((await snapshot()).documents.length,stored.documents.length,'invalid type creates no document');
  await page.getByRole('button',{name:'synthetic-invalid.html 선택 해제',exact:true}).click();

  let release,started;
  const held=new Promise(r=>{release=r}), seen=new Promise(r=>{started=r});
  await page.route('**/api/private/case/documents',async route=>{
    if(route.request().method()==='POST'){started();await held;await route.abort('aborted').catch(()=>{});}else await route.continue();
  });
  await input.setInputFiles([fixture('cancel'),fixture('after-cancel')]);
  await page.getByRole('button',{name:'선택한 2개 파일 보관',exact:true}).click();
  await seen;
  await page.getByRole('button',{name:'전송 취소',exact:true}).click();release();
  await page.getByRole('status').filter({hasText:'전송을 멈췄어요. 완료된 원본'}).waitFor();
  assert.equal((await snapshot()).documents.length,stored.documents.length,'cancel keeps completed originals and stops the queue');
  assert.equal(await page.locator('[data-upload-state=cancelled]').count(),1);
  assert.equal(await page.locator('[data-upload-state=waiting]').count(),1);
  await page.unroute('**/api/private/case/documents');
  await page.getByRole('button',{name:fixture('cancel').name+' 선택 해제',exact:true}).click();
  await page.getByRole('button',{name:fixture('after-cancel').name+' 선택 해제',exact:true}).click();

  const composer=page.locator('.notes-composer');
  await composer.locator('summary').click();
  await composer.getByLabel('메모 파일 가져오기',{exact:true}).setInputFiles([
    {name:`synthetic-note-${label}-one.txt`,mimeType:'text/plain',buffer:Buffer.from('Synthetic first memo')},
    {name:`synthetic-note-${label}-two.md`,mimeType:'text/markdown',buffer:Buffer.from('Synthetic second memo')},
  ]);
  await composer.getByLabel('메모 2 내용',{exact:true}).waitFor();
  const beforeNotes=await snapshot();
  assert.equal(beforeNotes.records.length,stored.records.length,'memo files require separate save');
  await composer.getByRole('button',{name:'메모 한 번에 저장',exact:true}).click();
  await composer.getByRole('status').filter({hasText:'메모 2개를 저장했어요'}).waitFor();
  const afterNotes=await snapshot();
  assert.equal(afterNotes.records.length,beforeNotes.records.length+2);
  await composer.locator('summary').click();
  await page.locator('.materials-batch').getByRole('button',{name:'선택 해제',exact:true}).click();
  for(const name of [fixture('first').name,fixture('last').name,`synthetic-note-${label}-one`])await page.getByRole('checkbox',{name:name+' 선택',exact:true}).check();
  let handoffs=0,writes=0;
  const requests=request=>{if(request.url().includes('/handoff'))handoffs++;if(request.url().includes('/api/private/case')&&['POST','PUT','DELETE'].includes(request.method()))writes++;};
  page.on('request',requests);
  await page.getByRole('button',{name:'GPT 분석 요청 한 번에 준비',exact:true}).click();
  await page.getByRole('heading',{name:'요청문이 준비됐어요',exact:true}).waitFor();
  const prompt=await page.getByLabel('분석 요청문',{exact:true}).inputValue();
  for(const text of [fixture('first').name,fixture('last').name,'Synthetic first memo','cbh-analysis/v1'])assert(prompt.includes(text));
  assert.equal(handoffs,2,'one user action verifies both originals');assert.equal(writes,0,'prepare does not write records or transmit to GPT');
  page.off('request',requests);
  assert.deepEqual((await snapshot()).records,afterNotes.records,'preparation preserves all records');
  await page.locator('.analysis-request').getByRole('button',{name:'닫기',exact:true}).click();

  const review=page.locator('.analysis-review');await review.locator('summary').click();
  const source=stored.documents.find(d=>d.filename===fixture('first').name).id;
  const result={version:'cbh-analysis/v1',approved:true,suggestions:[
    {type:'memo',title:'Synthetic reviewed summary '+label,body:'Synthetic source summary',sourceIds:[source]},
    {type:'task',title:'Synthetic reviewed task '+label,body:'Synthetic next action',sourceIds:[source],dueDate:'2026-12-30'},
  ]};
  await review.getByLabel('GPT 분석 결과',{exact:true}).fill(JSON.stringify(result));
  await review.getByRole('button',{name:'내용 확인',exact:true}).click();
  await review.locator('.analysis-proposal').first().waitFor();
  assert.equal((await snapshot()).records.length,afterNotes.records.length,'AI approval field has no authority');
  await review.getByRole('button',{name:'취소',exact:true}).click();
  assert.equal((await snapshot()).records.length,afterNotes.records.length,'review cancellation writes zero');
  await review.getByLabel('GPT 분석 결과',{exact:true}).fill(JSON.stringify(result));
  await review.getByRole('button',{name:'내용 확인',exact:true}).click();
  await review.getByLabel('GPT 분석 결과',{exact:true}).fill('{invalid');
  assert.equal(await review.locator('.analysis-proposal').count(),0,'changed input clears stale approval preview');
  let failSave=true;
  await page.route('**/api/private/case/analysis',async route=>{
    if(failSave){failSave=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'UPLOAD_RETRY'})});}else await route.continue();
  });
  await review.getByLabel('GPT 분석 결과',{exact:true}).fill(JSON.stringify(result));
  await review.getByRole('button',{name:'내용 확인',exact:true}).click();
  await review.getByRole('button',{name:'선택한 2개 새 기록으로 저장',exact:true}).click();
  await review.getByRole('status').filter({hasText:'다른 전송 상태'}).waitFor();
  assert.equal(await review.locator('.analysis-proposal').count(),2,'failed save preserves editable draft');
  assert.equal((await snapshot()).records.length,afterNotes.records.length);
  await review.getByRole('button',{name:'선택한 2개 새 기록으로 저장',exact:true}).click();
  await review.getByRole('status').filter({hasText:'새 기록 2개를 저장했어요'}).waitFor();
  await page.unroute('**/api/private/case/analysis');
  const accepted=await snapshot();
  assert.equal(accepted.records.length,afterNotes.records.length+2);
  for(const r of afterNotes.records)assert.deepEqual(accepted.records.find(n=>n.id===r.id),r,'unrelated history preserved');
  assert.deepEqual(accepted.documents,afterNotes.documents,'analysis never moves or changes originals');
  for(const r of accepted.records.filter(r=>r.payload.title.startsWith('Synthetic reviewed')))assert.equal(r.payload.certainty,'reported');
  await review.getByLabel('GPT 분석 결과',{exact:true}).fill(JSON.stringify(result));
  await review.getByRole('button',{name:'내용 확인',exact:true}).click();
  await review.getByRole('button',{name:'선택한 2개 새 기록으로 저장',exact:true}).click();
  await review.getByRole('status').filter({hasText:'새 기록 0개를 저장했어요'}).waitFor();
  assert.equal((await snapshot()).records.length,accepted.records.length,'repeated approval is idempotent');

  await page.reload();await page.locator('.materials-list').waitFor();
  await page.getByLabel('자료 찾기',{exact:true}).fill('synthetic-batch-'+label);
  for(const width of [375,390,768,1024,1440]){
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'materials width '+width);
    await page.screenshot({path:resolve('artifacts/private-work',`${label}-materials-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.screenshot({path:resolve('artifacts/private-work',`${label}-materials-dark-390.png`),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>delete document.documentElement.dataset.theme);await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'내 관리함',exact:true}).click();
  await page.getByRole('region',{name:'내 관리함 목록'}).waitFor();
  assert.equal(await page.getByLabel('기록 종류',{exact:true}).count(),0,'management starts with tasks, not a record-type form');
  await page.screenshot({path:resolve('artifacts/private-work',`${label}-management-390.png`),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:/준비할 일/}).click();
  await page.getByRole('heading',{name:'Synthetic reviewed task '+label,exact:true}).waitFor();
  await page.getByRole('button',{name:'내 관리함으로',exact:true}).click();
  await page.getByRole('button',{name:/자료·메모/}).click();
  await page.getByRole('heading',{name:'Synthetic reviewed summary '+label,exact:true}).waitFor();
  console.log('PRIVATE_MATERIALS_UI_PASS '+label+' batch_upload_partial_retry_cancel_dedupe_utf8_memos_multi_handoff_draft_review_approval_rollback_replay_5_widths_dark');
}
