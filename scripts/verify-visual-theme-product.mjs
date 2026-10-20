import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeWeeklyXlsx} from '../test/fixtures/import/anonymous-weekly-xlsx-builder.mjs';
import {verifyIOSTopClearance} from './verify-ios-top-clearance.mjs';

// Synthetic data and isolated D1 only; shared Phase B runner owns the server.
export async function verifyVisualTheme({page,api,origin,engine,settleReads}) {
  const dir='.artifacts/ux-refresh'; await mkdir(dir,{recursive:true});
  const open=async path=>{await settleReads();await page.goto(origin+path,{waitUntil:'networkidle'});await settleReads();};
  const created=await api('/people','POST',{name:'테마검증'+engine,relation:'합성',phone:'01000000000',birthday:{calendar:'solar',month:3,day:18,leapMonth:false}});
  assert.equal(created.status,201); const id=created.body.person.id;
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00+09:00'));
  const days=Array.from({length:7},(_,i)=>'2026-10-'+(19+i));
  assert.equal((await api('/people/'+id+'/schedules','PUT',{schedules:days.map((date,i)=>({id:crypto.randomUUID(),date,enabled:i!==2&&i!==6,start:'09:30',end:'20:00',breakMinutes:60}))})).status,200);
  for(const kind of ['origin','destination']){
    assert.equal((await api('/people/'+id+'/places/'+kind,'PUT',{label:'합성 '+kind,address:{road:'합성 도로'},coordinate:{x:127.035,y:37.505},providerPlaceId:'synthetic-'+kind})).status,200);
    const point=kind==='origin'?{name:'합성역 9호선',line:undefined}:{name:'합성역',line:'2호선 / 신림선'};
    assert.equal((await api('/people/'+id+'/commute/access/'+kind,'PUT',{id:crypto.randomUUID(),providerId:'visual-'+kind,mode:'SUBWAY',selected:true,...point})).status,200);
  }
  await page.evaluate(id=>localStorage.setItem('cbh:selected-person-id',id),id);
  await page.setViewportSize({width:390,height:844});
  await open('/settings');
  const choose=async(label,theme)=>{await page.getByRole('radio',{name:label,exact:true}).check();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);};
  await choose('다크','dark');
  await settleReads();await page.reload({waitUntil:'networkidle'});await settleReads();
  assert.equal(await page.getByRole('radio',{name:'다크',exact:true}).isChecked(),true,'saved preference restored');
  await page.emulateMedia({colorScheme:'light'});assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark','explicit preference ignores OS');
  await choose('시스템','light');await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await choose('다크','dark');
  // Theme must already be applied even when React's bundle has not executed.
  const startup=await page.context().newPage();
  await startup.route('**/assets/*.js',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await startup.goto(origin+'/settings',{waitUntil:'networkidle'});
  assert.deepEqual(await startup.evaluate(()=>({theme:document.documentElement.dataset.theme,scheme:document.documentElement.style.colorScheme,meta:document.querySelector('meta[name="theme-color"]').content})),{theme:'dark',scheme:'dark',meta:'#141b27'});
  await startup.close();
  const screens=[];
  const capture=async(name,fit=false)=>{
    await settleReads();
    const layout=await page.evaluate(()=>{
      const nav=document.querySelector('.bottomnav'),active=nav.querySelector('.active'),chip=nav.querySelector('.t-tabs-pill');
      const n=nav.getBoundingClientRect(),c=chip.getBoundingClientRect(),a=active?.getBoundingClientRect(),s=document.querySelector('.app-shell').getBoundingClientRect();
      const title=document.querySelector('.page-title,.person-select');
      let clean=true; for(let el=title;el;el=el.parentElement) if(getComputedStyle(el).filter!=='none')clean=false;
      return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,clean,
        skeletons:document.querySelectorAll('.page-skeleton').length,nav:{left:n.left,right:n.right,bottom:n.bottom,center:n.x+n.width/2},shell:{left:s.left,right:s.right,bottom:s.bottom},
        chip: a?{diff:Math.abs(a.x-c.x),width:Math.abs(a.width-c.width),opacity:getComputedStyle(chip).opacity,z:getComputedStyle(chip).zIndex}:null};
    });
    assert.ok(layout.clean,'title ancestors have no blur '+name);assert.equal(layout.skeletons,0,'no stale skeleton '+name);
    assert.ok(layout.scrollWidth<=layout.width,'no horizontal overflow '+name);
    if(fit)assert.ok(layout.scrollHeight<=layout.height+2,'screen fits '+name+' '+JSON.stringify(layout));
    assert.ok(Math.abs(layout.nav.center-(layout.shell.left+layout.shell.right)/2)<1,'nav centered '+name);
    assert.ok(layout.nav.left>=layout.shell.left&&layout.nav.right<=layout.shell.right,'nav stays in app '+name);
    assert.ok(layout.nav.bottom<layout.height-10,'floating nav margin '+name);
    if(layout.width>600)assert.ok(layout.nav.bottom<=layout.shell.bottom-15,'desktop nav inside frame '+name);
    if(layout.chip){await page.waitForTimeout(650);const d=await page.locator('.bottomnav').evaluate(n=>{const a=n.querySelector('.active').getBoundingClientRect(),c=n.querySelector('.t-tabs-pill').getBoundingClientRect();return Math.abs(a.x-c.x)+Math.abs(a.width-c.width)});assert.ok(d<2,'chip aligns '+name);assert.equal(layout.chip.opacity,'1');assert.ok(+layout.chip.z>0);}
    await page.screenshot({path:dir+'/'+engine+'-theme-'+name+'.png',fullPage:true,animations:'disabled'});screens.push({name,...layout});
  };
  const routes=[['today','/'],['schedule','/schedule'],['history','/schedule/history'],['import','/import'],['people','/people'],['detail','/people/'+id],['person-edit','/people/'+id+'/edit'],['schedule-edit','/schedule/2026-10-19/edit'],['notifications','/notifications'],['cache','/settings/cache'],['settings','/settings'],['place','/people/'+id+'/place/origin'],['route','/people/'+id+'/commute']];
  for(const mode of ['light','dark']){
    await open('/settings');await choose(mode==='dark'?'다크':'화이트',mode);
    const contrasts=await page.evaluate(()=>{
      const style=getComputedStyle(document.documentElement),token=name=>style.getPropertyValue('--cbh-'+name).trim();
      const luminance=color=>{if(/^#[0-9a-f]{3}$/i.test(color))color='#'+color.slice(1).split('').map(c=>c+c).join('');const c=color.startsWith('#')?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)):color.match(/[\d.]+/g).slice(0,3).map(Number);return c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);};
      const ratio=(fg,bg)=>{const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
      return [['heading','paper'],['text','surface'],['muted','surface'],['faint','surface'],['accent','accent-soft'],['on-action','blue'],['error','paper'],['holiday','surface']].map(([fg,bg])=>({fg,bg,ratio:ratio(token(fg),token(bg))}));
    });
    assert.ok(contrasts.every(pair=>pair.ratio>=4.5),'AA text palette '+mode+' '+JSON.stringify(contrasts));
    for(const viewport of [{width:390,height:844},{width:1440,height:960}]){
      await page.setViewportSize(viewport);
      for(const [name,path] of routes){
        await open(path);
        if(name==='history')await page.getByLabel('조회 월').fill('2026-08');
        if(name==='detail'){
          const alignment=await page.locator('.person-profile-summary').evaluate(node=>[...node.children].map(x=>{const r=x.getBoundingClientRect();return r.y+r.height/2}));
          assert.ok(Math.abs(alignment[0]-alignment[1])<1,'birthday phone align');assert.equal(await page.locator('.person-profile-summary svg').count(),1);
          assert.equal(await page.getByRole('region',{name:'출발지',exact:true}).locator('.transit-icon svg').evaluate(el=>getComputedStyle(el).color),'rgb(164, 157, 135)','line in station name uses official Line 9');
          assert.equal(await page.getByRole('region',{name:'도착지',exact:true}).locator('.transit-line-dots i').count(),2,'transfer colors retained');
        }
        await capture(mode+'-'+viewport.width+'-'+name,['schedule','history','import','settings','cache'].includes(name));
      }
    }
  }
  await page.setViewportSize({width:360,height:740});await open('/schedule/history');await page.getByLabel('조회 월').fill('2026-08');await capture('dark-small-six-weeks',true);
  await page.setViewportSize({width:390,height:844});await open('/');
  const picker=()=>page.locator('.person-select').click();
  await picker();assert.equal(await page.getByRole('button',{name:'사람 선택 닫기',exact:true}).innerText(),'');assert.equal(await page.getByRole('button',{name:'사람 선택 닫기',exact:true}).locator('svg').count(),1);
  await page.screenshot({path:dir+'/'+engine+'-theme-dark-picker.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'사람 선택 닫기',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.person-select').evaluate(el=>el===document.activeElement),true,'focus returns to opener');
  await picker();await page.mouse.click(20,20);await page.getByRole('dialog').waitFor({state:'detached'});
  await picker();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  await picker();const grip=await page.locator('.person-picker-drag').boundingBox();
  await page.mouse.move(grip.x+50,grip.y+20);await page.mouse.down();await page.mouse.move(grip.x+50,grip.y+135,{steps:10});await page.mouse.up();await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'','scroll lock released after drag');
  // A real slow schedule GET shows only its in-flow rows; no overlay survives.
  await page.route('**/api/people/*/schedules',async r=>{await new Promise(resolve=>setTimeout(resolve,850));await r.continue();});
  await page.getByRole('link',{name:'일정',exact:true}).click();await page.locator('.skeleton-roster .page-skeleton').waitFor();
  const sk=await page.locator('.skeleton-roster').boundingBox();const shell=await page.locator('.app-shell').boundingBox();assert.equal(Math.round(sk.x-shell.x),18,'one page padding, never doubled');
  await page.screenshot({path:dir+'/'+engine+'-theme-skeleton-roster.png',fullPage:true,animations:'disabled'});
  await settleReads();assert.equal(await page.locator('.page-skeleton').count(),0);await page.unroute('**/api/people/*/schedules');
  // Warm cache route switches must not show a loader at all.
  await open('/settings/cache');await page.getByRole('button',{name:'이 기기에 임시 보관',exact:false}).click();await settleReads();
  await page.getByRole('link',{name:'사람',exact:true}).click();await settleReads();
  await page.getByRole('link',{name:'일정',exact:true}).click();await settleReads();
  await page.evaluate(()=>{window.__skeletonCount=0;window.__loaderObserver=new MutationObserver(()=>{if(document.querySelector('.page-skeleton'))window.__skeletonCount++});window.__loaderObserver.observe(document.body,{childList:true,subtree:true});});
  await page.getByRole('link',{name:'사람',exact:true}).click();await settleReads();
  assert.equal(await page.evaluate(()=>{window.__loaderObserver.disconnect();return window.__skeletonCount}),0,'no skeleton replay on a warm route');
  await open('/settings/cache');await page.getByRole('button',{name:'이 기기에 임시 보관',exact:false}).click();await settleReads();
  // Theme also covers the actual XLSX matching/review controls; never commit it.
  await open('/import');
  const source=[['업무',...Array.from({length:21},(_,i)=>i%3===0?'주간 '+Math.floor(i/3):null)],[null,...Array.from({length:21},(_,i)=>i%3===0?days[Math.floor(i/3)]:null)],['직원',...Array.from({length:21},(_,i)=>['출근','퇴근','쉬는시간'][i%3])],[created.body.person.name,...Array.from({length:21},(_,i)=>[9.5,20,1][i%3])]];
  await page.locator('input[accept=".xlsx"]').setInputFiles({name:'synthetic-theme.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(makeWeeklyXlsx(source))});
  await page.getByRole('button',{name:'인식 결과 보기'}).click();await page.locator('.mapping-row').waitFor();await capture('dark-match');
  await page.getByRole('button',{name:'다음',exact:true}).click();await page.locator('.import-review-item').first().waitFor();await capture('dark-review');
  await page.locator('.review-edit > summary').first().click();await page.locator('.time-wheel-trigger').first().click();await capture('dark-review-wheel');
  assert.equal((await api('/people/'+id+'/schedules')).body.schedules.length,7,'preview never writes D1');
  await open('/settings');await choose('시스템','light');
  const iosTop=await verifyIOSTopClearance({page,origin,engine,settleReads,dir});
  await writeFile(dir+'/'+engine+'-theme-report.json',JSON.stringify({screens,themePersistence:true,systemChange:true,beforeReact:true,sheetCloseBackdropEscapeDrag:true,loadingDelayWarmCache:true,officialColorsNameFallback:true,previewNoWrites:true},null,2));
  return {screens:screens.length,themePersistence:true,systemChange:true,beforeReact:true,sheetCloseBackdropEscapeDrag:true,loadingDelayWarmCache:true,officialColorsNameFallback:true,previewNoWrites:true,iosTop};
}
