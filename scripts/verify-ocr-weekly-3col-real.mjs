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
  {id:'A-DEGRADED',family:'A',degraded:true,scale:.8,people:2,firstDay:19},
  {id:'B-CLEAN',family:'B',degraded:false,scale:1,people:2,firstDay:12},
  {id:'B-DEGRADED',family:'B',degraded:true,scale:.80,people:2,firstDay:19},
  {id:'C-CLEAN-HOLDOUT',family:'C',degraded:false,scale:1,people:2,firstDay:12},
  {id:'C-DEGRADED-HOLDOUT',family:'C',degraded:true,scale:.74,people:2,firstDay:19},
];
const all=[];
let immutableImageBytes=null;
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
      page.on('console',m=>{
        if(m.text().startsWith('CBH_OCR_TRACE:'))console.log(m.text());
      });
      await page.goto('http://127.0.0.1:'+port+'/tools/ocr-eval/index.html',
        {waitUntil:'domcontentloaded'});
      const result=await page.evaluate(async({specs,immutableImageBytes})=>{
        const [
          {BrowserScheduleTableStructureDetector},
          {TesseractScheduleImageTextExtractor,TesseractJsWorkerFactory,BrowserScheduleOcrPreprocessor},
          {SAME_ORIGIN_TESSERACT_ASSETS},
          {buildWeekly3ColumnPhysicalMatrix,weekly3ColumnProbeRegions,
            resolveWeekly3ColumnDates,interpretWeekly3Column},
          {PaddleWeeklyRegionalTextExtractor},
          {parseScheduleImageClock},
          {MockStateStore,MOCK_FIXTURE},
          {MockPersonRepository,MockScheduleRepository},
          {BrowserImportRepository},
          {WorkbookImportFileSelectionAction},
          {CommitImportReview},
        ]=await Promise.all([
          import('/src/providers/import/ScheduleTableStructureDetector.ts'),
          import('/src/providers/import/TesseractScheduleImageTextExtractor.ts'),
          import('/src/providers/import/ocrRuntimeConfig.ts'),
          import('/src/providers/import/Weekly3ColumnScheduleMatrix.ts'),
          import('/src/providers/import/PaddleWeeklyRegionalTextExtractor.ts'),
          import('/src/providers/import/StructuredTableImageScheduleRecognizer.ts'),
          import('/src/mocks/state.ts'),
          import('/src/mocks/repositories.ts'),
          import('/src/providers/browser/BrowserImportRepository.ts'),
          import('/src/application/services/WorkbookImportFileSelectionAction.ts'),
          import('/src/application/use-cases/commitImportReview.ts'),
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
        // This *is* the app's real image-upload Paddle extractor, not an
        // independent test-only ONNX runner. Same-origin staged product assets.
        const productPaddle=new PaddleWeeklyRegionalTextExtractor();
        const paddle={
          get metadata(){return productPaddle.metadata;},
          async recognizeRegions(file,regions){
            const results=await productPaddle.extractRegions(file,regions);
            return {results,inferenceMs:0};
          },
          async release(){await productPaddle.dispose();},
        };
        const comparisons=[],generatedRasters=[];
        try{
          for(const spec of specs){
            console.info('CBH_OCR_TRACE: START '+spec.id);
            const generated=await painter(spec);
            let {file}=generated;
            const {truth}=generated;
            if(immutableImageBytes){
              const encoded=immutableImageBytes[spec.id];
              if(!encoded)throw Error('Missing immutable shared browser input');
              const binary=atob(encoded.base64);
              const bytes=new Uint8Array(binary.length);
              for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
              file=new File([bytes],spec.id+'.png',{type:encoded.type});
            }else{
              const bytes=new Uint8Array(await file.arrayBuffer());
              const pieces=[];
              for(let at=0;at<bytes.length;at+=8192){
                pieces.push(String.fromCharCode(...bytes.subarray(at,at+8192)));
              }
              generatedRasters.push({
                id:spec.id,base64:btoa(pieces.join('')),type:file.type,
                bytes:bytes.length,
              });
            }
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
                physical,titleLayout,resolved.filter(x=>x.purpose==='date'||x.purpose==='context')):null;
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
              let cellCorrect=0,reviewableCellCorrect=0,
                autoStateCount=0,autoStateCorrect=0,falseWork=0,
                confirmedOffPredicted=0,
                workTruth=0,workCorrect=0,workPredicted=0,
                reviewRequiredTotal=0,reviewRequiredSurfaced=0,
                offCandidateCount=0,offCandidateCorrect=0,offCandidateFalse=0,offTruth=0;
              const reviewKeys=new Set((interpreted?.parsed?.reviewCandidates??[])
                .map(x=>x.sourcePersonName+'|'+x.date));
              for(const cell of truth){
                const observed=reconstructed.get(cell.person+'|'+cell.date);
                if(observed===cell.state)cellCorrect++;
                // This is a predicted state, not permission to bypass import review.
                if(observed==='WORK'||observed==='OFF'){
                  autoStateCount++;
                  if(observed===cell.state)autoStateCorrect++;
                }
                if(cell.state==='WORK')workTruth++;
                if(observed==='WORK'){
                  workPredicted++;
                  if(cell.state==='WORK')workCorrect++;
                }
                if(observed==='WORK'&&cell.state==='OFF')falseWork++;
                // Even a correctly guessed OFF is prohibited before consent.
                if(observed==='OFF')confirmedOffPredicted++;
                // The user must be able to review every unresolved / disputed
                // state. Missing cells and false WORK-on-OFF are review-required,
                // but may NOT be counted as visible unless in reviewCandidates.
                if(observed!=='WORK'||cell.state!=='WORK'){
                  reviewRequiredTotal++;
                  if(reviewKeys.has(cell.person+'|'+cell.date))
                    reviewRequiredSurfaced++;
                }
                if(observed===cell.state||
                   (cell.state==='OFF'&&observed==='OFF_CANDIDATE'))
                  reviewableCellCorrect++;
                if(cell.state==='OFF')offTruth++;
                if(observed==='OFF_CANDIDATE'){
                  offCandidateCount++;
                  if(cell.state==='OFF')offCandidateCorrect++;
                  else offCandidateFalse++;
                }
                if(cell.state!=='OFF'&&observed==='OFF')falseOff++;
              }
              const logical=truth.map(cell=>
                reconstructed.get(cell.person+'|'+cell.date)??'MISSING');
              architectures[arch]={
                personCorrect:peopleCorrect,personTotal:spec.people,
                dateCorrect,dateTotal:7,startCorrect,startTotal,
                endCorrect,endTotal,breakCorrect,breakTotal,
                cellCorrect,cellTotal:truth.length,reviewableCellCorrect,
                autoStateCount,autoStateCorrect,falseWork,confirmedOffPredicted,
                workTruth,workCorrect,workPredicted,
                reviewRequiredTotal,reviewRequiredSurfaced,
                offCandidateCount,offCandidateCorrect,offCandidateFalse,offTruth,
                falseOff,complete:completed&&reconstructed.size===truth.length,
                blockedReason:interpreted?interpreted.blockedReason:'STRUCTURE_NOT_DETECTED',
                dateEvidence:dateEvidence?{
                  yearMonthObserved:dateEvidence.yearMonthObserved,
                  observedDayAnchors:dateEvidence.observedDayAnchors,
                  uniqueWeek:dateEvidence.uniqueWeek,
                }:null,
                offReviewCount:interpreted?.offReviewCount??0,
                blankSpans:interpreted?.consecutiveBlankSpans.length??0,
                logical,
                totalMs:geometryMs+(arch==='TESSERACT'?tMs:
                  arch==='PADDLE'?pMs:tMs+pMs),
              };
            }
            // Generic crop-to-text-to-parser failure trace for *every*
            // generated layout. Holdout samples remain excluded from tuning.
            // End-to-end: generated real raster -> actual Paddle output ->
            // actual parser -> import review action -> approved mock DB writes.
            // This is not a production D1 verification or a user-image test.
            let imageToReviewToMockDb=null;
            if(physical){
              const resolvedDates=resolveWeekly3ColumnDates(physical,titleLayout,
                pResults.filter(x=>x.purpose==='date'||x.purpose==='context'));
              const parsed=interpretWeekly3Column(
                physical,resolvedDates,pResults,names[spec.family]).parsed;
              if(!parsed)throw Error('Weekly E2E actual image did not parse');
              const state=new MockStateStore(structuredClone(MOCK_FIXTURE));
              state.mutate(data=>{
                data.people=names[spec.family].map((name,i)=>({
                  id:'generated-person-'+i,name,relation:'generated',
                }));
                data.schedules=[];
                data.importBatches=[];
                data.committedImportBatchIds=[];
              });
              const imports=new BrowserImportRepository(),
                peopleRepo=new MockPersonRepository(state),
                schedules=new MockScheduleRepository(state);
              const selection=new WorkbookImportFileSelectionAction(
                imports,peopleRepo,schedules,
                {async parse(){throw Error('Unexpected workbook selection');}},
                {async parse(){return parsed;}},
              );
              const batchId=await selection.accept([{kind:'IMAGE',file}]);
              const initial=await imports.getBatch(batchId);
              if(!initial||initial.reviewItems.length!==truth.length||
                 initial.reviewItems.some(x=>x.resolution!==null))
                throw Error('Weekly E2E review count or unreviewed default failed');
              let blocked=false;
              try{await new CommitImportReview(imports,schedules).execute(batchId)}
              catch(error){blocked=String(error).includes('unreviewed');}
              if(!blocked||state.read().schedules.length)
                throw Error('Weekly E2E skipped required user approvals');
              // Actual production browser-review repository must revoke a
              // prior decision if a user corrects even an OCR rest duration.
              const editable=initial.reviewItems.find(x=>
                x.recognitionState==='WORK'&&x.imported.breakMinutes===30);
              if(!editable)throw Error('Missing editable OCR break evidence');
              await imports.setResolution(batchId,editable.id,'NEW');
              await imports.setImportedBreakMinutes(batchId,editable.id,45);
              const afterEdit=await imports.getBatch(batchId);
              const corrected=afterEdit.reviewItems.find(x=>x.id===editable.id);
              if(corrected?.resolution!==null||corrected.imported.breakMinutes!==45)
                throw Error('Break correction failed to revoke browser approval');
              await imports.setImportedBreakMinutes(batchId,editable.id,30);
              const restored=await imports.getBatch(batchId);
              if(restored.reviewItems.find(x=>x.id===editable.id)?.resolution!==null)
                throw Error('Restoring original break silently reapproved imported schedule');
              let approvedOff=0,approvedWork=0;
              for(const item of initial.reviewItems){
                const expected=truth.find(x=>x.person===
                  initial.detectedPeople.find(p=>p.id===item.detectedPersonId)?.sourceName
                  &&x.date===item.date);
                if(!expected)throw Error('Weekly E2E missing associated ground-truth row');
                if(expected.state==='OFF'){
                  if(item.recognitionState!=='OFF_CANDIDATE' ||
                    item.imported.enabled!==true)throw Error('Unexpected OFF auto-confirmation');
                  await imports.setImportedEnabled(batchId,item.id,false);
                  approvedOff++;
                }else{
                  if(item.imported.enabled===false||
                    item.imported.start!==expected.start||
                    item.imported.end!==expected.end||
                    item.imported.breakMinutes!==30)
                    throw Error('Weekly E2E wrong OCR time or 30-minute break must not be committed');
                  approvedWork++;
                }
                await imports.setResolution(batchId,item.id,'NEW');
              }
              const approvedBatch=await imports.getBatch(batchId);
              await new CommitImportReview(imports,schedules).execute(batchId);
              let persisted=0;
              for(const expected of truth){
                const owner=state.read().people.find(p=>p.name===expected.person);
                const actual=await schedules.getByDate(owner.id,expected.date);
                if(!actual||actual.enabled!==(expected.state==='WORK')||
                   (actual.enabled&&(actual.start!==expected.start||
                                     actual.end!==expected.end))||
                   (actual.breakMinutes??null)!==(expected.state==='WORK'?30:null))
                  throw Error('Weekly E2E mock DB state differs from approved schedule');
                persisted++;
              }
              imageToReviewToMockDb={
                generatedImage:true,actualPaddleOcr:true,
                actualParser:true,reviewUnapprovedBlocked:blocked,
                approvedOff,approvedWork,persisted,expected:truth.length,
                storage:'IN_MEMORY_MOCK_NOT_D1',
                // Generated-only, transient handoff to the local D1 test.
                _approvedBatch:approvedBatch,
                _expectedRows:truth.map(x=>({
                  person:x.person,date:x.date,state:x.state,start:x.start,end:x.end,
                })),
              };
            }
            // Exercise the actual application service composition and the
            // IMAGE upload action (not just a standalone OCR test adapter).
            // Browser-only HTTP mock is explicitly separate from the real
            // isolated Wrangler D1 replay verified after these cases.
            let productCompositionE2E=null;
            if(spec.id==='A-CLEAN'){
              const realFetch=globalThis.fetch.bind(globalThis);
              const sourcePeople=names[spec.family].map((name,i)=>({
                id:'app-composition-person-'+i,name,relation:'synthetic',
              }));
              const apiStored=new Map();
              const fetchTrace={personReads:0,scheduleReads:0,writes:0,
                forwardedAssetFetches:0,unexpectedApiCalls:0};
              globalThis.fetch=async(input,init={})=>{
                const raw=typeof input==='string'?input:input.url;
                const url=new URL(raw,location.origin);
                const method=(init.method??'GET').toUpperCase();
                const respond=value=>new Response(JSON.stringify(value),{
                  status:200,headers:{'content-type':'application/json'},
                });
                if(url.pathname==='/api/people'&&method==='GET'){
                  fetchTrace.personReads++;
                  return respond({people:sourcePeople});
                }
                const match=/^\\/api\\/people\\/([^/]+)\\/schedules(?:\\/([^/]+))?$/.exec(url.pathname);
                if(match){
                  const id=decodeURIComponent(match[1]);
                  const date=match[2]?decodeURIComponent(match[2]):null;
                  if(method==='GET'&&date){
                    fetchTrace.scheduleReads++;
                    return respond({schedule:apiStored.get(id+'|'+date)??null});
                  }
                  if(method==='PUT'&&!date){
                    const body=JSON.parse(init.body);
                    for(const schedule of body.schedules){
                      if(schedule.personId!==id)throw Error('Cross-person schedule write');
                      apiStored.set(id+'|'+schedule.date,structuredClone(schedule));
                      fetchTrace.writes++;
                    }
                    return respond({schedules:body.schedules});
                  }
                }
                if(url.pathname.startsWith('/api/')){
                  fetchTrace.unexpectedApiCalls++;
                  throw Error('Unexpected app API call '+method+' '+url.pathname);
                }
                // Model, dictionary, WASM: genuine same-origin HTTP only.
                if(url.origin!==location.origin)throw Error('External OCR asset fetch forbidden');
                fetchTrace.forwardedAssetFetches++;
                return realFetch(input,init);
              };
              try{
                const {createHybridApiApplicationServices}=
                  await import('/src/app/composition.ts');
                const app=await createHybridApiApplicationServices('disabled');
                const actualBatchId=await app.actions.importFiles.accept([
                  {kind:'IMAGE',file},
                ]);
                const initialBatch=await app.repositories.imports.getBatch(actualBatchId);
                if(!initialBatch||initialBatch.reviewItems.length!==truth.length||
                   initialBatch.reviewItems.some(item=>item.resolution!==null)||
                   initialBatch.detectedPeople.length!==sourcePeople.length||
                   initialBatch.detectedPeople.some(item=>!item.matchedPersonId))
                  throw Error('Actual product composition lost people or review-required days');
                let blockedBeforeReview=false;
                try{await app.actions.commitImportReview.execute(actualBatchId)}
                catch(e){blockedBeforeReview=String(e).includes('unreviewed');}
                if(!blockedBeforeReview||apiStored.size)
                  throw Error('Actual product composition bypassed manual approval');
                let approvedOff=0,approvedWork=0;
                for(const item of initialBatch.reviewItems){
                  const recognized=initialBatch.detectedPeople.find(
                    x=>x.id===item.detectedPersonId);
                  const expected=truth.find(
                    x=>x.person===recognized?.sourceName&&x.date===item.date);
                  if(!expected||!item.personId)throw Error('Product unmatched image person/date');
                  if(expected.state==='OFF'){
                    if(item.recognitionState!=='OFF_CANDIDATE'||
                       item.imported.enabled===false)
                      throw Error('Product auto-confirmed OFF from OCR');
                    await app.actions.importReview.setImportedEnabled(actualBatchId,item.id,false);
                    approvedOff++;
                  }else{
                    if(item.imported.start!==expected.start||
                       item.imported.end!==expected.end||
                       item.imported.breakMinutes!==30)
                      throw Error('Product did not preserve shift and 30 minute break');
                    approvedWork++;
                  }
                  await app.actions.importReview.setResolution(actualBatchId,item.id,'NEW');
                }
                await app.actions.commitImportReview.execute(actualBatchId);
                if(apiStored.size!==truth.length||fetchTrace.writes!==truth.length)
                  throw Error('Product app HTTP schedule write count mismatch');
                for(const expected of truth){
                  const person=sourcePeople.find(x=>x.name===expected.person);
                  const actual=apiStored.get(person?.id+'|'+expected.date);
                  if(!actual||actual.enabled!==(expected.state==='WORK')||
                     actual.breakMinutes!==(expected.state==='WORK'?30:null)||
                     (actual.enabled&&(actual.start!==expected.start||actual.end!==expected.end)))
                    throw Error('Product app postapproval HTTP payload differs from image truth');
                }
                productCompositionE2E={
                  source:'ACTUAL_CREATE_HYBRID_API_APPLICATION_SERVICES',
                  imageUpload:'APPLICATION_IMPORT_FILES_ACCEPT',
                  browserApi:'ISOLATED_IN_MEMORY_HTTP_MOCK_NOT_D1',
                  modelAndWasm:'ACTUAL_SAME_ORIGIN_FETCH',
                  personCount:initialBatch.detectedPeople.length,
                  cells:initialBatch.reviewItems.length,
                  approvedWork,approvedOff,
                  unreviewedSaveBlocked:blockedBeforeReview,
                  written:apiStored.size,storedBreakMinutes30:approvedWork,
                  ...fetchTrace,productionRemoteWrites:0,
                };
              }finally{globalThis.fetch=realFetch;}
            }

            const paddleTrace=truth.flatMap(cell=>
              (['start','end','break']).flatMap(field=>{
                const expected=cell[field];
                if(expected==null)return [];
                const id='weekly::'+cell.row+'::'+cell.day+'::'+field;
                const source=pMap.get(id);
                const raw=source?.text?.trim()??'';
                const parsed=field==='break'?raw:parseScheduleImageClock(raw);
                if(parsed===expected)return [];
                const region=shared.find(r=>r.id===id);
                const pix=physical?.rows[cell.row]?.cells.find(
                  x=>x.dayIndex===cell.day&&x.field===field);
                return [{
                  id,field,expected,raw,parsed,confidence:source?.confidence??null,
                  crop:region?{x:region.x,y:region.y,width:region.width,height:region.height}:null,
                  initialText:source?.initialText??null,
                  selectedMode:source?.selectedMode??'DEFAULT',
                  retries:source?.retryEvidence??[],
                  occupancy:pix?.visual.occupancy??null,
                  imgWidth:detection.raster.width,imgHeight:detection.raster.height,
                  stage:raw!==expected?'OCR_OR_TEXT_NORMALIZATION':'PARSER',
                }];
              })
            );
            const debug=spec.family==='C'?null:{
              titleTokens:titleLayout.tokens.filter(x=>x.y<90).map(x=>({
                text:String(x.text).slice(0,26),x:Math.round(x.x),y:Math.round(x.y),
              })).slice(0,25),
              tDate:tResults.filter(x=>x.purpose==='date')
                .map(x=>({id:x.id,text:x.text,confidence:x.confidence,
                  tokens:x.tokens.map(t=>t.text)})),
              pDate:pResults.filter(x=>x.purpose==='date')
                .map(x=>({id:x.id,text:x.text,confidence:x.confidence,
                  tokens:x.tokens.map(t=>t.text)})),
              rawColumnWidths:detection.structure.columnBands.map(x=>
                Math.round(x.bounds.width)),
              rawColumnXs:detection.structure.columnBands.map(x=>
                Math.round(x.bounds.x)),
            };
            const nameTrace=names[spec.family].flatMap((expected,index)=>{
              const id='weekly-person::'+index;
              const r=pMap.get(id);
              if(r?.text?.trim()===expected)return [];
              const crop=shared.find(x=>x.id===id);
              return [{id,expected,raw:r?.text?.trim()??'',
                confidence:r?.confidence??null,crop:crop??null}];
            });
            comparisons.push({
              nameTrace,imageToReviewToMockDb,productCompositionE2E,paddleTrace,debug,
              id:spec.id,family:spec.family,degraded:spec.degraded,
              physical:!!physical,rows:physical?.rows.length??0,
              physicalCells:physical?.physicalCellCount??0,
              headerSource:physical?.headerSource??null,
              detectedColumns:detection.structure.columnBands.length,
              geometryMs,tMs,pMs,architectures,
            });
            console.info('CBH_OCR_TRACE: DONE '+spec.id);
          }
        }finally{await paddle.release()}
        return {model:paddle.metadata,generatedRasters,comparisons,
          browserHeapBytes:performance.memory?.usedJSHeapSize??null};
      },{specs,immutableImageBytes});
      if(!immutableImageBytes){
        immutableImageBytes=Object.fromEntries(result.generatedRasters.map(
          x=>[x.id,{base64:x.base64,type:x.type,bytes:x.bytes}]));
        console.log('CBH_SHARED_RASTER_CANONICAL_BYTES='+JSON.stringify(
          result.generatedRasters.map(x=>({id:x.id,bytes:x.bytes,type:x.type}))));
      }
      // The generated byte corpus is held only inside this test invocation,
      // never emitted as CI logs, artifacts, or checked-in source.
      delete result.generatedRasters;
      all.push({browser:browserName,pageErrors,result});
    }finally{await browser.close();}
  }
}finally{await server.close();}

