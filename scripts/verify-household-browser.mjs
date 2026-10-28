import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer, preview } from 'vite';
import { chromium, webkit } from 'playwright';

// Product UI, with synthetic authenticated API responses and real domain
// transitions. This suite does not establish live Sheets/iPhone/Push acceptance.
const output = resolve('artifacts/household');
await mkdir(output, { recursive: true });
const modelServer = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
const domain = await modelServer.ssrLoadModule('/src/modules/household/domain/model.ts');
const server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 18876, strictPort: true } });
const base = 'http://127.0.0.1:18876';
const stamp = '2026-10-28T09:00:00.000Z';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABgAAAAmCAIAAABRZcxyAAAAK0lEQVR4nGM0iGpioAZgooopowaNGjRq0KhBowaNGjRq0KhBowaNGkQGAAD87AFYIn1XYAAAAABJRU5ErkJggg==', 'base64');
let assertions = 0;
const check = (actual, expected, note) => { assert.deepEqual(actual, expected, note); assertions++; };
const evidence = [];
let activePage;
async function visible(locator) { await locator.waitFor({ state: 'visible' }); assertions++; }
async function noDialog(page) { await page.getByRole('dialog').waitFor({ state: 'hidden' }); }
async function setSection(page, label) { await page.getByRole('navigation', { name: '생활비·할 일 메뉴' }).getByRole('link', { name: label, exact: true }).click(); }
async function settleNavigation(page) {
  await page.waitForFunction(()=>{
    const bars=[...document.querySelectorAll('.portal-nav')];
    return bars.length>0&&bars.every(bar=>{
      const pill=bar.querySelector('.portal-pill'),active=bar.querySelector('[aria-current="page"]');
      if(!pill||!active||pill.getAnimations().some(animation=>animation.playState==='running'||animation.pending))return false;
      const p=pill.getBoundingClientRect(),a=active.getBoundingClientRect();
      return ['x','y','width','height'].every(key=>Math.abs(p[key]-a[key])<=1);
    });
  });
}
async function screenshot(page,file) { await settleNavigation(page);await page.screenshot({path:resolve(output,file),animations:'disabled'}); }
async function layout(page, width, label) {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(()=>window.scrollTo(0,0));
  await settleNavigation(page);
  const bounds = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height } : null; };
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1, top:rect('.portal-top'), bottom:rect('.portal-bottom'), heading:rect('.household-page h1'), actions:rect('.hh-card-detail .hh-actions'), pills:[...document.querySelectorAll('.portal-nav')].map(bar=>{const p=bar.querySelector('.portal-pill').getBoundingClientRect(),a=bar.querySelector('[aria-current="page"]').getBoundingClientRect();return ['x','y','width','height'].every(key=>Math.abs(p[key]-a[key])<=1);}) };
  });
  check(bounds.overflow, false, `${label}: no horizontal overflow at ${width}`);
  assert(bounds.top && bounds.bottom && bounds.top.x >= 0 && bounds.top.right <= width + 1 && bounds.bottom.x >= 0 && bounds.bottom.right <= width + 1, `${label}: fixed navigation stays in viewport`); assertions++;
  assert(bounds.heading && bounds.heading.y >= bounds.top.bottom - 1, `${label}: title stays below top navigation`); assertions++;
  check(bounds.pills,[true,true],`${label}: selected pills align within 1px after motion at ${width}`);
  if(bounds.actions&&width<=390){assert(bounds.actions.bottom<=bounds.bottom.y,`${label}: card actions stay above bottom navigation at ${width}`);assertions++;}
}
try {
  for (const [engine, name] of [[chromium,'chromium'],[webkit,'webkit']]) {
    const browser = await engine.launch({ headless:true });
    let state = domain.createHouseholdState(), ready=false, initializeFailure=true, initializeAttempts=0, getFailure=false, nextFailure=null, rejectRead=false, deferRead=false, releaseRead=null, deferredArrived=null;
    const commands=[], applied=[], failures=[], contexts=[];
    const response = () => ({ ready, connected:true, snapshot:ready?state:null, revision:state.revision, pending:false, spreadsheetUrl:ready?'https://docs.google.com/spreadsheets/d/synthetic-household-private/edit':null });
    const makeContext = async role => {
      const context = await browser.newContext({ viewport:{width:390,height:844}, timezoneId:'Asia/Seoul', locale:'ko-KR', serviceWorkers:'block' }); contexts.push(context);
      const identity = { logged:true, role }, user = () => ({ id:identity.role+'-browser',loginId:identity.role==='admin'?'ydh1121':'yvonne',role:identity.role,mustChangePassword:false });
      const traffic = { documents:0, sessions:0, scheduleWrites:0 };
      await context.addInitScript(fixed => {
        const NativeDate=Date; class SyntheticDate extends NativeDate { constructor(...args) { super(...(args.length?args:[fixed])); } static now(){return new NativeDate(fixed).getTime();} }
        window.Date=SyntheticDate;
      },stamp);
      await context.route('**/*',route=>{
        if(route.request().resourceType()==='document')traffic.documents++;
        return new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient');
      });
      await context.route('**/api/**',async route=>{
        const req=route.request(), url=new URL(req.url()), path=url.pathname;
        const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'private, no-store'},body:JSON.stringify(body)});
        if(path==='/api/auth/session'){traffic.sessions++;return json({enabled:true,user:identity.logged?user():null,legacyAccess:'write'});}
        if(path==='/api/auth/logout'||path==='/api/auth/logout-all'){identity.logged=false;return json({ok:true});}
        if(path==='/api/auth/preferences')return json({shortcutVisible:true});
        if(path==='/api/auth/devices')return json({devices:[]});
        if(!identity.logged)return json({error:'LOGIN_REQUIRED'},401);
        if(path.startsWith('/api/people')&&req.method()!=='GET')traffic.scheduleWrites++;
        if(path==='/api/people'&&req.method()==='GET')return json({people:[]});
        if(path==='/api/private/household'&&req.method()==='GET'){
          if(rejectRead)return json({error:'HOUSEHOLD_ACCESS_REQUIRED'},403);
          if(getFailure)return route.abort('failed');
          if(deferRead){deferRead=false;const captured=structuredClone(response());deferredArrived?.();await new Promise(done=>{releaseRead=done;});return json(captured);}
          return json(response());
        }
        if(path==='/api/private/household/initialize'){initializeAttempts++;if(initializeFailure)return json({error:'HOUSEHOLD_SHEETS_ACCESS_REQUIRED'},503);ready=true;return json(response());}
        if(path==='/api/private/household/recover')return json(response());
        if(path==='/api/private/household/events'){
          const command=req.postDataJSON();commands.push(structuredClone(command));
          if(nextFailure==='conflict'){
            nextFailure=null;
            state=domain.applyHouseholdCommand(state,{id:crypto.randomUUID(),expectedRevision:state.revision,event:{type:'preferences.save',preferences:{...state.preferences}}},'other-browser',stamp);
          }
          try {
            const before=state.revision;
            state=domain.applyHouseholdCommand(state,command,user().id,stamp);
            if(before!==state.revision)applied.push(command);
            if(nextFailure==='lost-response'){nextFailure=null;return json({error:'HOUSEHOLD_WRITE_PENDING'},503);}
            return json(response());
          } catch(error) { return json({error:'HOUSEHOLD_'+error.code},error.code==='REVISION_CONFLICT'?409:400); }
        }
        if(/^\/api\/private\/household\/cards\/[^/]+\/art$/.test(path))return req.method()==='POST'?json({imageFileId:'synthetic-art-'+state.cards[0].id}):route.fulfill({status:200,contentType:'image/png',body:png});
        if(path==='/api/private/household/push-subscription')return json({registered:false});
        if(path==='/api/private/case/consent')return json({owner:true,adminAccess:true,consent:null});
        if(path==='/api/private/case')return json({caseId:'synthetic-case',owner:true,actors:[],records:[],policies:[],documents:[],payments:[],deadlines:[],overlaps:[]});
        if(path.startsWith('/api/private/case/'))return json({items:[],requests:[],content:[],connected:false,configured:false,folderSelected:false});
        if(path==='/api/notifications/client-key')return json({configured:false,publicKey:null});
        failures.push(req.method()+' '+path);return json({error:'UNEXPECTED_SYNTHETIC_ROUTE'},404);
      });
      return {context,identity,traffic};
    };
    try {
      const member=await makeContext('member'),page=await member.context.newPage(); activePage=page;
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/household'); await visible(page.getByRole('button',{name:'가계부 시작하기',exact:true}));
      check(state.revision,0,'opening page does not write household');
      await page.getByRole('button',{name:'가계부 시작하기',exact:true}).click();
      const setupGuide=page.getByRole('link',{name:'시트 연결 안내 보기',exact:true});
      await visible(setupGuide);check(await setupGuide.getAttribute('href'),'/guides/household-drive-setup.html','initialization Sheets failure shows actionable setup guide');
      const passiveRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/private/household'&&r.request().method()==='GET');
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await passiveRead;
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      check(await setupGuide.isVisible(),true,'passive not-ready refresh preserves initialization setup guide');
      check(initializeAttempts,1,'passive refresh does not retry initialization or write');
      check(state.revision,0,'failed initialization and passive refresh do not write household records');
      initializeFailure=false;await page.getByRole('button',{name:'가계부 시작하기',exact:true}).click();await visible(page.getByRole('heading',{name:'가계부',exact:true}));
      check(await setupGuide.count(),0,'successful initialization clears setup guide');
      check(await page.getByRole('alert').count(),0,'successful initialization clears setup error');
      await setSection(page,'카드'); await page.getByRole('button',{name:'첫 카드 추가',exact:true}).click();
      let dialog=page.getByRole('dialog');
      await dialog.getByLabel('카드 이름',{exact:true}).fill('테스트 카드 A');
      await dialog.locator('input[name=limit]').fill('100000'); await dialog.locator('input[name=remaining]').fill('60000');
      await dialog.getByRole('button',{name:'세로형',exact:true}).click(); await dialog.getByRole('button',{name:'카드 저장',exact:true}).click();await noDialog(page);
      check(domain.getCardSummary(state,state.cards[0].id).remaining,60000,'initial remaining is independently entered');
      check(state.cards[0].orientation,'portrait','portrait card preserved');
      await page.locator('.hh-upload-label input[type=file]').setInputFiles({name:'synthetic-card.png',mimeType:'image/png',buffer:png});
      await page.locator('.hh-card-art img').waitFor();
      await page.waitForFunction(()=>{const image=document.querySelector('.hh-card-art img');return image instanceof HTMLImageElement&&image.complete&&image.naturalWidth===24;});assertions++;
      await page.getByRole('button',{name:'사용 기록',exact:true}).click(); dialog=page.getByRole('dialog');
      await dialog.locator('input[name=amount]').fill('12000'); await dialog.locator('select:has(option[value="식비"])').selectOption('식비');
      await dialog.getByText('어디서 썼는지 자세히 적기',{exact:true}).click();
      await dialog.getByLabel('가게·상대방',{exact:true}).fill('합성 식당');await dialog.getByLabel('세부 분류',{exact:true}).fill('한식');
      await dialog.getByRole('button',{name:'기록 저장',exact:true}).click();await noDialog(page);
      check(domain.getCardSummary(state,state.cards[0].id).remaining,48000,'purchase changes card capacity');
      check(state.entries.filter(e=>e.kind==='expense'&&!e.voidedAt).length,1,'card purchase creates one ledger expense');
      await page.getByRole('button',{name:'상환 기록',exact:true}).click(); dialog=page.getByRole('dialog');await dialog.locator('input[name=amount]').fill('20000');await dialog.getByRole('button',{name:'기록 저장',exact:true}).click();await noDialog(page);
      check(domain.getCardSummary(state,state.cards[0].id).remaining,68000,'repayment restores capacity');
      check(domain.summarizeLedger(state,'2026-10-01','2026-11-01').netExpense,12000,'repayment is not another expense');
      await setSection(page,'가계부');await visible(page.getByRole('heading',{name:'가계부',exact:true}));
      await page.getByRole('slider',{name:'보기 상세 수준'}).focus();await page.keyboard.press('End');
      await visible(page.getByRole('figure',{name:'세부 지출'}));
      await page.getByRole('button',{name:'기록',exact:true}).click(); dialog=page.getByRole('dialog');await dialog.locator('input[name=amount]').fill('-1');
      const beforeInvalid=commands.length;await dialog.getByRole('button',{name:'기록 저장',exact:true}).click();check(commands.length,beforeInvalid,'negative amount blocked before network write');
      await dialog.locator('input[name=amount]').fill('3000'); nextFailure='lost-response';
      await dialog.getByRole('button',{name:'기록 저장',exact:true}).click();await visible(dialog.getByRole('alert')); const retryId=commands.at(-1).id;
      await dialog.getByRole('button',{name:'기록 저장',exact:true}).click();await noDialog(page);
      check(commands.at(-1).id,retryId,'ambiguous save retries the original command ID');
      check(state.entries.filter(e=>e.amount===3000&&!e.voidedAt).length,1,'lost response does not duplicate expense');
      await setSection(page,'월급');await page.getByRole('button',{name:'들어온 돈 기록',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('input[name=amount]').fill('200000');await dialog.getByRole('button',{name:'기록 저장',exact:true}).click();await noDialog(page);
      await page.getByRole('button',{name:'분배 계획 세우기',exact:true}).click();dialog=page.getByRole('dialog');
      await dialog.getByLabel('생활비 금액',{exact:true}).fill('100000');await dialog.getByLabel('저축 금액',{exact:true}).fill('50000');await dialog.getByRole('button',{name:'분배 계획 저장',exact:true}).click();await noDialog(page);
      check(domain.getSalaryPlan(state,'2026-10').unallocatedFromPlan,50000,'allocation calculator');
      check(domain.summarizeLedger(state,'2026-10-01','2026-11-01').netExpense,15000,'allocation does not become spending');
      // The other existing account edits the same income, using the actual UI.
      const admin=await makeContext('admin'),other=await admin.context.newPage();await other.goto(base+'/household?section=ledger');
      await other.locator('.hh-ledger-row').filter({hasText:'수입'}).click();await other.getByRole('button',{name:'내용 수정',exact:true}).click();
      await other.getByRole('dialog').locator('input[name=amount]').fill('210000');await other.getByRole('button',{name:'수정 내용 저장',exact:true}).click();await noDialog(other);
      check(state.entries.find(e=>e.kind==='income'&&!e.voidedAt)?.updatedBy,'admin-browser','both accounts can edit shared income');
      check(state.entries.filter(e=>e.kind==='income'&&!e.voidedAt).length,1,'income correction preserves one effective entry');
      await other.close();await page.reload();await visible(page.getByRole('heading',{name:'월급 나누기',exact:true}));
      await setSection(page,'할 일');await page.getByLabel('새 할 일이나 메모',{exact:true}).fill('합성 할 일');await page.getByRole('button',{name:'메모 남기기',exact:true}).click();
      await visible(page.locator('.hh-note__body').filter({hasText:'합성 할 일'}));await page.locator('.hh-note__body').filter({hasText:'합성 할 일'}).click();dialog=page.getByRole('dialog');
      await dialog.getByRole('switch',{name:'이 시간에 둘에게 알리기',exact:true}).click();await dialog.getByRole('button',{name:'메모 저장',exact:true}).click();await noDialog(page);
      check(state.todos[0].remind,true,'explicit shared todo reminder');assert(state.todos[0].dueAt);assertions++;
      await page.getByRole('button',{name:'합성 할 일 완료',exact:true}).click();await visible(page.getByText('완료한 일 1개',{exact:true}));check(Boolean(state.todos[0].completedAt),true,'completion saved');
      await page.getByText('완료한 일 1개',{exact:true}).click();await page.getByRole('button',{name:'합성 할 일 다시 할 일로 옮기기',exact:true}).click();await visible(page.getByRole('button',{name:'합성 할 일 완료',exact:true}));
      await page.getByRole('button',{name:'가계부 설정',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('switch',{name:'매일 밤 12시에 가계부 기록 알림',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[role="switch"][aria-checked="true"]')?.textContent?.includes('매일 밤'));
      check(state.preferences.dailyLedgerReminder,true,'shared midnight preference saved without sending a push');await dialog.getByRole('button',{name:'닫기',exact:true}).click();await noDialog(page);
      // Keep input on a genuine revision conflict; the subsequent save uses the refreshed revision.
      await page.getByLabel('새 할 일이나 메모',{exact:true}).fill('충돌 뒤 유지할 합성 메모');nextFailure='conflict';await page.getByRole('button',{name:'메모 남기기',exact:true}).click();await visible(page.getByRole('alert'));
      check(await page.getByLabel('새 할 일이나 메모',{exact:true}).inputValue(),'충돌 뒤 유지할 합성 메모','conflict retains user draft');await page.getByRole('button',{name:'메모 남기기',exact:true}).click();
      await visible(page.locator('.hh-note__body').filter({hasText:'충돌 뒤 유지할 합성 메모'}));
      // Start a background read, then save before that old response arrives.
      const started=new Promise(done=>{deferredArrived=done;});deferRead=true;
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await started;
      await page.getByLabel('새 할 일이나 메모',{exact:true}).fill('늦은 조회 뒤에도 유지할 합성 메모');await page.getByRole('button',{name:'메모 남기기',exact:true}).click();
      await visible(page.locator('.hh-note__body').filter({hasText:'늦은 조회 뒤에도 유지할 합성 메모'}));
      const readFinished=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/private/household'&&r.request().method()==='GET');releaseRead();await readFinished;
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      check(await page.locator('.hh-note__body').filter({hasText:'늦은 조회 뒤에도 유지할 합성 메모'}).count(),1,'late old GET cannot roll back a confirmed write');
      for(const [section,title] of [['카드','카드'],['가계부','가계부'],['월급','월급 나누기'],['할 일','할 일·메모']]){
        await setSection(page,section);await visible(page.getByRole('heading',{name:title,exact:true}));
        for(const width of [375,390,768,1024,1440])await layout(page,width,`${name}-${section}`);
        await page.setViewportSize({width:390,height:844});await screenshot(page,`${name}-${section==='카드'?'cards':section==='가계부'?'ledger':section==='월급'?'income':'notes'}-390.png`);
      }
      await setSection(page,'가계부');await page.setViewportSize({width:1440,height:900});await screenshot(page,`${name}-ledger-1440.png`);
      await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      await screenshot(page,`${name}-ledger-dark-375.png`);
      check(await page.locator('.portal-pill').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s','reduced motion removes navigation movement');
      await page.evaluate(()=>delete document.documentElement.dataset.theme);await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
      // Module navigation must retain the shared shell and authenticated session.
      // Compare the actual DOM node, not a marker that could survive a reload in storage.
      const persistentHeader=await page.locator('.portal-top').elementHandle(), beforeNavigation={...member.traffic};
      assert(persistentHeader);assertions++;
      const shellPersists=async note=>{
        check(await persistentHeader.evaluate(node=>node.isConnected&&node===document.querySelector('.portal-top')),true,note+': same header DOM node');
        check(member.traffic.documents,beforeNavigation.documents,note+': no full document navigation');
        check(member.traffic.sessions,beforeNavigation.sessions,note+': no repeated authentication request');
      };
      const favorite=page.getByRole('button',{name:'즐겨찾는 기능 열기',exact:true});const box=await favorite.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await visible(page.getByRole('region',{name:'즐겨찾는 기능',exact:true}));await page.mouse.up();
      await page.getByRole('region',{name:'즐겨찾는 기능'}).getByRole('link',{name:'메모 남기기',exact:true}).click();await visible(page.getByRole('heading',{name:'할 일·메모',exact:true}));
      await page.waitForFunction(()=>document.querySelector('.hh-note-compose textarea')===document.activeElement);
      check(await page.getByLabel('새 할 일이나 메모',{exact:true}).evaluate(el=>el===document.activeElement),true,'favorite opens focused quick capture');
      await shellPersists('favorite navigation');
      await page.getByRole('navigation',{name:'공간 선택',exact:true}).getByRole('link',{name:'산재',exact:true}).click();await visible(page.getByRole('heading',{name:'산재 도우미',exact:true}));
      check(await page.getByRole('navigation',{name:'공간 선택',exact:true}).getByRole('link',{name:'산재',exact:true}).getAttribute('aria-current'),'page','top module navigation changes module');
      await shellPersists('injury module navigation');
      await page.goBack();await visible(page.getByRole('heading',{name:'할 일·메모',exact:true}));await shellPersists('browser back');
      await page.goForward();await visible(page.getByRole('heading',{name:'산재 도우미',exact:true}));await shellPersists('browser forward');
      await page.getByRole('navigation',{name:'공간 선택',exact:true}).getByRole('link',{name:'일정',exact:true}).click();await visible(page.locator('[data-page="TodayPage"][data-state="NO_SCHEDULE_TODAY"]'));
      check(await page.getByRole('navigation',{name:'주요 탐색',exact:true}).getByRole('link').allTextContents(),['오늘','일정','가져오기','사람'],'accepted schedule navigation remains intact');
      await shellPersists('schedule module entry');
      await page.getByRole('navigation',{name:'주요 탐색',exact:true}).getByRole('link',{name:'일정',exact:true}).click();await visible(page.locator('[data-page="SchedulePage"][data-state="EMPTY"]'));await shellPersists('existing schedule route');
      await page.getByRole('navigation',{name:'주요 탐색',exact:true}).getByRole('link',{name:'오늘',exact:true}).click();await visible(page.locator('[data-page="TodayPage"][data-state="NO_SCHEDULE_TODAY"]'));await shellPersists('existing schedule return');
      check(member.traffic.scheduleWrites,0,'module switching never mutates existing schedule data');
      await page.getByRole('navigation',{name:'공간 선택',exact:true}).getByRole('link',{name:'생활비·할 일',exact:true}).click();await visible(page.getByRole('heading',{name:'가계부',exact:true}));
      await shellPersists('return to household');await persistentHeader.dispose();
      check(await page.getByRole('navigation',{name:'생활비·할 일 메뉴'}).getByRole('link').allTextContents(),['카드','가계부','월급','할 일'],'household bottom navigation is independent');
      getFailure=true;await page.reload();await visible(page.getByText('최근 저장한 내용',{exact:true}));
      await setSection(page,'할 일');check(await page.getByLabel('새 할 일이나 메모',{exact:true}).isDisabled(),true,'offline cached snapshot is read-only');
      getFailure=false;await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.hh-cache-banner'));
      check(await page.getByLabel('새 할 일이나 메모',{exact:true}).isEnabled(),true,'fresh confirmed snapshot restores editing');
      check(await page.getByRole('alert').count(),0,'successful refresh clears a transient read error');
      await page.getByRole('button',{name:'가계부 설정',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('switch',{name:'이 기기에 최근 내용 보관',exact:true}).click();
      check(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cbh.household.cache.'))),false,'cache OFF erases private local copy');
      await dialog.getByRole('switch',{name:'이 기기에 최근 내용 보관',exact:true}).click();await dialog.getByRole('button',{name:'최신 내용 불러오기',exact:true}).click();await page.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith('cbh.household.cache.')));
      await dialog.getByRole('button',{name:'닫기',exact:true}).click();await noDialog(page);
      rejectRead=true;await page.reload();await visible(page.getByRole('alert'));
      check(await page.locator('.hh-note__body').count(),0,'authorization failure hides cached private content');
      check(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cbh.household.cache.'))),false,'authorization failure purges cached private content');
      rejectRead=false;await page.getByRole('button',{name:'다시 확인',exact:true}).click();await visible(page.getByRole('heading',{name:'할 일·메모',exact:true}));
      await page.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith('cbh.household.cache.')));
      await page.goto(base+'/account');await page.getByRole('button',{name:'현재 기기 로그아웃',exact:true}).click();await visible(page.getByText('내 계정으로 로그인',{exact:true}));
      check(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cbh.household.cache.'))),false,'logout clears cached household data');
      check(errors,[],'no uncaught browser runtime errors');check(failures,[],'all private UI requests covered explicitly');
      evidence.push({engine:name,widths:[375,390,768,1024,1440],screenshots:6,commands:commands.length,appliedCommands:applied.length,provider:'synthetic API with actual domain transitions',livePush:0,liveSheets:0,status:'PASS'});
    }catch(error){await activePage?.screenshot({path:resolve(output,`${name}-failure.png`),fullPage:true}).catch(()=>{});console.error('HOUSEHOLD_FAILURE',name,await activePage?.locator('body').innerText().catch(()=>''));throw error;}
    finally{for(const context of contexts)await context.close();await browser.close();}
  }
  const result={status:'PASS',assertions,evidence};await writeFile(resolve(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await new Promise(resolve=>server.httpServer.close(resolve));await modelServer.close();}
