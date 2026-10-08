import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({
  root,logLevel:'error',server:{host:'127.0.0.1',port:0},
  plugins:[{name:'ocr-weekly-runtime',enforce:'pre',configureServer(vite){
    vite.middlewares.use((request,response,next)=>{
      const u=new URL(request.url??'/','http://127.0.0.1');
      if(!u.pathname.startsWith('/ort/'))return next();
      const name=u.pathname.slice(5);
      if(!/^ort-wasm-[a-z0-9.-]+\.(?:mjs|wasm)$/.test(name)){
        response.statusCode=404;response.end();return;
      }
      // This is the already-verified, temporary CI same-origin model runtime.
      import('node:fs').then(fs=>import('node:path').then(path=>{
        const p=path.join(root,'public/ort',name);
        if(!fs.existsSync(p)){response.statusCode=404;response.end();return;}
        response.setHeader('Content-Type',name.endsWith('mjs')?'text/javascript':'application/wasm');
        response.end(fs.readFileSync(p));
      })).catch(()=>{response.statusCode=500;response.end();});
    });
  }}],
});
const specs=[
  {id:'A-CLEAN',family:'A',degraded:false,scale:1,people:2,firstDay:12},
  {id:'B-DEGRADED',family:'B',degraded:true,scale:.80,people:2,firstDay:19},
  {id:'C-CLEAN-HOLDOUT',family:'C',degraded:false,scale:1,people:2,firstDay:12},
  {id:'C-DEGRADED-HOLDOUT',family:'C',degraded:true,scale:.74,people:2,firstDay:19},
];
const all=[];
try{
  await server.listen();
  const port=server.httpServer.address()?.port;
  for(const [browserName,engine] of [['CHROMIUM',chromium],['WEBKIT',webkit]]){
    const browser=await engine.launch({headless:true});
    try{
      const page=await browser.newPage({serviceWorkers:'block'});
      page.setDefaultTimeout(900000);
      const pageErrors=[];
      page.on('pageerror',e=>pageErrors.push(e.message.slice(0,200)));
      await page.goto('http://127.0.0.1:'+port+'/tools/ocr-eval/index.html',
        {waitUntil:'domcontentloaded'});
      const result=await page.evaluate(async(specs)=>{
        const [
          {BrowserScheduleTableStructureDetector},
          {TesseractScheduleImageTextExtractor,TesseractJsWorkerFactory,BrowserScheduleOcrPreprocessor},
          {SAME_ORIGIN_TESSERACT_ASSETS},
          {buildWeekly3ColumnPhysicalMatrix,weekly3ColumnProbeRegions,
            resolveWeekly3ColumnDates,interpretWeekly3Column},
          {createPaddleDetectedRegionRecognizer},
          {parseScheduleImageClock},
        ]=await Promise.all([
          import('/src/providers/import/ScheduleTableStructureDetector.ts'),
          import('/src/providers/import/TesseractScheduleImageTextExtractor.ts'),
          import('/src/providers/import/ocrRuntimeConfig.ts'),
          import('/src/providers/import/Weekly3ColumnScheduleMatrix.ts'),
          import('/tools/ocr-eval/paddle-onnx-browser-entry.js'),
          import('/src/providers/import/StructuredTableImageScheduleRecognizer.ts'),
        ]);
        const names={A:['강하현','정지윤'],B:['박민준','최서연'],C:['한채린','서유진']};
        const painter=async spec=>{
          await document.fonts.load('bold 23px "Nanum Gothic"');
          const top=75,left=18,personWidth=150,colWidth=61,rowHeight=65,heads=2;
          const w=left+personWidth+21*colWidth+18;
          const h=top+(heads+spec.people)*rowHeight+18;
          const canvas=document.createElement('canvas');
          canvas.width=Math.round(w*spec.scale);
          canvas.height=Math.round(h*spec.scale);
          const ctx=canvas.getContext('2d',{alpha:false});
          ctx.scale(spec.scale,spec.scale);
          ctx.fillStyle=spec.degraded?'#f6f4f0':'#fff';ctx.fillRect(0,0,w,h);
          ctx.font='bold 26px "Nanum Gothic"';ctx.fillStyle='#151515';
          ctx.fillText('2026년 10월',left+5,47);
          const shifts=[];
          for(let d=0;d<7;d++){
            const x=left+personWidth+d*colWidth*3;
            ctx.font='bold 22px "Nanum Gothic"';
            ctx.fillText(String(spec.firstDay+d)+'일',x+colWidth+8,top+45);
            ['출근','퇴근','쉬는시간'].forEach((text,f)=>{
              ctx.font='bold 14px "Nanum Gothic"';
              ctx.fillText(text,x+f*colWidth+5,top+rowHeight+45);
            });
          }
          for(let p=0;p<spec.people;p++){
            const y=top+(heads+p)*rowHeight;
            ctx.font='bold 22px "Nanum Gothic"';ctx.fillStyle='#191919';
            ctx.fillText(names[spec.family][p],left+8,y+43);
            for(let d=0;d<7;d++){
              const isOff=p===0&&(d===2||d===3);
              for(let f=0;f<3;f++){
                const x=left+personWidth+(d*3+f)*colWidth;
                ctx.fillStyle=isOff?(d===2?'#d2d2d2':'#ffe291'):'#fff';
                ctx.fillRect(x+2,y+2,colWidth-4,rowHeight-4);
                if(!isOff){
                  const text=['9.5','23.5','0.5'][f];
                  ctx.font='bold 19px "Nanum Gothic"';ctx.fillStyle='#181818';
                  ctx.fillText(text,x+7,y+42);
                }
              }
              shifts.push({person:names[spec.family][p],row:p,day:d,
                state:isOff?'OFF':'WORK',start:isOff?null:'09:30',
                end:isOff?null:'23:30',break:isOff?null:'0.5',
                date:'2026-10-'+String(spec.firstDay+d).padStart(2,'0')});
            }
          }
          ctx.strokeStyle=spec.degraded?'#787878':'#545454';
          ctx.lineWidth=spec.degraded?1.6:1.8;
          for(let c=0;c<=22;c++){
            const x=c===0?left:c===1?left+personWidth:
              left+personWidth+(c-1)*colWidth;
            ctx.beginPath();ctx.moveTo(x,top);
            ctx.lineTo(x,top+(heads+spec.people)*rowHeight);ctx.stroke();
          }
          for(let r=0;r<=heads+spec.people;r++){
            const y=top+r*rowHeight;
            ctx.beginPath();ctx.moveTo(left,y);
            ctx.lineTo(left+personWidth+21*colWidth,y);ctx.stroke();
          }
          const blob=await new Promise((resolve,reject)=>canvas.toBlob(
            v=>v?resolve(v):reject(Error('raster encode failed')),
            spec.degraded?'image/jpeg':'image/png',
            spec.degraded?.72:1));
          return {file:new File([blob],spec.id+'.png',{type:blob.type}),truth:shifts};
        };
        const paddle=await createPaddleDetectedRegionRecognizer();
        const comparisons=[];
        try{
          for(const spec of specs){
            const {file,truth}=await painter(spec);
            const detector=new BrowserScheduleTableStructureDetector();
            const started=performance.now();
            const detection=await detector.detect(file);
            const tesseract=new TesseractScheduleImageTextExtractor(
              new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS),
              new BrowserScheduleOcrPreprocessor(),{useStructureFirstMode:true});
            const titleLayout=await tesseract.extract(file);
            const physical=buildWeekly3ColumnPhysicalMatrix(detection,titleLayout);
            const shared=physical?weekly3ColumnProbeRegions(physical):[];
            const geometryMs=Math.round(performance.now()-started);
            let tResults=[],pResults=[],tMs=0,pMs=0;
            if(physical){
              const tt=performance.now();
              tResults=await tesseract.extractRegions(file,shared);
              tMs=Math.round(performance.now()-tt);
              const pt=performance.now();
              pResults=(await paddle.recognizeRegions(file,shared)).results;
              pMs=Math.round(performance.now()-pt);
            }
            const tMap=new Map(tResults.map(r=>[r.id,r]));
            const pMap=new Map(pResults.map(r=>[r.id,r]));
            const architectures={};
            for(const arch of ['TESSERACT','PADDLE','H1','H2','H3']){
              const pick=region=>{
                const t=tMap.get(region.id),p=pMap.get(region.id);
                if(arch==='TESSERACT')return t;
                if(arch==='PADDLE')return p;
                if(arch==='H1')return region.purpose==='cell'?p:t;
                if(arch==='H2')return region.purpose==='date'?t:p;
                if(!t?.text?.trim())return p;
                if(!p?.text?.trim())return t;
                if(t.text.trim()===p.text.trim())return p.confidence>t.confidence?p:t;
                return {id:region.id,purpose:region.purpose,text:'',tokens:[],confidence:0};
              };
              const resolved=shared.map(region=>{
                const o=pick(region);
                return o??{id:region.id,purpose:region.purpose,text:'',tokens:[],confidence:0};
              });
              const dateEvidence=physical?resolveWeekly3ColumnDates(
                physical,titleLayout,resolved.filter(x=>x.purpose==='date')):null;
              const interpreted=physical?interpretWeekly3Column(physical,dateEvidence,resolved,names[spec.family]):null;
              let peopleCorrect=0,dateCorrect=0,startCorrect=0,endCorrect=0,
                breakCorrect=0,startTotal=0,endTotal=0,breakTotal=0,falseOff=0;
              for(let p=0;p<spec.people;p++){
                const id='weekly-person::'+p;
                if(resolved.find(x=>x.id===id)?.text.trim()===names[spec.family][p])
                  peopleCorrect++;
              }
              for(let d=0;d<7;d++){
                const observed=dateEvidence?.dates[d]?.date;
                if(observed==='2026-10-'+String(spec.firstDay+d).padStart(2,'0'))dateCorrect++;
              }
              for(const cell of truth){
                for(const [field,expected] of [['start',cell.start],['end',cell.end],['break',cell.break]]){
                  if(expected==null)continue;
                  const result=resolved.find(x=>x.id==='weekly::'+cell.row+'::'+cell.day+'::'+field);
                  const text=result?.text.trim()??'';
                  const normalized=field==='break'?text:parseScheduleImageClock(text);
                  if(field==='start'){startTotal++;if(normalized===expected)startCorrect++;}
                  if(field==='end'){endTotal++;if(normalized===expected)endCorrect++;}
                  if(field==='break'){breakTotal++;if(normalized===expected)breakCorrect++;}
                }
              }
              const completed=!!interpreted?.parsed;
              const reconstructed=completed?new Map([
                ...interpreted.parsed.scheduleCandidates.map(x=>[x.sourcePersonName+'|'+x.date,'WORK']),
                ...(interpreted.parsed.reviewCandidates??[]).map(x=>[x.sourcePersonName+'|'+x.date,
                  x.recognitionState??'UNREADABLE']),
              ]):new Map();
              let cellCorrect=0;
              for(const cell of truth){
                const observed=reconstructed.get(cell.person+'|'+cell.date);
                if(observed===cell.state)cellCorrect++;
                if(cell.state!=='OFF'&&observed==='OFF')falseOff++;
              }
              const logical=truth.map(cell=>
                reconstructed.get(cell.person+'|'+cell.date)??'MISSING');
              architectures[arch]={
                personCorrect:peopleCorrect,personTotal:spec.people,
                dateCorrect,dateTotal:7,startCorrect,startTotal,
                endCorrect,endTotal,breakCorrect,breakTotal,
                cellCorrect,cellTotal:truth.length,
                falseOff,complete:completed&&reconstructed.size===truth.length,
                blockedReason:interpreted?.blockedReason??'STRUCTURE_NOT_DETECTED',
                offReviewCount:interpreted?.offReviewCount??0,
                blankSpans:interpreted?.consecutiveBlankSpans.length??0,
                logical,
                totalMs:geometryMs+(arch==='TESSERACT'?tMs:
                  arch==='PADDLE'?pMs:tMs+pMs),
              };
            }
            comparisons.push({
              id:spec.id,family:spec.family,degraded:spec.degraded,
              physical:!!physical,rows:physical?.rows.length??0,
              physicalCells:physical?.physicalCellCount??0,
              headerSource:physical?.headerSource??null,
              detectedColumns:detection.structure.columnBands.length,
              geometryMs,tMs,pMs,architectures,
            });
          }
        }finally{await paddle.release()}
        return {model:paddle.metadata,comparisons,
          browserHeapBytes:performance.memory?.usedJSHeapSize??null};
      },specs);
      all.push({browser:browserName,pageErrors,result});
    }finally{await browser.close();}
  }
}finally{await server.close();}