async function verifyEphemeralLocalD1(cases){
  const [{execFile},{promisify},{mkdtemp,rm},{tmpdir},{join,resolve},{getPlatformProxy}]=
    await Promise.all([
      import('node:child_process'),import('node:util'),import('node:fs/promises'),
      import('node:os'),import('node:path'),import('wrangler'),
    ]);
  const tmp=await mkdtemp(join(tmpdir(),'cbh-weekly-ocr-local-d1-'));
  const config=resolve(root,'wrangler.phase5u.jsonc');
  const wrangler=resolve(root,'node_modules/.bin/wrangler');
  let proxy=null,loader=null;
  try{
    // Every SQLite byte is local and isolated; NEVER pass --remote.
    await promisify(execFile)(wrangler,[
      'd1','migrations','apply','come-back-home-db','--local',
      '--config',config,'--persist-to',tmp,
    ],{cwd:root,env:{...process.env,CI:'true'},maxBuffer:4*1024*1024});
    proxy=await getPlatformProxy({configPath:config,persist:{path:join(tmp,'v3')}});
    const db=proxy.env.DB;
    if(!db||typeof db.prepare!=='function')throw Error('Missing local DB binding');
    loader=await createServer({root,appType:'custom',logLevel:'error',
      server:{middlewareMode:true}});
    const [{CommitImportReview},{D1ScheduleRepository}]=await Promise.all([
      loader.ssrLoadModule('/src/application/use-cases/commitImportReview.ts'),
      loader.ssrLoadModule('/worker/repositories/D1ScheduleRepository.ts'),
    ]);
    const schedules=new D1ScheduleRepository(db);
    let persisted=0,enabled=0,disabled=0,committedCases=0;
    let repeatedSaveVerifiedRows=0,repeatedSaveVerifiedCases=0;
    // Store each generated case, namespaced per browser and image: original names and
    // source dates are not changed, but test-only person IDs do not collide.
    for(const {browser,id,review} of cases){
      if(!review?._approvedBatch||!review?._expectedRows)
        throw Error('Missing approved actual OCR evidence for '+browser+'/'+id);
      const batch=structuredClone(review._approvedBatch);
      const personIds=new Map();
      for(const person of batch.detectedPeople){
        if(!person.matchedPersonId)throw Error('Unmatched weekly generated person');
        const old=person.matchedPersonId;
        const updated='generated:'+browser+':'+id+':'+old;
        personIds.set(old,updated);
        person.matchedPersonId=updated;
        await db.prepare(
          'INSERT INTO people (id,name,relation,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)',
        ).bind(updated,person.sourceName,'synthetic',
          '2026-10-09T00:00:00.000Z').run();
      }
      for(const item of batch.reviewItems){
        if(!item.personId||!personIds.has(item.personId))
          throw Error('Weekly D1 importer encountered an unresolved person');
        item.personId=personIds.get(item.personId);
      }
      let committed=false;
      const imports={
        async getBatch(requested){return requested===batch.id?batch:null;},
        async markCommitted(requested){if(requested===batch.id)committed=true;},
      };
      await new CommitImportReview(imports,schedules).execute(batch.id);
      if(!committed)throw Error('Local D1 import did not commit');
      committedCases++;
      const firstReadback=[];
      for(const expected of review._expectedRows){
        const owner=batch.detectedPeople.find(x=>x.sourceName===expected.person);
        if(!owner)throw Error('Missing expected person in local D1 verification');
        const row=await schedules.getByDate(owner.matchedPersonId,expected.date);
        if(!row||row.enabled!==(expected.state==='WORK')||
          (row.enabled&&(row.start!==expected.start||row.end!==expected.end))||
          (row.breakMinutes??null)!==(expected.state==='WORK'?30:null))
          throw Error('Approved weekly cell does not match local D1 state');
        persisted++;
        if(row.enabled)enabled++;else disabled++;
        firstReadback.push({...row});
      }
      // Repeat the same explicitly-approved commit. The real D1 upsert must
      // retain row identity and values, never insert duplicate person/date rows.
      await new CommitImportReview(imports,schedules).execute(batch.id);
      for(const prior of firstReadback){
        const next=await schedules.getByDate(prior.personId,prior.date);
        if(!next||next.id!==prior.id||next.enabled!==prior.enabled||
           next.start!==prior.start||next.end!==prior.end||
           (next.breakMinutes??null)!==(prior.breakMinutes??null))
          throw Error('Repeated local D1 approval changed stored schedule identity or values');
        repeatedSaveVerifiedRows++;
      }
      repeatedSaveVerifiedCases++;
    }
    const count=await db.prepare('SELECT COUNT(*) AS n FROM schedules').first();
    if(Number(count?.n)!==persisted)throw Error('Local D1 count differs from actual approved cells');
    const expectedCases=specs.length*2;
    if(cases.length!==expectedCases||committedCases!==expectedCases||
       persisted!==expectedCases*14||
       enabled!==expectedCases*12||disabled!==expectedCases*2||
       repeatedSaveVerifiedCases!==expectedCases||
       repeatedSaveVerifiedRows!==persisted)
      throw Error('Generated-image local D1 full review or repeat-save acceptance mismatch');
    return {storage:'WRANGLER_ISOLATED_LOCAL_D1',
      generatedRasterToApprovedReview:true,actualD1ScheduleRepository:true,
      committedCases,persisted,enabled,disabled,
      repeatedSaveVerifiedCases,repeatedSaveVerifiedRows,
      breakMinutesWorkRows:enabled,breakMinutesOffNullRows:disabled,
      remoteWrites:0,liveKakaoRouteCalls:0};
  }finally{
    if(loader)await loader.close();
    if(proxy)await proxy.dispose();
    await rm(tmp,{recursive:true,force:true});
  }
}

