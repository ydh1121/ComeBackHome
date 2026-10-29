import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

// Actual account/settings/favorite components with synthetic identities only.
// No schedule provider, real session, personal document or production call.
const output=resolve('artifacts/portal-navigation');await mkdir(output,{recursive:true});
const fixture=resolve(output,'fixture.tsx');
await writeFile(fixture,`
import {StrictMode,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,useLocation,useNavigate} from 'react-router';
import {AuthRoot,useAuth,AccountPage} from '../../src/modules/auth/AuthRoot';
import {PortalHeader,FavoriteActions,currentPortalModule} from '../../src/modules/portal/PortalNavigation';
import {FavoriteSettingsPage} from '../../src/modules/portal/FavoriteSettingsPage';
import {SettingsPage} from '../../src/pages/SettingsPage';
import '../../src/shared/styles/base.css';
import '../../src/shared/styles/private-module.css';
function App(){const auth=useAuth(),location=useLocation(),navigate=useNavigate();useEffect(()=>{window.qaRefresh=auth.refresh;},[auth.refresh]);return <><PortalHeader active={currentPortalModule(location.pathname)} path={location.pathname} onNavigate={navigate}/><div className="portal-content" data-test-owner={auth.user?.id}><Routes><Route path="/account" element={<AccountPage key={auth.user?.id}/>}/><Route path="/settings/favorites" element={<FavoriteSettingsPage key={auth.user?.id}/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="*" element={<main>합성 목적지</main>}/></Routes></div><FavoriteActions path={location.pathname} onNavigate={navigate}/></>}
createRoot(document.getElementById('root')).render(<StrictMode><BrowserRouter><AuthRoot><App/></AuthRoot></BrowserRouter></StrictMode>);
`);
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:18879,strictPort:true},plugins:[{name:'portal-navigation-qa',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(!['/account','/settings','/settings/favorites','/__portal-qa'].includes(req.url?.split('?')[0]))return next();try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__portal-qa','<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/artifacts/portal-navigation/fixture.tsx"></script></body></html>'));}catch(error){next(error);}});}}]});
await server.listen();const base='http://127.0.0.1:18879';let checks=0;const evidence=[];
const check=(condition,note)=>{assert(condition,note);checks++;};
try{
  for(const[engine,name]of[[chromium,'chromium'],[webkit,'webkit']]){
    const browser=await engine.launch({headless:true});
    try{
      const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Seoul',locale:'ko-KR',serviceWorkers:'block'});
      await context.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{configurable:true,value:true});});
      let identity='synthetic-one';const requests=[],external=[],errors=[];
      await context.route('**/*',route=>{if(new URL(route.request().url()).origin===base)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});
      await context.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;requests.push(path);const body=path==='/api/auth/session'?{enabled:true,user:identity?{id:identity,loginId:'synthetic-member',role:'member',mustChangePassword:false}:null}:path==='/api/auth/preferences'?{shortcutVisible:true}:path==='/api/auth/devices'?{devices:[{device_name:'합성 iPhone '+identity,current:true,last_seen_at:'2026-10-01T00:00:00Z',expires_at:'2026-11-01T00:00:00Z'},{device_name:'합성 PC',current:false,last_seen_at:'2026-10-01T00:00:00Z',expires_at:'2026-11-01T00:00:00Z'}]}:{};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/account');await page.getByRole('heading',{name:'내 계정',exact:true}).waitFor();
      await page.evaluate(()=>localStorage.setItem('cbh.portal.favorites.synthetic-one',JSON.stringify(['schedule','note'])));await page.reload();
      await page.getByRole('heading',{name:'내 계정',exact:true}).waitFor();
      check(await page.getByRole('heading',{level:1}).count()===1,name+': account has one title');
      check(await page.locator('.account-page .private-header').count()===0,name+': duplicate old account links removed');
      check(await page.locator('.portal-private-status-background').count()===1,name+': account gets opaque standalone status edge');
      check(await page.locator('.portal-private-status-background').evaluate(node=>{const css=getComputedStyle(node);return css.backdropFilter==='none'&&node.getBoundingClientRect().height>=12;}),name+': status edge itself has no blur');
      for(const width of[375,390,768,1024,1440]){
        await page.setViewportSize({width,height:844});
        const bounds=await page.evaluate(()=>{const rect=selector=>document.querySelector(selector).getBoundingClientRect();const account=rect('.account-page'),password=rect('.account-page .auth-card'),heading=rect('.portal-settings-heading'),top=rect('.portal-top'),fab=rect('.portal-favorite-trigger');return{overflow:document.documentElement.scrollWidth>innerWidth+1,sameWidth:password.width<=account.width&&Math.abs(password.width-document.querySelector('.account-page .private-card').getBoundingClientRect().width)<1,below:heading.top>=top.bottom-1,bottomGap:innerHeight-fab.bottom,inputs:[...document.querySelectorAll('.account-page input:not([type=checkbox])')].every(n=>parseFloat(getComputedStyle(n).fontSize)>=16)};});
        check(!bounds.overflow&&bounds.sameWidth&&bounds.below&&bounds.inputs,name+': account layout '+width);
        check(bounds.bottomGap>=12&&bounds.bottomGap<=40,name+': no phantom bottom dock '+width);
      }
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,name+'-account.png')});
      await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).click();
      const menu=page.getByRole('region',{name:'즐겨찾는 기능'});
      check(await menu.getByRole('link',{name:'근무표 가져오기',exact:true}).count()===1&&await menu.getByRole('link',{name:'메모 남기기',exact:true}).count()===1&&await menu.getByRole('link',{name:'쓴 돈 입력',exact:true}).count()===0,name+': legacy favorites preserved');
      await menu.getByRole('link',{name:'편집',exact:true}).click();await page.getByRole('heading',{name:'즐겨찾기 버튼',exact:true}).waitFor();
      check(await page.getByRole('checkbox').count()===18,name+': full functional destination list');
      await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).uncheck();
      check(await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).count()===0,name+': off takes effect immediately');
      await page.reload();await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).waitFor();
      check(!await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).isChecked()&&await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).count()===0,name+': off survives reload');
      await page.getByRole('link',{name:'설정으로 돌아가기'}).click();
      await page.getByRole('button',{name:'즐겨찾기 버튼',exact:true}).click();
      check(!await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).isChecked(),name+': settings route remains reachable while hidden');
      await page.getByRole('checkbox',{name:'내 계정',exact:true}).check();
      await page.getByRole('checkbox',{name:'월급 나누기',exact:true}).check();
      await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).check();
      await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).click();
      await menu.getByRole('link',{name:'내 계정',exact:true}).waitFor();check(await menu.getByRole('link',{name:'월급 나누기',exact:true}).count()===1,name+': selected new destinations appear');
      await menu.getByRole('link',{name:'내 계정',exact:true}).click();await page.getByRole('heading',{name:'내 계정',exact:true}).waitFor();
      identity='synthetic-two';await page.evaluate(()=>window.qaRefresh());
      await page.waitForFunction(()=>document.querySelector('[data-test-owner]')?.getAttribute('data-test-owner')==='synthetic-two');
      await page.getByText('합성 iPhone synthetic-two · 현재 기기',{exact:true}).waitFor();
      check(await page.getByText('합성 iPhone synthetic-one · 현재 기기',{exact:true}).count()===0,name+': previous account device list removed');
      await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).click();
      check(await menu.getByRole('link',{name:'내 계정',exact:true}).count()===0&&await menu.getByRole('link',{name:'쓴 돈 입력',exact:true}).count()===1,name+': identity switch uses only new account choices');
      await menu.getByRole('link',{name:'편집',exact:true}).click();await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).uncheck();
      identity='synthetic-one';await page.evaluate(()=>window.qaRefresh());
      await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).waitFor();
      check(await page.getByRole('checkbox',{name:'내 계정',exact:true}).isChecked()&&await page.getByRole('checkbox',{name:'월급 나누기',exact:true}).isChecked(),name+': original account remains unchanged');
      await page.screenshot({path:resolve(output,name+'-favorites.png')});
      await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).click();await menu.getByRole('link',{name:'편집',exact:true}).click();
      check(await menu.count()===0,name+': edit closes favorites even on editor route');
      // A separate tab can turn off the button for this same account.
      const other=await context.newPage();await other.goto(base+'/settings/favorites');await other.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).uncheck();await page.bringToFront();await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).waitFor();
      await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).waitFor({state:'hidden'});
      check(!await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).isChecked(),name+': same-account storage event updates other tab');
      await other.close();await page.bringToFront();await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).check();
      // Device storage failure preserves a usable, explicitly temporary choice.
      await page.evaluate(()=>{window.qaOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('cbh.portal.favorites.'))throw new DOMException('synthetic failure','QuotaExceededError');return window.qaOriginalSetItem.call(this,key,value);};});
      await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).uncheck();
      check(await page.getByRole('button',{name:'즐겨찾는 기능 열기'}).count()===0,name+': storage failure still applies choice in current session');
      await page.getByText('기기에 저장하지 못했습니다. 지금 선택은 앱을 닫기 전까지 유지됩니다.',{exact:true}).waitFor();
      await page.evaluate(()=>{Storage.prototype.setItem=window.qaOriginalSetItem;});await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).check();
      check(await page.getByRole('alert').count()===0,name+': persistence recovery clears warning');
      // Corrupt storage falls back safely; intentionally empty storage does not.
      await page.evaluate(()=>{localStorage.setItem('cbh.portal.favorites.synthetic-one','[null]');});await page.reload();await page.getByRole('checkbox',{name:'쓴 돈 입력',exact:true}).waitFor();
      check(await page.getByRole('checkbox',{name:'쓴 돈 입력',exact:true}).isChecked(),name+': malformed stored array recovers');
      await page.evaluate(()=>localStorage.setItem('cbh.portal.favorites.synthetic-one','[]'));await page.reload();await page.getByRole('switch',{name:'즐겨찾기 버튼 표시'}).waitFor();
      check(await page.getByRole('checkbox',{checked:true}).count()===0,name+': deliberate empty selection survives');
      identity=null;await page.evaluate(()=>window.qaRefresh());await page.getByText('내 계정으로 로그인',{exact:true}).waitFor();
      check(await page.locator('.portal-favorites').count()===0&&await page.locator('.portal-settings-page').count()===0,name+': no private controls for anonymous session');
      check(requests.every(path=>path.startsWith('/api/auth/')),name+': account/settings never start schedule/provider requests');
      check(external.length===0&&errors.length===0,name+': no external traffic or page errors');
      evidence.push({browser:name,result:'PASS',externalRequests:external.length});await context.close();
    }finally{await browser.close();}
  }
  await writeFile(resolve(output,'result.json'),JSON.stringify({result:'PASS',checks,evidence},null,2));console.log(JSON.stringify({result:'PASS',checks,evidence}));
}finally{await server.close();await rm(fixture,{force:true});}
