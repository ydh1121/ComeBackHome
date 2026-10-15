import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import {chromium, webkit} from 'playwright';

const python = (args, input) => {
  const r=spawnSync('python3',['scripts/evaluate-paddle-v2.py',...args],{input,encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(r.status,0,'Immutable scorer process must succeed');
  return JSON.parse(r.stdout);
};
const images=python(['--images']); // Exact archived PNGs; no generation or truth.
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'immutable-v2-images',enforce:'pre',configureServer(server){server.middlewares.use((req,res,next)=>{
    const pathname=new URL(req.url??'/', 'http://127.0.0.1').pathname;
    if(pathname==='/__v2') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Local Paddle measurement</title>');return;}
    if(/^\/ort\/ort-wasm-[a-z0-9.-]+\.(mjs|wasm)$/.test(pathname)) {
      res.setHeader('Content-Type',pathname.endsWith('.mjs')?'text/javascript':'application/wasm');
      res.end(readFileSync('public'+pathname));return;
    }
    const item=images.find(x=>req.url==='/__v2/'+x.id+'.png');
    if(!item)return next();
    res.setHeader('Content-Type','image/png');res.end(Buffer.from(item.base64,'base64'));
  });},
}]});
try {
  await vite.listen();
  const origin='http://127.0.0.1:'+vite.httpServer.address().port;
  for(const [browserName,engine] of [['CHROMIUM',chromium],['WEBKIT',webkit]]) {
    const browser=await engine.launch();
    try {
      const page=await browser.newPage({serviceWorkers:'block'});
      page.setDefaultTimeout(180000);
      let external=0;
      await page.route('**/*',route=>{
        const url=route.request().url();
        if(!url.startsWith(origin+'/')&&!url.startsWith('blob:'+origin+'/')&&!url.startsWith('data:')){external++;return route.abort();}
        return route.continue();
      });
      await page.goto(origin+'/__v2');
      const report={provider:'LOCAL_PRODUCT_PADDLE',browser:browserName,source:'IMMUTABLE_SYNTHETIC_V2',
        external_inference:0,private_images:0,d1_writes:0,images:[],acceptance:'MEASUREMENT_NOT_AUTOMATIC_ACCEPTANCE'};
      for(const image of images) {
        const item=await page.evaluate(async({id})=>{
          const [{BrowserScheduleTableStructureDetector},{TesseractScheduleImageTextExtractor,TesseractJsWorkerFactory,BrowserScheduleOcrPreprocessor},
            {SAME_ORIGIN_TESSERACT_ASSETS},{PaddleWeeklyRegionalTextExtractor},{Weekly3ColumnScheduleImageRecognizer}]=await Promise.all([
            import('/src/providers/import/ScheduleTableStructureDetector.ts'),
            import('/src/providers/import/TesseractScheduleImageTextExtractor.ts'),import('/src/providers/import/ocrRuntimeConfig.ts'),
            import('/src/providers/import/PaddleWeeklyRegionalTextExtractor.ts'),import('/src/providers/import/Weekly3ColumnScheduleImageRecognizer.ts')]);
          const file=new File([await (await fetch('/__v2/'+id+'.png')).blob()],'input.png',{type:'image/png'});
          const paddle=new PaddleWeeklyRegionalTextExtractor();
          const title=new TesseractScheduleImageTextExtractor(new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS),new BrowserScheduleOcrPreprocessor(),{useStructureFirstMode:true});
          let observed=[];
          const regional={extractRegions:async(...args)=>{const values=await paddle.extractRegions(...args);observed.push(...values);return values;}};
          const recognizer=new Weekly3ColumnScheduleImageRecognizer(new BrowserScheduleTableStructureDetector(),title,regional,[]);
          const started=performance.now();
          try {
            const value=await recognizer.evaluate(file);
            const {matrix,interpretation,parsed}=value;
            const all=[...parsed.scheduleCandidates,...parsed.reviewCandidates??[]];
            const cells=all.map(c=>({source_image_id:id,employee_row:c.sourceRow-1,column_group:c.dayIndex,
              employee_name:c.sourcePersonName,date:c.date,weekday:c.date?(new Date(c.date+'T00:00:00Z').getUTCDay()+6)%7:null,
              status:c.recognitionState==='OFF_CANDIDATE'?'OFF_CANDIDATE':c.recognitionState==='BLANK'?'BLANK':c.recognitionState==='UNREADABLE'||c.recognitionState==='INCOMPLETE'?'UNREADABLE':'SHIFT',
              clock_in:c.start,clock_out:c.end,break_minutes:c.breakMinutes??null,
              review_required:parsed.structure.needsReview===true && parsed.structure.weeklyReview?.confirmed===false,
              evidence_bbox:c.sourceRegion?[c.sourceRegion.x,c.sourceRegion.y,c.sourceRegion.x+c.sourceRegion.width,c.sourceRegion.y+c.sourceRegion.height]:null}));
            const reasons={};
            for(const c of all) {
              const key=c.recognitionState??'WORK';reasons[key]=(reasons[key]??0)+1;
            }
            return {id,cells,rows:matrix.rows.length,physicalCells:matrix.physicalCellCount,headerSource:matrix.headerSource,
              dates:interpretation.dateResolution,states:reasons,raw_available:'IN_MEMORY_ONLY_NOT_PERSISTED',
              observedRegions:observed.length,emptyRegionText:observed.filter(r=>!r.text.trim()).length,
              latency_ms:Math.round(performance.now()-started),error:null};
          } catch(e) {
            const code=String(e.message).match(/^WEEKLY_[A-Z0-9_]+/)?.[0]??'PRODUCT_RUNTIME_ERROR';
            return {id,cells:[],error:code,errorDetail:String(e.message).slice(0,300),latency_ms:Math.round(performance.now()-started),observedRegions:observed.length};
          } finally {await paddle.dispose();}
        },{id:image.id});
        item.image_sha256=image.sha256;report.images.push(item);
        console.log('CBH_PADDLE_V2_PROGRESS='+JSON.stringify({browser:browserName,id:item.id,cells:item.cells.length,error:item.error,latency_ms:item.latency_ms}));
      }
      assert.equal(external,0,'No external browser requests');
      const scored=python([],JSON.stringify(report));
      console.log('CBH_PADDLE_V2='+JSON.stringify(scored));
      assert.equal(report.images.filter(x=>x.error==='PRODUCT_RUNTIME_ERROR').length,0,'Runtime failure invalidates quality measurement');
    } finally {await browser.close();}
  }
} finally {await vite.close();}