const d1Cases=all.flatMap(x=>x.result.comparisons.map(item=>({
  browser:x.browser,id:item.id,review:item.imageToReviewToMockDb,
})));
const localD1=await verifyEphemeralLocalD1(d1Cases);
for(const result of all)for(const item of result.result.comparisons){
  if(item.imageToReviewToMockDb){
    delete item.imageToReviewToMockDb._approvedBatch;
    delete item.imageToReviewToMockDb._expectedRows;
  }
}
console.log('CBH_WEEKLY_LOCAL_D1_E2E='+JSON.stringify(localD1));
const actualAppFlows=all.flatMap(run=>run.result.comparisons
  .filter(item=>item.productCompositionE2E!=null)
  .map(item=>({browser:run.browser,id:item.id,...item.productCompositionE2E})));
if(actualAppFlows.length!==2||
   actualAppFlows.some(item=>item.unreviewedSaveBlocked!==true||
     item.personCount!==2||item.cells!==14||
     item.approvedWork!==12||item.approvedOff!==2||
     item.storedBreakMinutes30!==12||item.written!==14||
     item.productionRemoteWrites!==0||item.unexpectedApiCalls!==0))
  throw Error('Actual app composition image upload and approval E2E failed');
console.log('CBH_WEEKLY_ACTUAL_PRODUCT_COMPOSITION_E2E='+JSON.stringify(actualAppFlows));

