import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { specialistAnalysisFixture } from './materials-ui-fixtures.mjs';
export async function verifyMaterials(page,ctx,base,label,shared){
  try { await verifyMaterialsFlow(page,ctx,base,label,shared); }
  catch(error) {
    await page.screenshot({path:resolve('artifacts/private-work',`${label}-materials-failure.png`),fullPage:true,mask:[page.locator('.analysis-connection textarea')]}).catch(()=>{});
    throw error;
  }
}
async function verifyMaterialsFlow(page,ctx,base,label,shared){
  const snapshot=async()=>await(await ctx.request.get(base+'/api/private/case')).json();
  await page.goto(base+'/injury?section=library');
  const input=page.locator('.materials-upload input[type=file]');
  await input.waitFor();
  const choose=async files=>{
    await page.waitForFunction(()=>document.querySelector('.materials-upload input[type=file]')?.disabled===false);
    await input.setInputFiles(files);
  };
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
  await choose([fixture('first'),fixture('retry'),fixture('last')]);
  assert.equal((await snapshot()).documents.length,before.documents.length,'selection alone does not create D1 documents');
  await page.getByRole('button',{name:'선택한 3개 파일 보관',exact:true}).click();
  await page.getByRole('status').filter({hasText:'2개 보관 완료 · 1개'}).waitFor();
  assert.equal(await page.locator('[data-upload-state=done]').count(),2);
  const retry=page.locator('[data-upload-state=failed]').filter({hasText:fixture('retry').name});
  await retry.getByRole('button',{name:'재시도',exact:true}).click();
  await page.getByRole('status').filter({hasText:'원본 보관 확인 완료 · 1개'}).waitFor();
  assert.equal(await page.locator('[data-upload-state=done]').count(),3);
  assert.equal(registrations,4,'only failed original is retried');
  await choose(fixture('first'));
  await page.getByRole('button',{name:'선택한 1개 파일 보관',exact:true}).click();
  await page.getByRole('status').filter({hasText:'원본 보관 확인 완료 · 1개'}).waitFor();
  const stored=await snapshot();
  assert.equal(stored.documents.length,before.documents.length+3,'same content is not duplicated');
  assert(stored.documents.filter(d=>d.filename.includes('synthetic-batch-'+label)).every(d=>d.status==='ready'));
  await page.unroute('**/api/private/case/documents');
  await choose({name:'synthetic-invalid.html',mimeType:'text/html',buffer:Buffer.from('<p>synthetic</p>')});
  await page.locator('[data-upload-state=failed]').filter({hasText:'synthetic-invalid.html'}).waitFor();
  assert.equal((await snapshot()).documents.length,stored.documents.length,'invalid type creates no document');
  await page.getByRole('button',{name:'synthetic-invalid.html 선택 해제',exact:true}).click();

  let release,started;
  const held=new Promise(r=>{release=r}), seen=new Promise(r=>{started=r});
  await page.route('**/api/private/case/documents',async route=>{
    if(route.request().method()==='POST'){started();await held;await route.abort('aborted').catch(()=>{});}else await route.continue();
  });
  await choose([fixture('cancel'),fixture('after-cancel')]);
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
  await page.waitForFunction(()=>document.querySelectorAll('.notes-composer textarea').length===2 || (!!document.querySelector('.notes-composer [role=status]')?.textContent && !document.querySelector('.notes-composer [role=status]')?.textContent.includes('읽는 중')));
  assert.equal(await composer.locator('textarea').count(),2,'memo files loaded: '+await composer.locator('[role=status]').textContent());
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
  const exchangeResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/private/case/documents/chat-exchanges'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'ChatGPT에 물어보기 준비',exact:true}).click();
  const exchange=await(await exchangeResponse).json();
  await page.getByRole('heading',{name:'ChatGPT에 전달해 주세요',exact:true}).waitFor();
  await page.getByText('요청문 내용 보기',{exact:true}).click();
  const prompt=await page.getByLabel('분석 요청문',{exact:true}).inputValue();
  for(const text of [fixture('first').name,fixture('last').name,'Synthetic first memo','cbh-analysis/v1'])assert(prompt.includes(text));
  assert.equal(handoffs,2,'one user action verifies both originals');assert.equal(writes,1,'prepare creates only the private Drive mailbox metadata, never business records or GPT API requests');
  page.off('request',requests);
  assert.deepEqual((await snapshot()).records,afterNotes.records,'preparation preserves all records');
  await page.locator('.analysis-request').getByRole('button',{name:'닫기',exact:true}).click();

  const driveSource=stored.documents.find(d=>d.filename===fixture('first').name).id;
  const bridgeResult={version:'cbh-analysis/v2',suggestions:[{type:'memo',title:'Synthetic Drive answer '+label,body:'Synthetic source review',sourceIds:[driveSource]}]};
  const answerText='Synthetic shared Drive answer '+label;
  const fixtureAnswer=await ctx.request.post(base+'/__test/chat-response',{data:{id:new URL(exchange.url).pathname.split('/')[3],answer:answerText,result:bridgeResult}});
  assert.equal((await fixtureAnswer.json()).ok,true,'synthetic ChatGPT writes same app-owned private Doc');
  const exchangeRow=page.locator('[data-chat-request="'+exchange.id+'"]');
  await exchangeRow.getByRole('button',{name:'답변 확인',exact:true}).click();
  await page.locator('.chat-answer .record-body').filter({hasText:answerText}).waitFor();
  assert.deepEqual((await snapshot()).records,afterNotes.records,'reading Drive answer stages receipt but writes zero business records');
  if(shared){
    const previous=shared.memberPage.url();
    await shared.memberPage.goto(base+'/injury?section=library');
    await shared.memberPage.getByRole('button',{name:'답변 보기',exact:true}).click();
    assert.equal(await shared.memberPage.getByRole('button',{name:'ChatGPT에 물어보기 준비',exact:true}).count(),0,'member uploads and reads without owner-only ChatGPT preparation controls');
    const sharedRow=shared.memberPage.locator('[data-chat-request="'+exchange.id+'"]');
    await sharedRow.getByRole('button',{name:'답변 읽기',exact:true}).click();
    await shared.memberPage.locator('.chat-answer .record-body').filter({hasText:answerText}).waitFor();
    const memberState=await(await shared.memberContext.request.get(base+'/api/private/case')).json();
    assert.deepEqual(memberState.records,afterNotes.records,'second account reads same answer without automatic approval');
    await shared.memberPage.goto(previous);
    await shared.memberPage.getByLabel('관리자의 읽기·수정 허용').waitFor();
  }
  await page.getByRole('button',{name:'추가할 내용 확인',exact:true}).click();
  const review=page.locator('.analysis-review');
  await review.locator('.analysis-proposal').filter({hasText:bridgeResult.suggestions[0].title}).waitFor();
  assert.deepEqual((await snapshot()).records,afterNotes.records,'Drive proposal preview requires explicit separate approval');
  await review.getByRole('button',{name:'취소',exact:true}).click();
  if(await review.getAttribute('open')===null)await review.locator(':scope > summary').click();
  const manual=review.locator('.analysis-manual');
  if(await manual.getAttribute('open')===null)await manual.locator(':scope > summary').click();

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

  // A JSON file can populate every specialist area without turning a draft into
  // an official decision. Reading or previewing it must not write anything.
  const chooseAnalysisFile=async file=>{
    // setInputFiles can bypass a disabled native picker. A save message appears
    // before its data reload finishes; wait for the same ready state a user needs.
    await page.waitForFunction(()=>document.querySelector('.analysis-review input[type=file]')?.disabled===false);
    await review.getByLabel('분석 결과 파일 가져오기',{exact:true}).setInputFiles(file);
  };
  const specialized=specialistAnalysisFixture(label,source);
  await chooseAnalysisFile({name:'synthetic-analysis.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(specialized))});
  await page.waitForFunction(()=>{const panel=document.querySelector('.analysis-review');return !!panel?.querySelector('textarea')?.value&&!panel?.querySelector('input[type=file]')?.disabled&&(panel.querySelector('.analysis-proposal')||panel.querySelector('[role=status]')?.textContent);});
  assert.equal(await review.locator('.analysis-proposal').count(),3,'specialist JSON preview: '+await review.getByRole('status').textContent());
  await review.locator('.analysis-proposal').filter({hasText:'Synthetic exposure draft '+label}).waitFor();
  assert.equal((await snapshot()).records.length,accepted.records.length,'JSON file preview writes zero');
  assert(await review.locator('.analysis-fields').filter({hasText:'기록 대상일'}).textContent());
  assert(await review.locator('.analysis-fields').filter({hasText:'직장 이름'}).textContent());
  const parentChoice=review.locator('.analysis-proposal').filter({hasText:'Synthetic employment draft '+label}).filter({has:page.locator('.auth-check strong', {hasText:'Synthetic employment draft '+label})}).getByRole('checkbox');
  const childChoice=review.locator('.analysis-proposal').filter({hasText:'Synthetic linked paid day '+label}).getByRole('checkbox');
  await parentChoice.uncheck();
  assert.equal(await childChoice.isChecked(),false,'deselecting parent also deselects dependent draft');
  await childChoice.check();
  assert.equal(await parentChoice.isChecked(),true,'selecting child also selects its parent');
  assert(await review.getByText(/분석 제안에서 보류한 정보/).count(),'official-looking AI field is visibly held for review');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'structured review fits mobile');
  await page.screenshot({path:resolve('artifacts/private-work',`${label}-analysis-specialist-review-390.png`),fullPage:true,animations:'disabled'});
  await review.getByRole('button',{name:'선택한 3개 새 기록으로 저장',exact:true}).click();
  await review.getByRole('status').filter({hasText:'새 기록 3개를 저장했어요'}).waitFor();
  const specializedSaved=await snapshot();
  const exposure=specializedSaved.records.find(r=>r.payload.title==='Synthetic exposure draft '+label);
  assert.equal(exposure.kind,'exposure');assert.equal(exposure.payload.certainty,'reported');
  assert.equal(exposure.payload.data.diagnosisStatus,'unknown');
  const savedEmployment=specializedSaved.records.find(r=>r.payload.title==='Synthetic employment draft '+label);
  assert.equal(savedEmployment.kind,'employment');
  const savedDay=specializedSaved.records.find(r=>r.payload.title==='Synthetic linked paid day '+label);
  assert.equal(savedDay.payload.data.employmentId,savedEmployment.id,'new specialist records are linked within the atomic batch');
  assert.equal(savedDay.payload.data.verification,'estimated');
  assert.deepEqual(specializedSaved.payments,accepted.payments,'specialist proposals create no ledger event');
  await chooseAnalysisFile({name:'synthetic-bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await review.getByRole('status').filter({hasText:'형식이나 연결 원본'}).waitFor();
  assert.equal(await review.locator('.analysis-proposal').count(),0,'invalid file clears stale preview');

  // Optional API-capable analysis tools can return a bounded draft. The inbox
  // still requires an authenticated user to review and explicitly save it.
  const inbox=page.locator('.analysis-receipts');
  await page.locator('.materials-advanced > summary').click();
  await inbox.locator(':scope > summary').click();
  const createReceipt=inbox.getByRole('button',{name:'선택한 자료의 답변 받을 연결 만들기',exact:true});
  await page.waitForFunction(()=>{const buttons=[...document.querySelectorAll('.analysis-receipts button')];return buttons.some(b=>b.textContent==='선택한 자료의 답변 받을 연결 만들기'&&!b.disabled);});
  const createdResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/private/case/analysis-receipts'&&response.request().method()==='POST');
  await createReceipt.click();
  const created=await createdResponse,createdBody=await created.json();
  assert.equal(created.status(),201,'receipt creation status/error: '+JSON.stringify({status:created.status(),error:typeof createdBody.error==='string'&&/^[A-Z_]+$/.test(createdBody.error)?createdBody.error:undefined}));
  assert.equal(await inbox.locator('label[for="analysis-connection-info"]').textContent(),'연결 정보','connection input has an explicit stable accessible label');
  await inbox.getByLabel('연결 정보',{exact:true}).waitFor();
  const connection=JSON.parse(await inbox.getByLabel('연결 정보',{exact:true}).inputValue());
  await inbox.locator('summary').click();
  await inbox.getByLabel('연결 정보',{exact:true}).waitFor({state:'detached'});
  assert.equal(await inbox.getByLabel('연결 정보',{exact:true}).count(),0,'closing optional connection removes the one-time secret from DOM');
  await inbox.locator('summary').click();
  const fromTool={version:'cbh-analysis/v2',suggestions:[{type:'task',title:'Synthetic received task '+label,body:'Synthetic explicitly reviewed return',sourceIds:[source]}]};
  const received=await ctx.request.post(connection.url,{headers:connection.headers,data:fromTool});
  assert.equal(received.status(),202,'bearer grants staging only');
  assert.deepEqual((await snapshot()).records,specializedSaved.records,'external receipt writes no business record');
  await page.waitForFunction(()=>[...document.querySelectorAll('.analysis-receipts button')].some(b=>b.textContent==='받은 답변 확인'&&!b.disabled));
  const inboxResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/private/case/analysis-receipts'&&response.request().method()==='GET');
  await inbox.getByRole('button',{name:'받은 답변 확인',exact:true}).click();
  const refreshed=await inboxResponse;assert.equal(refreshed.status(),200);
  const receiptRows=(await refreshed.json()).receipts;
  const oldReceipt=receiptRows.find(row=>row.id!==createdBody.id&&row.status==='received'&&row.id.length==='analysis-receipt-'.length+36);
  if(label==='webkit'&&oldReceipt){
    const previousResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/private/case/analysis-receipts/'+oldReceipt.id&&response.request().method()==='GET');
    await inbox.locator('[data-analysis-receipt="'+oldReceipt.id+'"]').getByRole('button',{name:'답변 가져와 검토',exact:true}).click();
    const previousBody=await(await previousResponse).json();
    assert.equal(previousBody.stale,true,'prior browser session receipt remains invalid');
    assert.equal(previousBody.result,null,'invalid receipt cannot expose an applicable draft');
    await inbox.getByRole('status').filter({hasText:'자료를 다시 선택해 새 요청을 준비해 주세요.'}).waitFor();
    assert.equal(await review.locator('.analysis-proposal').count(),0,'old receipt does not become a current proposal');
  }
  const currentRow=inbox.locator('[data-analysis-receipt="'+createdBody.id+'"]');
  assert((await currentRow.textContent()).includes(fixture('first').name),'inbox identifies the selected original names');
  const detailResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/private/case/analysis-receipts/'+createdBody.id&&response.request().method()==='GET');
  await currentRow.getByRole('button',{name:'답변 가져와 검토',exact:true}).click();
  const detail=await detailResponse;assert.equal(detail.status(),200);
  const detailBody=await detail.json();assert.equal(detailBody.stale,false);
  assert.equal(detailBody.result.suggestions[0].title,fromTool.suggestions[0].title,'review loads this request, not an older received row');
  await review.locator('.analysis-proposal').filter({hasText:'Synthetic received task '+label}).waitFor();
  assert.deepEqual((await snapshot()).records,specializedSaved.records,'loading inbox result still writes zero business records');
  await review.getByRole('button',{name:'선택한 1개 새 기록으로 저장',exact:true}).click();
  await review.getByRole('status').filter({hasText:'새 기록 1개를 저장했어요'}).waitFor();
  assert.equal((await snapshot()).records.filter(r=>r.payload.title==='Synthetic received task '+label).length,1);
  await inbox.locator('summary').click();
  await inbox.getByLabel('연결 정보',{exact:true}).waitFor({state:'detached'});
  assert.equal(await inbox.getByLabel('연결 정보',{exact:true}).count(),0,'closing optional connection removes the one-time secret from DOM');

  const sourceNote=(await snapshot()).records.find(r=>r.payload.title===`synthetic-note-${label}-one`);
  const changedNote=await ctx.request.put(base+'/api/private/case/records/'+sourceNote.id,{headers:{Origin:base},data:{kind:sourceNote.kind,revision:sourceNote.revision,payload:{...sourceNote.payload,body:sourceNote.payload.body+'\nSynthetic edit after analysis'}}});
  assert.equal(changedNote.status(),200);
  await exchangeRow.getByRole('button',{name:'답변 읽기',exact:true}).click();
  await page.locator('.chat-answers [role=status]').filter({hasText:'자료가 바뀌었어요'}).waitFor();
  assert.equal(await page.locator('.chat-answer').count(),0,'changed source hides the stale Drive answer');
  console.log('PRIVATE_CHAT_DRIVE_UI_PASS '+label+' app_owned_doc_shared_accounts_plain_answer_no_auto_write_source_change_block');
  await page.getByRole('button',{name:'자료 올리기',exact:true}).click();
  const beforeOrganization=await snapshot();
  const organize=page.locator('.materials-organize');
  await organize.locator('summary').click();
  const organization=organize.getByRole('article',{name:'원본 폴더 정리',exact:true});
  await organization.waitFor();
  assert.equal(await organization.getByLabel('보관할 분야',{exact:true}).count(),2,'category names exclude the option text');
  assert(await organization.getByRole('combobox').evaluateAll(selects=>selects.every(select=>select.labels?.length===1&&select.labels[0].textContent==='보관할 분야')),'every category select has an explicit stable label');
  await organization.getByLabel('보관할 분야',{exact:true}).first().selectOption('medical');
  await organization.getByLabel('보관할 분야',{exact:true}).last().selectOption('employment');
  assert.deepEqual((await snapshot()).documents,beforeOrganization.documents,'folder preview moves no original');
  let orgRelease,orgStarted,organizationRequests=0;
  const orgHeld=new Promise(resolve=>{orgRelease=resolve;}),orgSeen=new Promise(resolve=>{orgStarted=resolve;});
  await page.route('**/api/private/case/documents/organize',async route=>{
    organizationRequests++;orgStarted();await orgHeld;await route.abort('aborted').catch(()=>{});
  });
  await organization.getByRole('button',{name:'선택한 파일 2개 정리',exact:true}).click();
  await orgSeen;
  await organization.getByRole('button',{name:'정리 중지',exact:true}).click();orgRelease();
  await organization.getByRole('status').filter({hasText:'정리를 중지했어요. 이미 이동한 원본'}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.materials-organize button')].some(button=>button.textContent==='미완료 2개 다시 확인'&&!button.disabled));
  assert.equal(organizationRequests,1,'stopping organization never starts the next file request');
  assert.deepEqual((await snapshot()).documents,beforeOrganization.documents,'stopping before provider dispatch preserves every original');
  await page.unroute('**/api/private/case/documents/organize');
  await organization.getByRole('button',{name:'미완료 2개 다시 확인',exact:true}).click();
  await organization.getByRole('status').filter({hasText:'선택한 원본을 비공개 보관 폴더 안에서 정리했어요.'}).waitFor();
  const organized=await snapshot();
  for(const original of beforeOrganization.documents){
    const current=organized.documents.find(d=>d.id===original.id);
    for(const key of ['id','filename','bytes','sha256','status'])assert.equal(current[key],original[key],'organization preserves original '+key);
  }
  assert.equal(organized.documents.length,beforeOrganization.documents.length);
  assert.deepEqual(organized.records,beforeOrganization.records,'folder organization does not change business records');
  const download=await ctx.request.get(base+'/api/private/case/documents/'+source+'/download');
  assert.equal(download.status(),200,'organized original remains downloadable');
  const handoff=await ctx.request.get(base+'/api/private/case/documents/'+source+'/handoff');
  assert.equal(handoff.status(),200,'organized original still verifies for analysis');
  await page.screenshot({path:resolve('artifacts/private-work',`${label}-materials-organized-390.png`),fullPage:true,animations:'disabled'});
  await organize.locator('summary').click();

  // The unified library must retain creation of every former document record kind.
  const create=page.locator('.materials-record-create');
  await create.locator('summary').click();
  const legacyKinds=[
    ['agency_request','기관에 요청한 서류','서류·기관 회신',null],
    ['exposure','몸 상태·일한 내용','건강·업무부담 기록','기록 대상일'],
    ['incident','회사와 나눈 대화','회사 대화·분쟁 기록','발생일'],
    ['content','안내·연락처·전달문','안내·메시지',null],
  ];
  for(const [kind,action,heading,dateLabel] of legacyKinds){
    const previous=await snapshot();
    await create.getByRole('button',{name:action,exact:true}).click();
    const editor=page.getByRole('dialog');
    await editor.getByRole('heading',{name:heading+' 추가',exact:true}).waitFor();
    await editor.getByLabel('제목',{exact:true}).fill('Synthetic cancelled '+kind+' '+label);
    page.once('dialog',dialog=>dialog.accept());
    await editor.getByRole('button',{name:'취소',exact:true}).click();
    await editor.waitFor({state:'hidden'});
    assert.deepEqual((await snapshot()).records,previous.records,kind+' cancellation preserves records');
    await create.getByRole('button',{name:action,exact:true}).click();
    const title='Synthetic library '+kind+' '+label;
    await editor.getByLabel('제목',{exact:true}).fill(title);
    await editor.getByLabel('본문·메모',{exact:true}).fill('Synthetic retained record creation');
    if(dateLabel)await editor.getByLabel(dateLabel+' *',{exact:true}).fill('2026-10-28');
    await editor.getByRole('button',{name:'저장',exact:true}).click();
    await editor.waitFor({state:'hidden'});
    const current=await snapshot(),record=current.records.find(r=>r.payload.title===title);
    assert.equal(current.records.length,previous.records.length+1);
    assert.equal(record?.kind,kind,'original record kind is preserved');
    for(const old of previous.records)assert.deepEqual(current.records.find(r=>r.id===old.id),old);
  }

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
  for(const theme of ['light','dark']){
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    assert.equal(await page.locator('.management-row').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','navigation rows must not inherit the filled primary action style');
    await page.screenshot({path:resolve('artifacts/private-work',`${label}-management-${theme}-390.png`),fullPage:true,animations:'disabled'});
  }
  await page.evaluate(()=>delete document.documentElement.dataset.theme);
  await page.screenshot({path:resolve('artifacts/private-work',`${label}-management-390.png`),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:/준비할 일/}).click();
  await page.getByRole('heading',{name:'Synthetic reviewed task '+label,exact:true}).waitFor();
  await page.getByRole('button',{name:'내 관리함으로',exact:true}).click();
  await page.getByRole('button',{name:/자료·메모/}).click();
  await page.getByRole('heading',{name:'Synthetic reviewed summary '+label,exact:true}).waitFor();
  console.log('PRIVATE_MATERIALS_UI_PASS '+label+' batch_upload_partial_retry_cancel_dedupe_utf8_memos_multi_handoff_draft_review_approval_rollback_replay_5_widths_dark');
}
