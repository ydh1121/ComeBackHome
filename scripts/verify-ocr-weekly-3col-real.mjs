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
          {createPaddleDetectedRegionRecognizer},
          {parseScheduleImageClock},
          {MockStateStore,MOCK_FIXTURE},
          {MockPersonRepository,MockScheduleRepository,MockImportRepository},
          {WorkbookImportFileSelectionAction},
          {CommitImportReview},
        ]=await Promise.all([
          import('/src/providers/import/ScheduleTableStructureDetector.ts'),
          import('/src/providers/import/TesseractScheduleImageTextExtractor.ts'),
          import('/src/providers/import/ocrRuntimeConfig.ts'),
          import('/src/providers/import/Weekly3ColumnScheduleMatrix.ts'),
          import('/tools/ocr-eval/paddle-onnx-browser-entry.js'),
          import('/src/providers/import/StructuredTableImageScheduleRecognizer.ts'),
          import('/src/mocks/state.ts'),
          import('/src/mocks/repositories.ts'),
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
        const paddle=await createPaddleDetectedRegionRecognizer();
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
              let cellCorrect=0,reviewableCellCorrect=0,
                offCandidateCount=0,offCandidateCorrect=0,offCandidateFalse=0,offTruth=0;
              for(const cell of truth){
                const observed=reconstructed.get(cell.person+'|'+cell.date);
                if(observed===cell.state)cellCorrect++;
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
                offCandidateCount,offCandidateCorrect,offCandidateFalse,offTruth,
                falseOff,complete:completed&&reconstructed.size===truth.length,
                blockedReason:interpreted?interpreted.blockedReason:'STRUCTURE_NOT_DETECTED',
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
            if(spec.id==='A-CLEAN'&&physical){
              const resolvedDates=resolveWeekly3ColumnDates(physical,titleLayout,
                pResults.filter(x=>x.purpose==='date'));
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
              const imports=new MockImportRepository(state),
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
                    item.imported.end!==expected.end)
                    throw Error('Weekly E2E wrong source OCR schedule must not be committed');
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
                                     actual.end!==expected.end)))
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
              nameTrace,imageToReviewToMockDb,paddleTrace,debug,
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

async function verifyEphemeralLocalD1(approvedBatch,expectedRows){
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
    // Forced local-only, isolated Wrangler persistence. NEVER --remote.
    await promisify(execFile)(wrangler,[
      'd1','migrations','apply','come-back-home-db','--local',
      '--config',config,'--persist-to',tmp,
    ],{cwd:root,env:{...process.env,CI:'true'},maxBuffer:4*1024*1024});
    proxy=await getPlatformProxy({
      configPath:config,persist:{path:join(tmp,'v3')},
    });
    const db=proxy.env.DB;
    if(!db||typeof db.prepare!=='function')throw Error('Missing local DB binding');
    const names=approvedBatch.detectedPeople;
    for(const person of names){
      if(!person.matchedPersonId)throw Error('Missing approved generated person ID');
      await db.prepare(
        'INSERT INTO people (id,name,relation,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)',
      ).bind(person.matchedPersonId,person.sourceName,'synthetic',
        '2026-10-09T00:00:00.000Z').run();
    }
    loader=await createServer({root,appType:'custom',logLevel:'error',
      server:{middlewareMode:true}});
    const [{CommitImportReview},{D1ScheduleRepository}]=await Promise.all([
      loader.ssrLoadModule('/src/application/use-cases/commitImportReview.ts'),
      loader.ssrLoadModule('/worker/repositories/D1ScheduleRepository.ts'),
    ]);
    const scheduleRepo=new D1ScheduleRepository(db);
    let committed=false;
    const imports={
      async getBatch(id){return id===approvedBatch.id?approvedBatch:null;},
      async markCommitted(id){if(id===approvedBatch.id)committed=true;},
    };
    await new CommitImportReview(imports,scheduleRepo).execute(approvedBatch.id);
    if(!committed)throw Error('Local D1 import not marked committed');
    let persisted=0,disabled=0,enabled=0;
    for(const expected of expectedRows){
      const owner=names.find(x=>x.sourceName===expected.person);
      const actual=await scheduleRepo.getByDate(owner.matchedPersonId,expected.date);
      if(!actual||actual.enabled!==(expected.state==='WORK')||
        (actual.enabled&&(actual.start!==expected.start||actual.end!==expected.end))){
        throw Error('Local D1 schedule row mismatch after approved OCR import');
      }
      persisted++;if(actual.enabled)enabled++;else disabled++;
    }
    const count=await db.prepare('SELECT COUNT(*) AS n FROM schedules').first();
    if(Number(count?.n)!==expectedRows.length)throw Error('Unexpected local D1 row count');
    return {storage:'WRANGLER_ISOLATED_LOCAL_D1',
      generatedRasterToApprovedReview:true,
      actualD1ScheduleRepository:true,
      committed,persisted,enabled,disabled,
      remoteWrites:0,liveKakaoRouteCalls:0};
  }finally{
    if(loader)await loader.close();
    if(proxy)await proxy.dispose();
    await rm(tmp,{recursive:true,force:true});
  }
}