const engines=['TESSERACT','PADDLE','H1','H2','H3'];
const summary={};
for(const engine of engines){
  let sums={personCorrect:0,personTotal:0,dateCorrect:0,dateTotal:0,
    startCorrect:0,startTotal:0,endCorrect:0,endTotal:0,
    breakCorrect:0,breakTotal:0,cellCorrect:0,cellTotal:0,
    reviewableCellCorrect:0,autoStateCount:0,autoStateCorrect:0,falseWork:0,
    confirmedOffPredicted:0,workTruth:0,workCorrect:0,workPredicted:0,
    reviewRequiredTotal:0,reviewRequiredSurfaced:0,
    offCandidateCount:0,offCandidateCorrect:0,
    offCandidateFalse:0,offTruth:0,
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
    // Reviewable candidate agreement includes manually reviewed OFF_CANDIDATE.
    // It is NOT the exact automatic state accuracy or merge acceptance gate.
    reviewableCell:ratio(sums.reviewableCellCorrect,sums.cellTotal),
    autoStateCoverage:ratio(sums.autoStateCount,sums.cellTotal),
    autoStateConditionalAccuracy:ratio(sums.autoStateCorrect,sums.autoStateCount),
    workPrecision:ratio(sums.workCorrect,sums.workPredicted),
    workRecall:ratio(sums.workCorrect,sums.workTruth),
    reviewRequiredCoverage:ratio(sums.reviewRequiredSurfaced,sums.reviewRequiredTotal),
    falseWork:sums.falseWork,confirmedOffPredicted:sums.confirmedOffPredicted,
    offCandidatePrecision:ratio(sums.offCandidateCorrect,sums.offCandidateCount),
    offCandidateRecall:ratio(sums.offCandidateCorrect,sums.offTruth),
    offCandidateFalse:sums.offCandidateFalse,
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
    // Two mutually empty outputs do NOT demonstrate genuine logical parity.
    if(!image.architectures[engine].complete||
       !other.architectures[engine].complete)continue;
    for(let i=0;i<aa.length;i++){total++;if(aa[i]===bb[i])equal++;}
  }
  parity[engine]={match:equal,total,rate:total?equal/total:null};
}
const e2eCases=all.flatMap(x=>x.result.comparisons
  .map(y=>({browser:x.browser,id:y.id,review:y.imageToReviewToMockDb})));