const engines=['TESSERACT','PADDLE','H1','H2','H3'];
const summary={};
for(const engine of engines){
  let sums={personCorrect:0,personTotal:0,dateCorrect:0,dateTotal:0,
    startCorrect:0,startTotal:0,endCorrect:0,endTotal:0,
    breakCorrect:0,breakTotal:0,cellCorrect:0,cellTotal:0,
    falseOff:0,complete:0,images:0};
  for(const browser of all)for(const image of browser.result.comparisons){
    const score=image.architectures[engine];
    for(const key of Object.keys(sums)){
      if(key==='images'){sums.images++;continue;}
      if(key==='complete'){sums.complete+=Number(score.complete);continue;}
      sums[key]+=score[key]??0;
    }
  }
  const ratio=(a,b)=>b?a/b:null;
  summary[engine]={person:ratio(sums.personCorrect,sums.personTotal),
    date:ratio(sums.dateCorrect,sums.dateTotal),
    start:ratio(sums.startCorrect,sums.startTotal),
    end:ratio(sums.endCorrect,sums.endTotal),
    break:ratio(sums.breakCorrect,sums.breakTotal),
    cell:ratio(sums.cellCorrect,sums.cellTotal),
    completeRate:ratio(sums.complete,sums.images),
    falseOff:sums.falseOff,totals:sums};
}
const parity={};
for(const engine of engines){
  const a=all.find(x=>x.browser==='CHROMIUM'),b=all.find(x=>x.browser==='WEBKIT');
  let equal=0,total=0;
  for(const image of a.result.comparisons){
    const other=b.result.comparisons.find(x=>x.id===image.id);
    const aa=image.architectures[engine].logical,bb=other.architectures[engine].logical;
    for(let i=0;i<aa.length;i++){total++;if(aa[i]===bb[i])equal++;}
  }
  parity[engine]={match:equal,total,rate:total?equal/total:null};
}
const report={
  scope:'MONDAY_SUNDAY_7_DAYS_X_START_END_BREAK_3_COLUMNS',
  oracleInjected:false,userRealImages:false,sharedDetectedRois:true,
  physicalIPhone:'PHYSICAL_IPHONE_NOT_VERIFIED',
  all,summary,parity,
};
console.log('CBH_WEEKLY_3COL_REAL_COMPARE='+JSON.stringify(report));
if(all.some(x=>x.pageErrors.length))throw Error('Weekly OCR runtime errors');
const accepted=engines.filter(engine=>{
  const q=summary[engine];
  return q.person>=.98&&q.date>=.99&&q.start>=.97&&q.end>=.97&&
    q.cell>=.98&&q.falseOff===0&&q.completeRate>=.99&&parity[engine].rate>=.99;
});
console.log('CBH_WEEKLY_3COL_ACCEPTED='+JSON.stringify(accepted));
if(!accepted.length)throw Error('Weekly 3col OCR still below quality gate; do not merge PR81');