const approvedEvidence=all.find(x=>x.browser==='CHROMIUM')
  ?.result.comparisons.find(x=>x.id==='A-CLEAN')?.imageToReviewToMockDb;
if(!approvedEvidence?._approvedBatch||!approvedEvidence?._expectedRows)
  throw Error('Missing generated raster approved-review D1 handoff');
const localD1=await verifyEphemeralLocalD1(
  approvedEvidence._approvedBatch,approvedEvidence._expectedRows,
);
// No generated names or image bytes are retained in log payloads.
for(const result of all)for(const item of result.result.comparisons){
  if(item.imageToReviewToMockDb){
    delete item.imageToReviewToMockDb._approvedBatch;
    delete item.imageToReviewToMockDb._expectedRows;
  }
}
console.log('CBH_WEEKLY_LOCAL_D1_E2E='+JSON.stringify(localD1));

const engines=['TESSERACT','PADDLE','H1','H2','H3'];
const summary={};
for(const engine of engines){
  let sums={personCorrect:0,personTotal:0,dateCorrect:0,dateTotal:0,
    startCorrect:0,startTotal:0,endCorrect:0,endTotal:0,
    breakCorrect:0,breakTotal:0,cellCorrect:0,cellTotal:0,
    reviewableCellCorrect:0,offCandidateCount:0,offCandidateCorrect:0,
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
    // Reviewable coverage is NOT the exact-state accuracy or acceptance gate.
    reviewableCell:ratio(sums.reviewableCellCorrect,sums.cellTotal),
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
const report={
  scope:'MONDAY_SUNDAY_7_DAYS_X_START_END_BREAK_3_COLUMNS',
  oracleInjected:false,userRealImages:false,sharedDetectedRois:true,
  physicalIPhone:'PHYSICAL_IPHONE_NOT_VERIFIED',
  all,summary,parity,localD1,
};
console.log('CBH_WEEKLY_3COL_REAL_COMPARE='+JSON.stringify(report));
if(all.some(x=>x.pageErrors.length))throw Error('Weekly OCR runtime errors');
for(const run of all){
  const a=run.result.comparisons.find(x=>x.id==='A-CLEAN');
  if(a?.imageToReviewToMockDb?.persisted!==14)
    throw Error('Generated raster to explicit-review mock DB E2E failed in '+run.browser);
}
const accepted=engines.filter(engine=>{
  const q=summary[engine];
  return q.person>=.98&&q.date>=.99&&q.start>=.97&&q.end>=.97&&
    q.cell>=.98&&q.falseOff===0&&q.completeRate>=.99&&parity[engine].rate>=.99;
});
console.log('CBH_WEEKLY_3COL_ACCEPTED='+JSON.stringify(accepted));
if(!accepted.length)throw Error('Weekly 3col OCR still below quality gate; do not merge PR81');