const reviewedWork=e2eCases.reduce((n,x)=>n+(x.review?.approvedWork??0),0);
const reviewedOff=e2eCases.reduce((n,x)=>n+(x.review?.approvedOff??0),0);
const persistedTotal=e2eCases.reduce((n,x)=>n+(x.review?.persisted??0),0);
const expectedTotal=e2eCases.reduce((n,x)=>n+(x.review?.expected??0),0);
const simulatedReview={
  source:'GENERATED_ONLY_EXPLICIT_APPROVAL_SIMULATION_NOT_AUTO_OCR',
  imageCount:e2eCases.length,workApproved:reviewedWork,offApproved:reviewedOff,
  persisted: persistedTotal, expected:expectedTotal,
  exactPostReviewRate:expectedTotal?persistedTotal/expectedTotal:null,
  humanUserAcceptance:'NOT_VERIFIED',
};
const report={
  scope:'MONDAY_SUNDAY_7_DAYS_X_START_END_BREAK_3_COLUMNS',
  oracleInjected:false,userRealImages:false,sharedDetectedRois:true,
  physicalIPhone:'PHYSICAL_IPHONE_NOT_VERIFIED',
  all,summary,parity,localD1,simulatedReview,
};
// The full JSON line can exceed GitHub Actions stdout per-line limits.
// Emit compact contract and safety evidence before writing this detailed report.
if(all.some(x=>x.pageErrors.length))throw Error('Weekly OCR runtime errors');
for(const run of all){
  for(const a of run.result.comparisons){
    if(a?.imageToReviewToMockDb?.persisted!==14)
      throw Error('Generated raster to explicit-review mock DB E2E failed in '+run.browser+' '+a.id);
  }
}
const expectedCases=specs.length*2;
if(simulatedReview.imageCount!==expectedCases||
   simulatedReview.offApproved!==expectedCases*2||
   simulatedReview.workApproved!==expectedCases*12||
   simulatedReview.persisted!==expectedCases*14)
  throw Error('Generated clean/degraded image explicit review simulation incomplete');
