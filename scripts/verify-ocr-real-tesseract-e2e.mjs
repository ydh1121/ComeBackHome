import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

// Real encoded PNG/JPEG -> image decode -> production preprocessor ->
// actual Tesseract kor+eng workers -> pixel grid -> cell matrix -> review.
// No synthetic OCR token/region injection, no user schedule image, no API calls.
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
const specs = [
  { id: 'A1', family: 'A', people: 3, days: 5, border: 'full', format: 'png', quality: 1, scale: 1, background: '#fff', skew: 0 },
  { id: 'B1', family: 'B', people: 4, days: 6, border: 'partial', format: 'jpeg', quality: 0.76, scale: 0.82, background: '#f3f3e9', skew: 0 },
  { id: 'C1', family: 'C', people: 2, days: 4, border: 'none', format: 'png', quality: 1, scale: 1.15, background: '#eef0f4', skew: 0.008 },
];
const observed = [];
try {
  await server.listen();
  const port = server.httpServer.address()?.port;
  assert.equal(typeof port, 'number');
  for (const [name, engine] of [['CHROMIUM', chromium], ['WEBKIT', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ serviceWorkers: 'block' });
      page.setDefaultTimeout(240000);
      await page.goto('http://127.0.0.1:' + port + '/tools/ocr-eval/index.html',
        { waitUntil: 'domcontentloaded' });
      for (const spec of specs) {
        const result = await page.evaluate(async (input) => {
          const [{BrowserScheduleOcrPreprocessor,TesseractJsWorkerFactory,
            TesseractScheduleImageTextExtractor},
            {BrowserScheduleTableStructureDetector},
            {StructureFirstScheduleImageRecognizer},
            {SAME_ORIGIN_TESSERACT_ASSETS}] = await Promise.all([
            import('/src/providers/import/TesseractScheduleImageTextExtractor.ts'),
            import('/src/providers/import/ScheduleTableStructureDetector.ts'),
            import('/src/providers/import/StructureFirstScheduleImageRecognizer.ts'),
            import('/src/providers/import/ocrRuntimeConfig.ts'),
          ]);
          const width = 185 + input.days * 141;
          const height = 110 + (input.people + 1) * 82;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * input.scale);
          canvas.height = Math.round(height * input.scale);
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) throw Error('Canvas 2D unavailable');
          ctx.setTransform(input.scale, 0, input.skew * input.scale, input.scale, 0, 0);
          ctx.fillStyle = input.background;
          ctx.fillRect(0, 0, width, height);
          // The generated quality corpus uses a pinned Korean font, not an
          // OS-dependent sans-serif fallback (which differs across CI hosts).
          const left=22, top=75, labelWidth=151, cellWidth=141, rowHeight=82;
          const border='#5a5e65';
          ctx.fillStyle='#111';
          ctx.textAlign='left';
          ctx.font='bold 27px "Nanum Gothic", sans-serif';
          ctx.fillText('2026년 10월',left+7,47);
          ctx.font='bold 19px "Nanum Gothic", sans-serif';
          ctx.fillText('이름',left+15,top+49);
          for(let d=0;d<input.days;d++) {
            const x=left+labelWidth+d*cellWidth;
            ctx.font='bold 21px "Nanum Gothic", sans-serif';
            ctx.fillText(String(d+1)+'일',x+47,top+48);
          }
          const names = [];
          const truth = [];
          for(let p=0;p<input.people;p++){
            // Synthesize ordinary Korean name-shaped syllable combinations.
            // Uniform random Unicode produced rare unreadable Hangul; no
            // person name from the user or production database is used.
            const surnames=['김','이','박','최','정','강','조','윤','장','임','한','오','신','서'];
            const middle=['민','서','지','하','도','수','예','현','주','은','채','태','유','다','준'];
            const last=['준','진','원','우','윤','현','아','나','민','영','호','린','희','빈','솔','온'];
            const name=surnames[(p*3+input.days)%surnames.length]
              +middle[(p*5+input.people)%middle.length]
              +last[(p*7+input.days)%last.length];
            names.push(name);
            const y=top+(p+1)*rowHeight;
            ctx.font='bold 24px "Nanum Gothic", sans-serif';
            ctx.fillStyle='#12151b';
            ctx.fillText(name,left+14,y+52);
            for(let d=0;d<input.days;d++){
              const x=left+labelWidth+d*cellWidth;
              const state=(p+d)%6===0?'UNREADABLE':(p+2*d)%5===0?'OFF':
                (p+d)%4===0?'INCOMPLETE':'WORK';
              const date='2026-10-'+String(d+1).padStart(2,'0');
              truth.push({ person:p, date, state,
                start:state==='WORK'||state==='INCOMPLETE'?'09:00':null,
                end:state==='WORK'?'18:00':null });
              if(state==='OFF'){
                ctx.fillStyle=(p+d)%2===0?'#e0e4e8':input.background;
                ctx.fillRect(x+3,y+3,cellWidth-6,rowHeight-6);
              }
              if(state==='WORK'||state==='INCOMPLETE'){
                ctx.fillStyle='#191919';
                ctx.font='bold 23px "Nanum Gothic", sans-serif';
                ctx.fillText('09:00',x+26,y+34);
                if(state==='WORK')ctx.fillText('18:00',x+26,y+64);
              }else if(state==='UNREADABLE'){
                ctx.fillStyle='#444';
                ctx.font='bold 21px "Nanum Gothic", sans-serif';
                ctx.fillText('메모',x+37,y+48);
              }
            }
          }
          if(input.border!=='none'){
            ctx.strokeStyle=border;
            ctx.lineWidth=input.border==='full'?2:1.5;
            for(let y=0;y<=input.people+1;y++){
              if(input.border==='partial'&&y>0&&y%3===0)continue;
              ctx.beginPath();
              ctx.moveTo(left,top+y*rowHeight);
              ctx.lineTo(left+labelWidth+input.days*cellWidth,top+y*rowHeight);
              ctx.stroke();
            }
            for(let d=0;d<=input.days+1;d++){
              if(input.border==='partial'&&d>0&&d%3===0)continue;
              const x=d===0?left:d===1?left+labelWidth:
                left+labelWidth+(d-1)*cellWidth;
              ctx.beginPath();ctx.moveTo(x,top);
              ctx.lineTo(x,top+(input.people+1)*rowHeight);ctx.stroke();
            }
          }
          const blob=await new Promise((resolve,reject)=>canvas.toBlob(
            value=>value?resolve(value):reject(Error('Raster encode failed')),
            input.format==='jpeg'?'image/jpeg':'image/png',input.quality));
          const file=new File([blob],'generated-'+input.id+'.'+input.format,
            {type:blob.type});
          const syntheticOcrHeaders=[];
          let workerPassComplete=false;
          let gridProof=null;
          const focusedDates=[];
          // Test-only trace for development family A; no fixture truth supplied.
          const roiTrace=input.family==='A'?[]:null;
          const realFactory=new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS);
          let currentRoiIds=[];
          const tracedFactory={
            async create(langs){
              const worker=await realFactory.create(langs);
              let psm='',whitelist='';
              return {
                async setParameters(params){
                  psm=String(params.tessedit_pageseg_mode??psm);
                  whitelist=String(params.tessedit_char_whitelist??whitelist);
                  return worker.setParameters(params);
                },
                async recognize(...args){
                  const result=await worker.recognize(...args);
                  if(roiTrace&&currentRoiIds.length&&roiTrace.length<65){
                    roiTrace.push({
                      ids:currentRoiIds.slice(0,4),psm,whitelist,
                      text:String(result.data.text??'').trim().slice(0,60),
                      words:(result.data.blocks??[]).flatMap(b=>(b.paragraphs??[])
                        .flatMap(p=>(p.lines??[]).flatMap(l=>(l.words??[])
                          .map(w=>String(w.text??'').slice(0,20))))).slice(0,8),
                    });
                  }
                  return result;
                },
                terminate:()=>worker.terminate(),
              };
            },
          };
          const extractor=new TesseractScheduleImageTextExtractor(
            tracedFactory,new BrowserScheduleOcrPreprocessor(),
            {useStructureFirstMode:true});
          const originalExtract=extractor.extract.bind(extractor);
          extractor.extract=async (...args)=>{
            const layout=await originalExtract(...args);
            workerPassComplete=true;
            syntheticOcrHeaders.push(...layout.tokens
              .filter(token=>token.y<top+rowHeight)
              .map(token=>token.text.slice(0,28)).slice(0,24));
            return layout;
          };
          const originalRegions=extractor.extractRegions.bind(extractor);
          extractor.extractRegions=async (...args)=>{
            currentRoiIds=args[1].map(r=>r.id);
            let out;
            try{out=await originalRegions(...args);}
            finally{currentRoiIds=[];}
            if(args[1].some(r=>r.purpose==='date')){
              focusedDates.push(...out.flatMap(r=>r.tokens.map(t=>({
                text:t.text,x:Math.round(t.x),confidence:Number(t.confidence.toFixed(2))
              }))));
            }
            return out;
          };
          const detector=new BrowserScheduleTableStructureDetector();
          const originalDetect=detector.detect.bind(detector);
          let detectedGeometry=null;
          detector.detect=async (...args)=>{
            const value=await originalDetect(...args);
            detectedGeometry=value;
            gridProof={
              topBand:value.structure.rowBands[0]?.bounds??null,
              vertical:value.structure.evidence.verticalLinePositions.map(x=>Math.round(x)),
              rows:value.structure.rowBands.length,
              tableBounds:value.structure.tableBounds,
            };
            return value;
          };
          const recognizer=new StructureFirstScheduleImageRecognizer(
            detector,extractor,
            async()=>[...names],
          );
          let diagnostics=null;
          let failure=null;
          try { diagnostics=await recognizer.evaluate(file); }
          catch(error){failure=error instanceof Error?error.message.slice(0,220):'Unknown OCR error';}
          const gtRect=(x,y,w,h)=>({x:(x+input.skew*y)*input.scale,
            y:y*input.scale,width:(w+Math.abs(input.skew)*h)*input.scale,height:h*input.scale});
          const iou=(a,b)=>{if(!a||!b)return 0;
            const w=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
            const h=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
            const intersection=w*h,union=a.width*a.height+b.width*b.height-intersection;
            return union>0?Number((intersection/union).toFixed(4)):0;};
          const meanBest=(expected,actual)=>expected.length?
            Number((expected.reduce((sum,gt)=>sum+
              Math.max(0,...actual.map(v=>iou(gt,v))),0)/expected.length).toFixed(4)):null;
          const trueRows=Array.from({length:input.people},(_,p)=>
            gtRect(left,top+(p+1)*rowHeight,labelWidth+input.days*cellWidth,rowHeight));
          const trueColumns=Array.from({length:input.days},(_,d)=>
            gtRect(left+labelWidth+d*cellWidth,top,cellWidth,(input.people+1)*rowHeight));
          const found=detectedGeometry?.structure;
          const geometry={
            tableBoundsIoU:iou(gtRect(left,top,labelWidth+input.days*cellWidth,
              (input.people+1)*rowHeight),found?.tableBounds),
            rowBandIoU:meanBest(trueRows,found?.rowBands.map(x=>x.bounds)??[]),
            columnBandIoU:meanBest(trueColumns,found?.columnBands.map(x=>x.bounds)??[]),
            personRowIoU:meanBest(trueRows,diagnostics?.matrix.rows.map(x=>x.bounds)??[]),
            dateColumnIoU:meanBest(trueColumns,diagnostics?.matrix.dates.map(x=>x.bounds)??[]),
            cellRectIoU:meanBest(Array.from({length:input.people},(_,p)=>
              Array.from({length:input.days},(_,d)=>gtRect(
                left+labelWidth+d*cellWidth,top+(p+1)*rowHeight,
                cellWidth,rowHeight))).flat(),diagnostics?.matrix.cells.map(x=>x.bounds)??[]),
            detectedRows:found?.rowBands.length??0,
            detectedColumns:found?.columnBands.length??0,
            matrixRows:diagnostics?.matrix.rows.length??0,
            matrixDates:diagnostics?.matrix.dates.length??0};
          // Oracle geometry is test-only; it is never injected into recognition.
          const firstWork=truth.find(x=>x.state==='WORK');
          const workDay=firstWork?Number(firstWork.date.slice(-2))-1:0;
          const oracleRegions=[
            {id:'oracle::person',purpose:'person',
              ...gtRect(left,top+rowHeight,labelWidth,rowHeight)},
            {id:'date::grid-cell::oracle',purpose:'date',
              ...gtRect(left+labelWidth,top,cellWidth,rowHeight)},
            {id:'oracle::cell',purpose:'cell',...gtRect(
              left+labelWidth+workDay*cellWidth,
              top+((firstWork?.person??0)+1)*rowHeight,cellWidth,rowHeight)}];
          let oracleCrop={executed:false,error:null};
          try{
            const results=await extractor.extractRegions(file,oracleRegions);
            const person=results.find(x=>x.id==='oracle::person');
            const date=results.find(x=>x.id==='date::grid-cell::oracle');
            const cell=results.find(x=>x.id==='oracle::cell');
            const timeRaw=cell?.tokens.map(x=>x.text).join(' ')??'';
            oracleCrop={executed:true,error:null,personRaw:person?.text??'',
              personExact:(person?.text??'').replace(/\s+/g,'')===names[0],
              dateRaw:date?.text??'',dateExact:(date?.text??'').trim()==='1',
              timeRaw,startExact:/09\s*:\s*00/.test(timeRaw),
              endExact:firstWork?.end?/18\s*:\s*00/.test(timeRaw):null};
          }catch(e){oracleCrop.error=e instanceof Error?e.message.slice(0,130):'OCR error';}
          const detectedCrop={available:!!diagnostics,
            personRaw:diagnostics?.regionResults.find(x=>x.id==='person::1')?.text??null,
            dateMatched:!!diagnostics?.matrix.dates.some(x=>x.date==='2026-10-01'),
            cellRaw:firstWork?diagnostics?.regionResults.find(x=>
              x.id==='cell::'+(firstWork.person+1)+'::'+firstWork.date)?.text??null:null};
          const parsed=diagnostics?.parsed;
          const observations=new Map();
          for(const item of parsed?.scheduleCandidates??[])observations.set(
            item.sourceRow+'|'+item.date,{state:'WORK',start:item.start,end:item.end});
          for(const item of parsed?.reviewCandidates??[])observations.set(
            item.sourceRow+'|'+item.date,
            {state:item.recognitionState,start:item.start,end:item.end});
          let correct=0,falseOff=0,matchedTime=0,timeTotal=0;
          const signature=[];
          for(const cell of truth){
            const result=observations.get((cell.person+1)+'|'+cell.date);
            const state=result?.state??'UNREADABLE';
            signature.push(state);
            if(state===cell.state)correct++;
            if(state==='OFF'&&cell.state!=='OFF')falseOff++;
            if(cell.start){timeTotal++;if(cell.start===result?.start)matchedTime++;}
            if(cell.end){timeTotal++;if(cell.end===result?.end)matchedTime++;}
          }
          const recognized=new Set((parsed?.detectedPeople??[]).map(x=>x.sourceName));
          return {
            family:input.family,codec:blob.type,bytes:blob.size,
            imageDecoded:canvas.width>0,
            generatedHeaderEvidence:syntheticOcrHeaders,
            generatedGrid: gridProof,
            geometry,oracleCrop,detectedCrop,
            generatedFocusedDateTokens: focusedDates,
            actualRoiTrace:roiTrace,
            actualTesseractFirstPass:workerPassComplete,
            fullPipelineSuccess:failure===null,
            realTesseractExecuted:workerPassComplete,
            error:failure?.slice(0,160)??null,cellCount:truth.length,correct,
            falseOff,personTotal:names.length,
            personExact:names.filter(name=>recognized.has(name)).length,
            reviewOnlyUnresolvedRows:[...recognized]
              .filter(name=>name.startsWith('이름 확인 필요 (')).length,
            garbagePerson:[...recognized].filter(name=>
              !names.includes(name)&&!name.startsWith('이름 확인 필요 (')).length,
            dateTotal:input.days,dateRecovered:diagnostics?.matrix.dates.length??0,
            dateExact:(diagnostics?.matrix.dates??[]).filter(day=>
              truth.some(cell=>cell.date===day.date)).length,
            nonOffCount:truth.filter(cell=>cell.state!=='OFF').length,
            timeTotal,matchedTime,
            structure:diagnostics?.matrix.geometrySource??'FAILED',
            ocrTokens:diagnostics?.layoutTokenCount??0,
            logicalSignature:signature.join(','),
          };
        },spec);
        observed.push({browser:name,id:spec.id,...result});
      }
    } finally { await browser.close(); }
  }
  const lines=[];
  let allCells=0,allCorrect=0,falseOff=0,garbage=0;
  let personTotal=0,personExact=0,dateTotal=0,dateExact=0;
  let timeTotal=0,matchedTime=0,nonOffCount=0;
  for(const item of observed){
    allCells+=item.cellCount;
    allCorrect+=item.correct;
    falseOff+=item.falseOff;
    garbage+=item.garbagePerson;
    personTotal+=item.personTotal;personExact+=item.personExact;
    dateTotal+=item.dateTotal;dateExact+=item.dateExact;
    timeTotal+=item.timeTotal;matchedTime+=item.matchedTime;
    nonOffCount+=item.nonOffCount;
    const {logicalSignature,...safe}=item;
    lines.push(safe);
  }
  const parityEligible=observed.every(item=>item.fullPipelineSuccess);
  const parity=parityEligible && specs.every(({id})=>{
    const pair=observed.filter(item=>item.id===id);
    return pair.length===2&&pair[0].logicalSignature===pair[1].logicalSignature;
  });
  const avg=(metric,entries=observed)=>{const values=entries.map(x=>x.geometry?.[metric])
    .filter(Number.isFinite);return values.length?
      Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(4)):null;};
  const diagnostic={
    tableBoundsIoU:avg('tableBoundsIoU'),rowBandIoU:avg('rowBandIoU'),
    columnBandIoU:avg('columnBandIoU'),personRowIoU:avg('personRowIoU'),
    dateColumnIoU:avg('dateColumnIoU'),cellRectIoU:avg('cellRectIoU'),
    oracleRuns:observed.filter(x=>x.oracleCrop?.executed).length,
    oraclePersonExact:observed.filter(x=>x.oracleCrop?.personExact).length,
    oracleDateExact:observed.filter(x=>x.oracleCrop?.dateExact).length,
    oracleStartExact:observed.filter(x=>x.oracleCrop?.startExact).length,
    oracleEndExact:observed.filter(x=>x.oracleCrop?.endExact).length,
    detectedRegionComparable:observed.filter(x=>x.detectedCrop?.available).length,
    perFamily:Object.fromEntries(specs.map(spec=>[spec.family,{
      tableBoundsIoU:avg('tableBoundsIoU',observed.filter(x=>x.family===spec.family)),
      rows:avg('rowBandIoU',observed.filter(x=>x.family===spec.family)),
      columns:avg('columnBandIoU',observed.filter(x=>x.family===spec.family))}])),
  };
  const metrics={geometryOracleDiagnostic:diagnostic,
    realRasterGeneratorFamilies:3,realRasterImages:observed.length,
    codecs:['PNG','JPEG'],engine:'Tesseract.js kor+eng / production structure recognizer',
    precomputedOcrTokensSupplied:false,
    executed:observed.every(item=>item.realTesseractExecuted),
    completedRealE2E:observed.every(item=>item.fullPipelineSuccess),
    realOcrAcceptance:observed.every(item=>item.fullPipelineSuccess)?'METRICS_ONLY':'FAIL',
    cellAccuracy:allCells?Number((allCorrect/allCells).toFixed(4)):0,
    falseOff:parityEligible?falseOff:null,
    falseOffRate:parityEligible&&nonOffCount?Number((falseOff/nonOffCount).toFixed(4)):null,
    personAccuracy:personTotal?Number((personExact/personTotal).toFixed(4)):0,
    dateAccuracy:dateTotal?Number((dateExact/dateTotal).toFixed(4)):0,
    timeAccuracy:timeTotal?Number((matchedTime/timeTotal).toFixed(4)):0,
    falseOffOnParsedCells:parityEligible?falseOff:0,
    cellsWithoutCompletePipeline:observed.filter(item=>!item.fullPipelineSuccess)
      .reduce((sum,item)=>sum+item.cellCount,0),
    garbagePerson:garbage,
    chromium:observed.filter(item=>item.browser==='CHROMIUM').some(x=>x.realTesseractExecuted)?'RAN':'FAIL',
    webkit:observed.filter(item=>item.browser==='WEBKIT').some(x=>x.realTesseractExecuted)?'RAN':'FAIL',
    logicalParity:!parityEligible?'NOT_EVALUABLE':parity?'PASS':'FAIL',
    userOriginalImageUsed:false,acceptance:'NOT_CLAIMED',
    byImage:lines,
  };
  const pilotPass=metrics.completedRealE2E &&
    metrics.logicalParity==='PASS' &&
    metrics.cellAccuracy>=0.95 &&
    metrics.falseOffRate!==null && metrics.falseOffRate<=0.01 &&
    metrics.personAccuracy>=0.95 && metrics.dateAccuracy>=0.98 &&
    metrics.timeAccuracy>=0.95 && metrics.garbagePerson===0;
  metrics.pilotQualityGate=pilotPass?'PASS':'FAIL';
  metrics.fullIndependentHoldoutAcceptance='NOT_TESTED';
  console.log(JSON.stringify(metrics,null,2));
  assert.equal(metrics.realRasterImages,6,'Generated real glyph fixture matrix incomplete');
  assert.ok(metrics.executed,'No actual Tesseract pipeline executed');
  assert.ok(pilotPass,'Actual Tesseract pilot failed objective quality thresholds');
} finally {
  await server.close();
}
