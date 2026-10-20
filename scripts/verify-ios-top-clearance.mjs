import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

// Geometry emulation only. Desktop WebKit cannot render the native iPhone
// status-bar material; physical-device acceptance must remain separate.
export async function verifyIOSTopClearance({page,origin,engine,settleReads,dir}) {
  const open=async path=>{await settleReads();await page.goto(origin+path,{waitUntil:'networkidle'});await settleReads();};
  const results=[],fitFailures=[];
  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{
    configurable:true,get:()=>sessionStorage.getItem('test:ios-display-mode')!=='browser',
  }));
  const routes=[
    ['today','/',['.brand','.top-utility .svg']],
    ['schedule','/schedule',['.page-title','.page-head-inline .text-btn']],
    ['import','/import',['.page-title']],
    ['people','/people',['.page-title']],
    ['history','/schedule/history?month=2026-08',['.page-title','.history-title .back .svg','.history-title .text-btn']],
  ];
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['light','dark']){
    await open('/settings');
    await page.getByRole('radio',{name:mode==='dark'?'다크':'화이트',exact:true}).check();
    for(const top of [47,59])for(const [name,path,selectors] of routes){
      await open(path);
      // env() cannot be set by Playwright. Override only its input tokens;
      // the actual production safe-area/layout rules still calculate geometry.
      await page.addStyleTag({content:`.app-shell{--cbh-safe-top:${top}px;--cbh-safe-bottom:34px}`});
      const layout=await page.evaluate(selectors=>{
        const shell=document.querySelector('.app-shell'),style=getComputedStyle(shell);
        const painted=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(node=>{
          const range=document.createRange();range.selectNodeContents(node);
          const r=node instanceof SVGElement?node.getBoundingClientRect():range.getBoundingClientRect();
          return {selector,top:r.top,bottom:r.bottom};
        }));
        const nav=document.querySelector('.bottomnav').getBoundingClientRect();
        return {installed:shell.dataset.iosStandalone,clearance:parseFloat(style.getPropertyValue('--cbh-top-clearance')),
          painted,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
          scrollHeight:document.documentElement.scrollHeight,navBottom:nav.bottom,
          rosterRows:[...document.querySelectorAll('.roster-row')].map(row=>({height:row.getBoundingClientRect().height,minHeight:getComputedStyle(row).minHeight,lineHeight:getComputedStyle(row).lineHeight}))};
      },selectors);
      assert.equal(layout.installed,'true');assert.equal(layout.clearance,24);
      assert.ok(layout.painted.length>=selectors.length,'protected header nodes exist '+name);
      assert.ok(layout.painted.every(item=>item.top>=top+40),'header paint stays below native edge band '+JSON.stringify({mode,top,name,layout}));
      assert.ok(layout.scrollWidth<=layout.width,'no horizontal overflow');
      if(['schedule','history','import'].includes(name)&&layout.scrollHeight>layout.height+2)fitFailures.push({mode,top,name,layout});
      assert.equal(Math.round(layout.navBottom),810,'bottom safe area retained');
      await page.screenshot({path:`${dir}/${engine}-ios-top-${mode}-${top}-${name}.png`,fullPage:true,animations:'disabled'});
      results.push({mode,top,name,...layout});
    }
  }
  // An ordinary Safari tab, desktop and landscape must retain zero extra gap.
  await page.evaluate(()=>sessionStorage.setItem('test:ios-display-mode','browser'));
  await open('/people');
  assert.equal(await page.locator('.app-shell').getAttribute('data-ios-standalone'),'false');
  assert.equal(await page.locator('.app-shell').evaluate(el=>getComputedStyle(el).getPropertyValue('--cbh-top-clearance').trim()),'0px');
  await page.evaluate(()=>sessionStorage.removeItem('test:ios-display-mode'));
  for(const viewport of [{width:1440,height:960},{width:844,height:390}]){
    await page.setViewportSize(viewport);await open('/people');
    assert.equal(await page.locator('.app-shell').evaluate(el=>getComputedStyle(el).getPropertyValue('--cbh-top-clearance').trim()),'0px');
  }
  await page.evaluate(()=>sessionStorage.setItem('test:ios-display-mode','browser'));
  await page.setViewportSize({width:390,height:844});await open('/settings');
  await page.getByRole('radio',{name:'시스템',exact:true}).check();
  const report={results,ordinaryBrowserUnchanged:true,desktopUnchanged:true,landscapeUnchanged:true,nativeIOSBlurAcceptance:'OWNER_RECHECK_REQUIRED'};
  await writeFile(`${dir}/${engine}-ios-top-report.json`,JSON.stringify(report,null,2));
  assert.deepEqual(fitFailures,[],'safe-area screens fit; all failed cases are included for diagnosis');
  return {screens:results.length,geometry:true,nativeIOSBlurAcceptance:report.nativeIOSBlurAcceptance};
}