console.log('CBH_WEEKLY_SIMULATED_REVIEW_E2E='+JSON.stringify(simulatedReview));
// D-CBH-20261009-OCR-GATE-B: approved 7x3-only acceptance semantics.
// This is not approval for automatic OFF, human consent, production writes,
// generic OCR layouts, MAIN merge, or deployment.
const weeklyPostReviewPass=
  localD1.storage==='WRANGLER_ISOLATED_LOCAL_D1' &&
  localD1.persisted===simulatedReview.expected &&
  localD1.persisted>0 &&
  localD1.repeatedSaveVerifiedRows===localD1.persisted &&
  localD1.repeatedSaveVerifiedCases===expectedCases &&
  localD1.committedCases===expectedCases &&
  simulatedReview.persisted===simulatedReview.expected &&
  simulatedReview.workApproved===expectedCases*12 &&
  simulatedReview.offApproved===expectedCases*2 &&
  e2eCases.every(x=>x.review?.reviewUnapprovedBlocked===true) &&
  localD1.remoteWrites===0 && localD1.liveKakaoRouteCalls===0;
const evaluateWeeklyOptionB=(q,browserParity,engine)=>{
  const checks={
    person:q.person!=null&&q.person>=.98,
    date:q.date!=null&&q.date>=.98,
    start:q.start!=null&&q.start>=.98,
    end:q.end!=null&&q.end>=.98,
    break:q.break!=null&&q.break>=.98,
    workPrecision:q.workPrecision!=null&&q.workPrecision>=.98,
    workRecall:q.workRecall!=null&&q.workRecall>=.98,
    offCandidatePrecision:q.offCandidatePrecision!=null&&q.offCandidatePrecision>=.98,
    offCandidateRecall:q.offCandidateRecall!=null&&q.offCandidateRecall>=.98,
    falseOff:q.falseOff===0 && q.confirmedOffPredicted===0,
    uncertainReview:q.reviewRequiredCoverage===1 &&
      q.totals.reviewRequiredTotal>0,
    // Every successfully classified image still has to reconstruct its matrix.
    complete:q.completeRate!=null&&q.completeRate>=.99,
    parity:browserParity.rate!=null&&browserParity.rate>=.99,
    // Only standalone PADDLE is tested image->manual review->actual local D1.
    // Never silently give other engines credit for Paddle's post-review run.
    localD1:engine==='PADDLE'&&weeklyPostReviewPass,
  };
  return {checks,accepted:Object.values(checks).every(Boolean)};
};
const qualityGates=Object.fromEntries(engines.map(engine=>
  [engine,evaluateWeeklyOptionB(summary[engine],parity[engine],engine)]));
