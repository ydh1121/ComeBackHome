import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

// Real private components, synthetic local content only; no provider or
// production calls. This cannot certify native iOS status-bar rendering.
const output = resolve('artifacts/private-sheet');
await mkdir(output, { recursive: true });
const fixture = resolve(output, 'fixture.tsx');
await writeFile(fixture, `
import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AuthRoot,useAuth} from '../../src/modules/auth/AuthRoot';
import {PortalHeader} from '../../src/modules/portal/PortalNavigation';
import {FormSheet} from '../../src/modules/household/ui/shared';
import {RecordEditor} from '../../src/modules/injury/ui/RecordEditor';
import '../../src/shared/styles/base.css';
import '../../src/shared/styles/private-module.css';
import '../../src/shared/layout/app-shell.css';
import '../../src/modules/household/ui/household.css';
const empty={caseId:'synthetic',owner:true,actors:[],records:[],policies:[],documents:[],payments:[],deadlines:[],overlaps:[]};
function App(){const auth=useAuth();const [sheet,setSheet]=useState(''),[busy,setBusy]=useState(false),[active,setActive]=useState('household');useEffect(()=>{window.qaLogout=auth.logout;},[auth.logout]);return <>
  <PortalHeader active={active} onNavigate={href=>setActive(href==='/'?'schedule':href==='/injury'?'injury':'household')}/>
  <main style={{height:2400,paddingTop:340,paddingInline:24}}><button id="open-household" onClick={()=>setSheet('household')}>생활비 팝업</button><button id="open-injury" onClick={()=>setSheet('injury')}>산재 팝업</button><button id="behind">뒤쪽</button></main>
  {sheet==='household'&&<FormSheet title="합성 입력" busy={busy} onClose={()=>setSheet('')}><form className="hh-form" onSubmit={e=>e.preventDefault()}><label className="hh-field">선택<select defaultValue="a"><option value="a">합성 항목 A</option><option value="b">합성 항목 B</option></select></label><button id="busy-toggle" type="button" onClick={()=>setBusy(!busy)}>저장 상태 전환</button>{Array.from({length:18},(_,i)=><label className="hh-field" key={i}>입력 {i+1}<input name={'field'+i}/></label>)}</form></FormSheet>}
  {sheet==='injury'&&<RecordEditor kind="content" data={empty} close={()=>setSheet('')} saved={async()=>{}}/>}
</>}
createRoot(document.getElementById('root')!).render(<StrictMode><AuthRoot><App/></AuthRoot></StrictMode>);
`);
const server = await createServer({ logLevel:'error', server:{host:'127.0.0.1',port:18878,strictPort:true}, plugins:[{
  name:'private-sheet-qa-route', configureServer(vite) {
    vite.middlewares.use('/__private-sheet-qa',async (_req,res,next)=>{
      try { res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__private-sheet-qa','<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/artifacts/private-sheet/fixture.tsx"></script></body></html>')); } catch(error){next(error);}
    });
  },
}] });
await server.listen();
const base='http://127.0.0.1:18878';
let checks=0;
const check=(condition,message)=>{assert(condition,message);checks++;};
const evidence=[];
try {
  for(const [engine,name] of [[chromium,'chromium'],[webkit,'webkit']]) {
    const browser=await engine.launch({headless:true});
    try {
      const context=await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
      await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));
      const external=[],errors=[];
      let identity='synthetic-member',holdSession=false,failSession=false,releaseSession,sessionWaiting;
      await context.route('**/*',route=>{
        if(new URL(route.request().url()).origin===base)return route.continue();
        external.push(new URL(route.request().url()).origin);return route.abort();
      });
      await context.route('**/api/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/api/auth/session'&&holdSession){sessionWaiting?.();await new Promise(done=>{releaseSession=done;});}
        if(path==='/api/auth/session'&&failSession)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
        const body=path==='/api/auth/session'?{enabled:true,user:{id:identity,loginId:'yvonne',role:'member',mustChangePassword:false},legacyAccess:'write'}:path==='/api/auth/preferences'?{shortcutVisible:true}:{};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/__private-sheet-qa');
      await page.locator('#open-household').waitFor();
      check(await page.locator('.portal-private-status-background').count()===1,`${name}: private standalone has opaque edge`);
      const edge=await page.locator('.portal-private-status-background').evaluate(node=>{const css=getComputedStyle(node);return {height:node.getBoundingClientRect().height,position:css.position,background:css.backgroundColor,filter:css.backdropFilter};});
      check(edge.height>=12&&edge.position==='fixed'&&edge.background!=='rgba(0, 0, 0, 0)'&&edge.filter==='none',`${name}: opaque edge does not blur`);
      await page.getByRole('navigation',{name:'공간 선택'}).getByRole('link',{name:'일정',exact:true}).click();
      check(await page.locator('.portal-private-status-background').count()===0,`${name}: schedule does not receive private edge`);
      await page.getByRole('navigation',{name:'공간 선택'}).getByRole('link',{name:'산재',exact:true}).click();
      check(await page.locator('.portal-private-status-background').count()===1,`${name}: injury receives private edge`);
      await page.evaluate(()=>{document.body.style.paddingRight='3px';document.documentElement.style.scrollBehavior='smooth';window.scrollTo({top:250,behavior:'instant'});});
      const originalY=await page.evaluate(()=>window.scrollY);
      await page.locator('#open-household').click();
      const dialog=page.getByRole('dialog',{name:'합성 입력'}),body=dialog.locator('.private-sheet__body');
      await dialog.waitFor();
      check(await page.evaluate(()=>document.activeElement?.tagName)==='H2',`${name}: heading receives initial focus`);
      check(await page.evaluate(()=>document.body.style.position==='fixed'&&document.documentElement.style.overflow==='hidden'),`${name}: both viewport roots locked`);
      check(await dialog.locator('.private-sheet__close').evaluate(node=>{const r=node.getBoundingClientRect();return r.width>=44&&r.height>=44&&!node.matches(':focus-visible');}),`${name}: close target is44px and not initially focused`);
      const headerY=await dialog.locator('header').evaluate(node=>node.getBoundingClientRect().top);
      await body.evaluate(node=>node.scrollTop=500);
      check(await body.evaluate(node=>node.scrollTop)>0,`${name}: dedicated body scrolls`);
      check(await dialog.locator('header').evaluate(node=>node.getBoundingClientRect().top)===headerY,`${name}: header stays put while body scrolls`);
      await page.mouse.move(3,400);await page.mouse.wheel(120,600);
      check(await page.evaluate(()=>document.body.style.top)===`-${originalY}px`,`${name}: background remains frozen after wheel`);
      for(const width of [375,390,768,1024,1440]) {
        await page.setViewportSize({width,height:844});
        const box=await dialog.boundingBox();
        check(box.x>=0&&box.x+box.width<=width+1,`${name}: sheet bounded at${width}`);
        check(await body.evaluate(node=>node.scrollWidth<=node.clientWidth+1),`${name}: no horizontal body pan at${width}`);
      }
      await page.setViewportSize({width:390,height:844});await body.evaluate(node=>node.scrollTop=0);
      await page.setViewportSize({width:390,height:440});
      await page.waitForFunction(()=>document.querySelector('dialog')?.style.getPropertyValue('--private-sheet-viewport-height')==='440px');
      const compact=await dialog.boundingBox();
      check(compact.y>=0&&compact.y+compact.height<=440,`${name}: dialog fits reduced viewport height`);
      await page.setViewportSize({width:390,height:844});
      const select=dialog.locator('select');await select.selectOption('b');
      check(await select.inputValue()==='b',`${name}: native select still changes values`);
      check(await select.evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=16&&node.getBoundingClientRect().height>=44),`${name}: picker is16px and touch sized`);
      await page.screenshot({path:resolve(output,name+'-household.png')});
      await page.keyboard.press('Tab');check(await dialog.evaluate(node=>node.contains(document.activeElement)),`${name}: keyboard focus stays modal`);
      await page.locator('#busy-toggle').click();await page.keyboard.press('Escape');await page.mouse.click(2,2);
      check(await dialog.isVisible()&&await dialog.locator('.private-sheet__close').isDisabled(),`${name}: busy dialog cannot dismiss`);
      await page.locator('#busy-toggle').click();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      const restored=await page.evaluate(()=>({y:scrollY,position:document.body.style.position,overflow:document.documentElement.style.overflow,padding:document.body.style.paddingRight,behavior:document.documentElement.style.scrollBehavior,active:document.activeElement?.id}));
      check(restored.y===originalY&&restored.position===''&&restored.overflow===''&&restored.padding==='3px'&&restored.behavior==='smooth'&&restored.active==='open-household',`${name}: close restores scroll, prior styles and focus`);
      await page.locator('#open-household').click();await page.mouse.click(2,2);await dialog.waitFor({state:'hidden'});checks++;
      await page.locator('#open-household').click();const heading=dialog.locator('h2'),box=await heading.boundingBox();
      await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+10,box.y+110,{steps:6});await page.mouse.up();await dialog.waitFor({state:'hidden'});checks++;
      await page.locator('#open-injury').click();const editor=page.getByRole('dialog',{name:'안내·메시지 추가'});await editor.waitFor();
      check(await page.evaluate(()=>document.activeElement?.tagName)==='H2',`${name}: injury opens without input autofocus`);
      await page.screenshot({path:resolve(output,name+'-injury.png')});
      await editor.getByLabel('제목',{exact:true}).fill('합성 메모');
      page.once('dialog',native=>native.dismiss());await page.keyboard.press('Escape');
      check(await editor.isVisible(),`${name}: injury dirty cancel preserves input`);
      page.once('dialog',native=>native.accept());await editor.getByRole('button',{name:'편집 닫기'}).click();await editor.waitFor({state:'hidden'});checks++;
      await page.locator('#open-household').click();await dialog.locator('input[name=field0]').fill('합성 미저장 입력');
      holdSession=true;const waiting=new Promise(done=>{sessionWaiting=done;});
      await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
      check(await dialog.isVisible()===false&&await page.locator('.private-sheet[open]').count()===0,`${name}: pagehide removes private top-layer dialog immediately`);
      await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await waiting;
      check(await page.locator('.private-sheet-portal[hidden]').count()===1,`${name}: deferred session verification hides portal but retains draft DOM`);
      holdSession=false;releaseSession();await dialog.waitFor({state:'visible'});
      check(await dialog.locator('input[name=field0]').inputValue()==='합성 미저장 입력',`${name}: same-user verification preserves uncontrolled draft`);
      failSession=true;await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.getByRole('button',{name:'다시 확인',exact:true}).waitFor();
      check(await dialog.isVisible()===false&&await page.locator('.private-sheet[open]').count()===0,`${name}: verification failure cannot expose private dialog`);
      failSession=false;await page.getByRole('button',{name:'다시 확인',exact:true}).click();await dialog.waitFor({state:'visible'});
      check(await dialog.locator('input[name=field0]').inputValue()==='합성 미저장 입력',`${name}: successful retry preserves draft`);
      identity='synthetic-other';await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.waitForFunction(()=>document.querySelector('.private-sheet-portal')===null);
      check(await dialog.count()===0,`${name}: identity change discards old draft dialog`);
      await page.locator('#open-household').click();await dialog.waitFor();
      await page.evaluate(()=>window.qaLogout());
      check(await page.locator('.private-sheet-portal').count()===0,`${name}: logout removes portal and private draft`);
      check(errors.length===0,`${name}: no browser errors: ${errors.join(';')}`);check(external.length===0,`${name}: no external calls`);
      evidence.push({engine:name,result:'PASS'});await context.close();
    } finally {await browser.close();}
  }
  await writeFile(resolve(output,'result.json'),JSON.stringify({checks,evidence,nativeIphone:'NOT_RUN'},null,2)+'\n');
  console.log(`PASS private sheets: ${checks} Chromium/WebKit checks; native iPhone remains separate.`);
} finally {await server.close();await rm(fixture,{force:true});}
