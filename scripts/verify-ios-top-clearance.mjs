import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

// Desktop WebKit cannot render native iPhone status-bar material or history
// snapshots. Geometry and physical-device acceptance remain separate.
export async function verifyIOSTopClearance({page,origin,engine,settleReads,dir}) {
  const open=async path=>{await settleReads();await page.goto(origin+path,{waitUntil:'networkidle'});await settleReads();};
  const insets=async(top,bottom=34)=>page.addStyleTag({content:'.app-shell{--cbh-safe-top:'+top+'px;--cbh-safe-bottom:'+bottom+'px}'});
  const results=[],fitFailures=[],baselines=[];
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
  const measure=selectors=>page.evaluate(selectors=>{
    const shell=document.querySelector('.app-shell'),style=getComputedStyle(shell);
    const painted=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(node=>{
      const range=document.createRange();range.selectNodeContents(node);
      const r=node instanceof SVGElement?node.getBoundingClientRect():range.getBoundingClientRect();
      return {selector,top:r.top,bottom:r.bottom};
    }));
    const nav=document.querySelector('.bottomnav').getBoundingClientRect();
    const edge=document.querySelector('.app-shell__status-background'),r=edge?.getBoundingClientRect(),s=edge&&getComputedStyle(edge);
    return {installed:shell.dataset.iosStandalone,paddingTop:parseFloat(getComputedStyle(document.querySelector('.app-shell__app')).paddingTop),
      painted,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
      scrollHeight:document.documentElement.scrollHeight,navBottom:nav.bottom,paper:style.backgroundColor,
      edge:edge?{top:r.top,left:r.left,right:r.right,height:r.height,background:s.backgroundColor,opacity:s.opacity,
        position:s.position,pointerEvents:s.pointerEvents,filter:s.filter,backdrop:s.backdropFilter||s.webkitBackdropFilter,
        ariaHidden:edge.getAttribute('aria-hidden'),insideRoute:!!edge.closest('.route-reveal')}:null,
      rosterRows:[...document.querySelectorAll('.roster-row')].map(row=>({height:row.getBoundingClientRect().height,minHeight:getComputedStyle(row).minHeight,lineHeight:getComputedStyle(row).lineHeight}))};
  },selectors);
  const checkEdge=(layout,top)=>{
    assert.deepEqual(layout.edge,{top:0,left:0,right:layout.width,height:top,background:layout.paper,opacity:'1',
      position:'fixed',pointerEvents:'none',filter:'none',backdrop:'none',ariaHidden:'true',insideRoute:false},'opaque status background covers only the safe inset');
    assert.equal(layout.paddingTop,top,'no extra title displacement');
  };
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['light','dark']){
    await open('/settings');
    await page.getByRole('radio',{name:mode==='dark'?'다크':'화이트',exact:true}).check();
    // Ordinary-browser geometry is the accepted pre-PR96 title position.
    // Compare painted glyph/icon bounds, not just the element box.
    await page.evaluate(()=>sessionStorage.setItem('test:ios-display-mode','browser'));
    const original=new Map();
    for(const [name,path,selectors] of routes){
      await open(path);await insets(0);
      const baseline=await measure(selectors);assert.equal(baseline.edge,null);assert.equal(baseline.paddingTop,0);
      original.set(name,baseline.painted);baselines.push({mode,name,painted:baseline.painted});
    }
    await page.evaluate(()=>sessionStorage.removeItem('test:ios-display-mode'));
    for(const top of [47,59])for(const [name,path,selectors] of routes){
      await open(path);await insets(top);
      const layout=await measure(selectors),baseline=original.get(name);
      assert.equal(layout.installed,'true');checkEdge(layout,top);
      assert.ok(layout.painted.length>=selectors.length,'header nodes exist '+name);
      assert.equal(layout.painted.length,baseline.length);
      for(let i=0;i<baseline.length;i++)for(const bound of ['top','bottom']){
        assert.ok(Math.abs(layout.painted[i][bound]-baseline[i][bound]-top)<1,'original title/icon position plus safe inset '+JSON.stringify({mode,top,name,bound,layout}));
      }
      assert.ok(layout.painted.every(item=>item.top>=top),'status background never covers a heading');
      assert.ok(layout.scrollWidth<=layout.width,'no horizontal overflow');
      if(['schedule','history','import'].includes(name)&&layout.scrollHeight>layout.height+2)fitFailures.push({mode,top,name,layout});
      assert.equal(Math.round(layout.navBottom),810,'bottom safe area retained');
      if(name==='today'){
        const offsets=await page.locator('.action-card').evaluateAll(cards=>cards.map(card=>{
          const box=card.getBoundingClientRect(),children=[...card.children].map(child=>child.getBoundingClientRect());
          return Math.abs((Math.min(...children.map(r=>r.left))+Math.max(...children.map(r=>r.right)))/2-(box.left+box.right)/2);
        }));
        assert.equal(offsets.length,2);assert.ok(offsets.every(x=>x<1),'Today action icon and text groups remain centered');
      }
      await page.screenshot({path:dir+'/'+engine+'-ios-top-'+mode+'-'+top+'-'+name+'.png',fullPage:true,animations:'disabled'});
      results.push({mode,top,name,...layout});
    }
  }
  // SPA navigation moves the selection pill while the same bar/edge remain
  // fixed. This does NOT emulate native iOS edge-swipe snapshots.
  await open('/people');await insets(59);
  await page.evaluate(()=>{
    window.__cbhNav=document.querySelector('.bottomnav');window.__cbhEdge=document.querySelector('.app-shell__status-background');
    window.__cbhNav.addEventListener('click',()=>{
      window.__cbhNavFrames=new Promise(resolve=>{
        const frames=[];const frame=()=>{
          const n=window.__cbhNav.getBoundingClientRect(),e=window.__cbhEdge.getBoundingClientRect();
          frames.push({left:n.left,top:n.top,width:n.width,edgeTop:e.top,edgeHeight:e.height});
          if(frames.length<36)requestAnimationFrame(frame);else resolve(frames);
        };requestAnimationFrame(frame);
      });
    },{once:true});
  });
  await page.getByRole('link',{name:'가져오기',exact:true}).click();await settleReads();
  const frames=await page.evaluate(()=>window.__cbhNavFrames);
  assert.equal(frames.length,36);assert.ok(frames.every(frame=>JSON.stringify(frame)===JSON.stringify(frames[0])),'bar stays fixed during app navigation');
  await page.waitForTimeout(650);
  const pillOffset=await page.locator('.bottomnav').evaluate(nav=>Math.abs(nav.querySelector('.active').getBoundingClientRect().left-nav.querySelector('.t-tabs-pill').getBoundingClientRect().left));
  assert.ok(pillOffset<1,'selection pill arrives at selected tab');
  await page.goBack();await settleReads();
  assert.equal(new URL(page.url()).pathname,'/people');
  assert.equal(await page.evaluate(()=>window.__cbhNav===document.querySelector('.bottomnav')&&window.__cbhEdge===document.querySelector('.app-shell__status-background')),true,'SPA history keeps shell mounted');
  // A synthetic overflow spacer exercises real scrolling without extra D1 data.
  await page.evaluate(()=>{const spacer=document.createElement('div');spacer.dataset.testScroll='';spacer.style.height='100vh';document.querySelector('.app-shell__main').append(spacer);window.scrollTo(0,80);});
  await page.waitForFunction(()=>scrollY===80);
  checkEdge(await measure(['.page-title']),59);
  await page.evaluate(()=>{document.querySelector('[data-test-scroll]').remove();window.scrollTo(0,0);});
  for(const viewport of [{width:1440,height:960},{width:844,height:390}]){
    await page.setViewportSize(viewport);await open('/people');await insets(0,0);
    checkEdge(await measure(['.page-title']),0);
  }
  await page.evaluate(()=>sessionStorage.setItem('test:ios-display-mode','browser'));
  await page.setViewportSize({width:390,height:844});await open('/settings');
  assert.equal(await page.locator('.app-shell__status-background').count(),0,'ordinary browsers have no status fill');
  await page.getByRole('radio',{name:'시스템',exact:true}).check();
  const report={results,baselines,appNavigationFrames:frames,originalTitlePosition:true,ordinaryBrowserUnchanged:true,
    desktopUnchanged:true,landscapeUnchanged:true,nativeHistoryGesture:'NOT_EMULATED',nativeIOSBlurAcceptance:'OWNER_RECHECK_REQUIRED'};
  await writeFile(dir+'/'+engine+'-ios-top-report.json',JSON.stringify(report,null,2));
  assert.deepEqual(fitFailures,[],'safe-area screens fit; all failed cases are included for diagnosis');
  return {screens:results.length,originalTitlePosition:true,opaqueStatusBackground:true,appNavigationFixed:true,nativeIOSBlurAcceptance:report.nativeIOSBlurAcceptance};
}