// Fail-closed contract regression: a missing OFF review, missing work, or a
// single unsafe confirmed OFF must fail even if other recognition is perfect.
const good=summary.PADDLE;
const weakened={
  missingWork:{...good,workRecall:0},
  missingOff:{...good,offCandidateRecall:0},
  falseConfirmedOff:{...good,falseOff:1},
  evenTrueAutoOff:{...good,confirmedOffPredicted:1},
  lostReview:{...good,reviewRequiredCoverage:0},
  noPerson:{...good,person:null},
  conditionalOnly:{...good,workPrecision:1,workRecall:0},
};
for(const [defect,score] of Object.entries(weakened)){
  assert.equal(evaluateWeeklyOptionB(score,parity.PADDLE,'PADDLE').accepted,false,
    'Option B must fail closed on '+defect);
}
assert.equal(qualityGates.TESSERACT.checks.localD1,false,
  'Tesseract cannot inherit Paddle local D1 acceptance');
console.log('CBH_WEEKLY_OPTION_B_SAFETY_NEGATIVE_CONTROLS=PASS');
// Three independent reporting layers. Legacy all-cell strict auto-exact
// remains a diagnostic; only the user-approved weekly Option B gates decide
// current workplace 7x3 acceptance. Review coverage is not auto-accuracy.
const threeLayerMetrics={
  engines:Object.fromEntries(engines.map(engine=>{
    const q=summary[engine];
    assert.ok(q.totals.autoStateCorrect<=q.totals.autoStateCount);
    assert.ok(q.totals.autoStateCount<=q.totals.cellTotal);
    assert.ok(q.totals.reviewableCellCorrect>=q.totals.autoStateCorrect);
    return [engine,{
      recognition:{
        person:q.person,date:q.date,start:q.start,end:q.end,break:q.break,
        candidateStateAgreement:q.reviewableCell,
        workPrecision:q.workPrecision,workRecall:q.workRecall,
        reviewRequiredCoverage:q.reviewRequiredCoverage,
        reviewRequiredCount:q.totals.reviewRequiredTotal,
        reviewRequiredSurfaced:q.totals.reviewRequiredSurfaced,
        offCandidatePrecision:q.offCandidatePrecision,
        offCandidateRecall:q.offCandidateRecall,
        falseOffCandidate:q.offCandidateFalse,
      },
      automatic:{
        // A WORK or OFF prediction is not an actual write; all imports still
        // require review. Unknown and OFF_CANDIDATE are excluded here.
        stateCoverage:q.autoStateCoverage,
        conditionalStateAccuracy:q.autoStateConditionalAccuracy,
        allCellStrictExactAccuracy:q.cell,
        falselyPredictedWork:q.falseWork,
        falselyConfirmedOff:q.falseOff,
        prohibitedConfirmedOffPredictions:q.confirmedOffPredicted,
        persistedWithoutReview:false,
      },
      contract:{
        decision:'D-CBH-20261009-OCR-GATE-B',
        decisionApproved:true,scope:'CURRENT_WORKPLACE_WEEKLY_7X3_ONLY',
        legacyAllCellAutomaticExactThreshold:.98,
        legacyAllCellAutomaticExactPass:q.cell>=.98,
        candidateAgreementPassesSameNumericThreshold:q.reviewableCell>=.98,
        candidateAgreementMayReplaceStrictGate:false,
        weeklyOptionBAccepted:qualityGates[engine].accepted,
        optionBChecks:qualityGates[engine].checks,
        furtherProductReleaseApprovalRequired:true,
      },
    }];
  })),
  afterExplicitSimulatedReview:{
    source:'GENERATED_ONLY_NOT_HUMAN_APPROVAL',
    actualRepository:'WRANGLER_ISOLATED_LOCAL_D1',
    approvedWork:simulatedReview.workApproved,
    approvedOff:simulatedReview.offApproved,
    readbackMatchedRows:localD1.persisted,
    expectedRows:simulatedReview.expected,
    exactStorageRate:simulatedReview.expected?
      localD1.persisted/simulatedReview.expected:null,
    humanAcceptance:'NOT_VERIFIED',
    productionD1Writes:localD1.remoteWrites,
  },
};
assert.equal(threeLayerMetrics.engines.PADDLE.contract.legacyAllCellAutomaticExactPass,
  summary.PADDLE.cell>=.98);
assert.equal(threeLayerMetrics.engines.PADDLE.contract.candidateAgreementMayReplaceStrictGate,
  false);
assert.equal(threeLayerMetrics.afterExplicitSimulatedReview.readbackMatchedRows,
  threeLayerMetrics.afterExplicitSimulatedReview.expectedRows);
console.log('CBH_WEEKLY_THREE_LAYER_METRICS='+JSON.stringify(threeLayerMetrics));
const stageBreakdown={};
for(const engine of engines){
  const browserVariants=all.flatMap(result=>result.result.comparisons.map(item=>({
    browser:result.browser,holdout:item.family==='C',
    degraded:item.degraded,metrics:item.architectures[engine],
  })));
  stageBreakdown[engine]={};
  for(const group of ['CLEAN','DEGRADED','C_HOLDOUT']){
    const items=browserVariants.filter(x=>
      group==='C_HOLDOUT'?x.holdout:
      group==='CLEAN'?!x.degraded:x.degraded);
    const total=items.reduce((v,x)=>v+x.metrics.cellTotal,0);
    const exact=items.reduce((v,x)=>v+x.metrics.cellCorrect,0);
    const reviewable=items.reduce((v,x)=>v+x.metrics.reviewableCellCorrect,0);
    stageBreakdown[engine][group]={
      images:items.length,exactCell:total?exact/total:null,
      reviewableCell:total?reviewable/total:null,
      complete:items.filter(x=>x.metrics.complete).length,
    };
  }
}
console.log('CBH_WEEKLY_STRICT_AND_REVIEW_GATES='+JSON.stringify({qualityGates,stageBreakdown}));
const accepted=engines.filter(engine=>qualityGates[engine].accepted);
console.log('CBH_WEEKLY_3COL_ACCEPTED='+JSON.stringify(accepted));
console.log('CBH_WEEKLY_OPTION_B_CONTRACT='+JSON.stringify({
  decision:'D-CBH-20261009-OCR-GATE-B',approved:true,
  scope:'CURRENT_WORKPLACE_WEEKLY_7X3_ONLY',
  candidateIsNotConfirmedOff:true,autoOffWrites:0,
  formerAllCellStrictExact:summary.PADDLE.cell,
  formerAllCellExactPass:summary.PADDLE.cell>=.98,
  productCompositionWired:false,privateUserImageAcceptance:'NOT_VERIFIED',
  physicalIPhone:'NOT_VERIFIED',mergeOrDeployApproved:false,
}));
console.log('CBH_WEEKLY_3COL_REAL_COMPARE='+JSON.stringify(report));
if(!accepted.length)throw Error('Weekly 3col OCR still below quality gate; do not merge PR81');
