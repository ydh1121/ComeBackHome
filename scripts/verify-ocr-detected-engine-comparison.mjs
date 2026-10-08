import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const required=[
  'public/ocr-paddle-probe/inference.onnx',
  'public/ocr-paddle-probe/dict.json',
  'public/ort/ort-wasm-simd-threaded.wasm',
  'public/ocr/tesseract-7.0.0-data-1.0.0/manifest.json',
];
for(const rel of required)assert.ok(fs.existsSync(path.join(root,rel)),'Missing '+rel);

const server=await createServer({
  root,logLevel:'error',server:{host:'127.0.0.1',port:0},
  plugins:[{
    name:'cbh-ocr-runtime-static-assets',enforce:'pre',
    configureServer(vite){
      vite.middlewares.use((request,response,next)=>{
        const url=new URL(request.url??'/','http://127.0.0.1');
        if(!url.pathname.startsWith('/ort/'))return next();
        const base=url.pathname.slice('/ort/'.length);
        if(!/^ort-wasm-[a-z0-9.-]+\.(?:mjs|wasm)$/.test(base)){
          response.statusCode=404;response.end();return;
        }
        const asset=path.join(root,'public/ort',base);
        if(!fs.existsSync(asset)){response.statusCode=404;response.end();return;}
        response.setHeader('Content-Type',base.endsWith('.mjs')?'text/javascript':'application/wasm');
        response.setHeader('Cache-Control','no-store');
        response.end(fs.readFileSync(asset));
      });
    },
  }],
});

const specs=[
  {id:'A-CLEAN',family:'A',variant:'CLEAN',people:3,days:5,startDay:1,labelWidth:151,cellWidth:141,rowHeight:82,scale:1,format:'png',quality:1,partial:false,blur:0},
  {id:'A-DEGRADED',family:'A',variant:'DEGRADED',people:3,days:5,startDay:1,labelWidth:151,cellWidth:141,rowHeight:82,scale:.72,format:'jpeg',quality:.58,partial:false,blur:.35},
  {id:'B-CLEAN',family:'B',variant:'CLEAN',people:4,days:6,startDay:8,labelWidth:164,cellWidth:128,rowHeight:78,scale:1,format:'png',quality:1,partial:false,blur:0},
  {id:'B-DEGRADED',family:'B',variant:'DEGRADED',people:4,days:6,startDay:8,labelWidth:164,cellWidth:128,rowHeight:78,scale:.70,format:'jpeg',quality:.56,partial:true,blur:.42},
  {id:'C-CLEAN',family:'C',variant:'CLEAN',people:3,days:6,startDay:17,labelWidth:147,cellWidth:136,rowHeight:84,scale:1,format:'png',quality:1,partial:false,blur:0},
  {id:'C-DEGRADED',family:'C',variant:'DEGRADED',people:3,days:6,startDay:17,labelWidth:147,cellWidth:136,rowHeight:84,scale:.66,format:'jpeg',quality:.52,partial:true,blur:.52},
];
const browserResults=[];
try{
  await server.listen();
  const port=server.httpServer.address()?.port;
  assert.equal(typeof port,'number');
  for(const [browserName,engine] of [['CHROMIUM',chromium],['WEBKIT',webkit]]){
    const browser=await engine.launch({headless:true});
    try{
      const page=await browser.newPage({serviceWorkers:'block'});
      page.setDefaultTimeout(900000);
      const pageErrors=[];
      page.on('pageerror',e=>pageErrors.push(e.message.slice(0,300)));
      await page.goto('http://127.0.0.1:'+port+'/tools/ocr-eval/index.html',
        {waitUntil:'domcontentloaded'});
      const result=await page.evaluate(async(specs)=>{
        const [
          tessModule,structureModule,matrixModule,recognizerModule,
          configModule,paddleModule,semanticModule,
        ]=await Promise.all([
          import('/src/providers/import/TesseractScheduleImageTextExtractor.ts'),
          import('/src/providers/import/ScheduleTableStructureDetector.ts'),
          import('/src/providers/import/ScheduleCellMatrix.ts'),
          import('/src/providers/import/StructureFirstScheduleImageRecognizer.ts'),
          import('/src/providers/import/ocrRuntimeConfig.ts'),
          import('/tools/ocr-eval/paddle-onnx-browser-entry.js'),
          import('/src/providers/import/StructuredTableImageScheduleRecognizer.ts'),
        ]);
        const {
          TesseractScheduleImageTextExtractor,TesseractJsWorkerFactory,
          BrowserScheduleOcrPreprocessor,
        }=tessModule;
        const {
          BrowserScheduleTableStructureDetector,pixelSupportedColumnBounds,
        }=structureModule;
        const {buildScheduleCellMatrix,inspectScheduleMatrixInput}=matrixModule;
        const {interpretStructureFirstSchedule}=recognizerModule;
        const {SAME_ORIGIN_TESSERACT_ASSETS}=configModule;
        const {createPaddleDetectedRegionRecognizer}=paddleModule;
        const {parseScheduleImageClock}=semanticModule;

        const familyNames={
          A:['강하현','정지윤','조도아'],
          B:['박민준','최서연','윤수빈','김예린'],
          C:['임태희','한채린','서유진'],
        };
        const architectureNames=['TESSERACT','PADDLE','H1','H2','H3'];
        const toBlob=(canvas,type,quality)=>new Promise((resolve,reject)=>
          canvas.toBlob(value=>value?resolve(value):reject(Error('Canvas encode failed')),type,quality));
        const scaleRect=(r,s)=>({x:r.x*s,y:r.y*s,width:r.width*s,height:r.height*s});
        const rectIoU=(a,b)=>{
          const x0=Math.max(a.x,b.x),y0=Math.max(a.y,b.y);
          const x1=Math.min(a.x+a.width,b.x+b.width),y1=Math.min(a.y+a.height,b.y+b.height);
          const intersection=Math.max(0,x1-x0)*Math.max(0,y1-y0);
          const union=a.width*a.height+b.width*b.height-intersection;
          return union>0?intersection/union:0;
        };
        const xIoU=(a,b)=>{
          const x0=Math.max(a.x,b.x),x1=Math.min(a.x+a.width,b.x+b.width);
          const inter=Math.max(0,x1-x0),union=a.width+b.width-inter;
          return union>0?inter/union:0;
        };
        const yIoU=(a,b)=>{
          const y0=Math.max(a.y,b.y),y1=Math.min(a.y+a.height,b.y+b.height);
          const inter=Math.max(0,y1-y0),union=a.height+b.height-inter;
          return union>0?inter/union:0;
        };
        const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
        const normalizeName=value=>String(value??'').normalize('NFKC')
          .replace(/\s+/g,'').match(/[가-힣]{2,5}/)?.[0]??'';
        const dayValue=result=>{
          const raw=[result?.text??'',...(result?.tokens??[]).map(x=>x.text)]
            .join('').normalize('NFKC').replace(/\s+/g,'');
          const m=/(?:^|\D)0?([1-9]|[12][0-9]|3[01])(?:일|日)?(?:$|\D)/.exec(raw);
          return m?Number(m[1]):null;
        };
        const timesFrom=result=>{
          const values=[];
          for(const raw of [...(result?.tokens??[]).map(x=>x.text),result?.text??'']){
            const chunks=String(raw).normalize('NFKC').split(/\s+/).filter(Boolean);
            for(const chunk of chunks){
              const parsed=parseScheduleImageClock(chunk);
              if(parsed&&!values.includes(parsed))values.push(parsed);
            }
          }
          return values;
        };
        const contextValue=result=>{
          const raw=String(result?.text??'').normalize('NFKC').replace(/\s+/g,'');
          const m=/(20\d{2})년?[^0-9]?([1-9]|1[0-2])월?/.exec(raw);
          return m?m[1]+'-'+String(Number(m[2])).padStart(2,'0'):'';
        };
        const emptyLike=(result,id,purpose)=>({id,purpose,text:'',tokens:[],confidence:0});
        const cloneAs=(result,id,purpose)=>({
          id,purpose,text:result?.text??'',tokens:(result?.tokens??[]).map(x=>({...x})),
          confidence:result?.confidence??0,
        });

        async function generate(spec){
          await document.fonts.load('bold 24px "Nanum Gothic"');
          const left=22,top=75;
          const width=left+spec.labelWidth+spec.days*spec.cellWidth+22;
          const height=top+(spec.people+1)*spec.rowHeight+22;
          const base=document.createElement('canvas');
          base.width=width;base.height=height;
          const ctx=base.getContext('2d',{alpha:false});
          if(!ctx)throw Error('Canvas unavailable');
          ctx.fillStyle=spec.variant==='DEGRADED'?'#f4f2eb':'#fff';
          ctx.fillRect(0,0,width,height);
          ctx.fillStyle='#111';ctx.textAlign='left';
          ctx.font='bold 27px "Nanum Gothic", sans-serif';
          ctx.fillText('2026년 10월',left+7,47);
          ctx.font='bold 19px "Nanum Gothic", sans-serif';
          ctx.fillText('이름',left+15,top+49);
          const names=familyNames[spec.family].slice(0,spec.people);
          const truthCells=[];
          const dateRects=[],personRects=[],cellRects=[];
          for(let d=0;d<spec.days;d++){
            const x=left+spec.labelWidth+d*spec.cellWidth;
            ctx.font='bold 21px "Nanum Gothic", sans-serif';
            ctx.fillText(String(spec.startDay+d)+'일',x+Math.max(19,spec.cellWidth*.31),top+48);
            dateRects.push({x,y:top,width:spec.cellWidth,height:spec.rowHeight});
          }
          for(let p=0;p<spec.people;p++){
            const y=top+(p+1)*spec.rowHeight;
            ctx.font='bold 24px "Nanum Gothic", sans-serif';ctx.fillStyle='#12151b';
            ctx.fillText(names[p],left+14,y+Math.round(spec.rowHeight*.64));
            personRects.push({x:left,y,width:spec.labelWidth,height:spec.rowHeight});
            for(let d=0;d<spec.days;d++){
              const x=left+spec.labelWidth+d*spec.cellWidth;
              const code=(p*3+d*2+(spec.family.charCodeAt(0)-65))%8;
              const state=code===0?'OFF':code===1?'INCOMPLETE':code===2?'UNREADABLE':'WORK';
              const day=spec.startDay+d;
              const date='2026-10-'+String(day).padStart(2,'0');
              const start=state==='WORK'||state==='INCOMPLETE'?'09:00':null;
              const end=state==='WORK'?'18:00':null;
              truthCells.push({person:names[p],personIndex:p,date,day,state,start,end});
              cellRects.push({personIndex:p,dateIndex:d,bounds:{x,y,width:spec.cellWidth,height:spec.rowHeight}});
              if(state==='OFF'){
                ctx.fillStyle=(p+d)%2?'#e7e8e7':ctx.fillStyle;
              }else if(state==='WORK'||state==='INCOMPLETE'){
                ctx.fillStyle='#191919';ctx.font='bold 23px "Nanum Gothic", sans-serif';
                ctx.fillText('09:00',x+Math.max(12,spec.cellWidth*.18),y+Math.round(spec.rowHeight*.41));
                if(state==='WORK')ctx.fillText('18:00',x+Math.max(12,spec.cellWidth*.18),y+Math.round(spec.rowHeight*.79));
              }else{
                ctx.fillStyle='#454545';ctx.font='bold 20px "Nanum Gothic", sans-serif';
                ctx.fillText('메모',x+Math.max(17,spec.cellWidth*.29),y+Math.round(spec.rowHeight*.58));
              }
            }
          }
          ctx.strokeStyle=spec.variant==='DEGRADED'?'#85878a':'#5a5e65';
          ctx.lineWidth=spec.variant==='DEGRADED'?1.35:2;
          for(let r=0;r<=spec.people+1;r++){
            if(spec.partial&&r>0&&r<spec.people+1&&r%3===0)continue;
            const y=top+r*spec.rowHeight;
            ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+spec.labelWidth+spec.days*spec.cellWidth,y);ctx.stroke();
          }
          for(let c=0;c<=spec.days+1;c++){
            if(spec.partial&&c>1&&c<spec.days+1&&c%3===0)continue;
            const x=c===0?left:c===1?left+spec.labelWidth:left+spec.labelWidth+(c-1)*spec.cellWidth;
            ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+(spec.people+1)*spec.rowHeight);ctx.stroke();
          }
          let output=base,scale=1;
          if(spec.scale!==1||spec.blur>0){
            const reduced=document.createElement('canvas');
            reduced.width=Math.round(width*spec.scale);
            reduced.height=Math.round(height*spec.scale);
            const rctx=reduced.getContext('2d',{alpha:false});
            if(!rctx)throw Error('Resize canvas unavailable');
            rctx.fillStyle='#f4f2eb';rctx.fillRect(0,0,reduced.width,reduced.height);
            rctx.imageSmoothingEnabled=true;
            if(spec.blur>0)rctx.filter='blur('+spec.blur+'px)';
            rctx.drawImage(base,0,0,reduced.width,reduced.height);
            rctx.filter='none';output=reduced;scale=spec.scale;
          }
          const mime=spec.format==='jpeg'?'image/jpeg':'image/png';
          const blob=await toBlob(output,mime,spec.quality);
          const file=new File([blob],spec.id+'.'+(spec.format==='jpeg'?'jpg':'png'),{type:mime});
          const truth={
            names,
            table:scaleRect({x:left,y:top,width:spec.labelWidth+spec.days*spec.cellWidth,
              height:(spec.people+1)*spec.rowHeight},scale),
            header:scaleRect({x:left,y:top,width:spec.labelWidth+spec.days*spec.cellWidth,height:spec.rowHeight},scale),
            calendar:scaleRect({x:left,y:0,width:spec.labelWidth+spec.cellWidth*1.35,height:top},scale),
            personRects:personRects.map(r=>scaleRect(r,scale)),
            dateRects:dateRects.map(r=>scaleRect(r,scale)),
            cellRects:cellRects.map(x=>({...x,bounds:scaleRect(x.bounds,scale)})),
            cells:truthCells,
            width:output.width,height:output.height,
          };
          return {file,truth,bytes:blob.size};
        }

        async function tesseractRawRegions(file,regions){
          if(!regions.length)return [];
          const factory=new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS);
          const worker=await factory.create(['kor','eng']);
          const bitmap=await createImageBitmap(file);
          const results=[];
          try{
            await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});
            for(const region of regions){
              const x=Math.max(0,Math.floor(region.x)),y=Math.max(0,Math.floor(region.y));
              const right=Math.min(bitmap.width,Math.ceil(region.x+region.width));
              const bottom=Math.min(bitmap.height,Math.ceil(region.y+region.height));
              const sw=Math.max(1,right-x),sh=Math.max(1,bottom-y);
              const canvas=document.createElement('canvas');
              canvas.width=Math.max(64,sw*2);canvas.height=Math.max(36,sh*2);
              const ctx=canvas.getContext('2d',{alpha:false});
              if(!ctx)throw Error('Tesseract context canvas unavailable');
              ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
              ctx.drawImage(bitmap,x,y,sw,sh,0,0,canvas.width,canvas.height);
              const blob=await toBlob(canvas,'image/png',1);
              const response=await worker.recognize(blob,{rotateAuto:false},{text:true,blocks:true});
              const text=String(response.data.text??'').normalize('NFKC').trim();
              const confidence=Math.max(0,Math.min(1,(Number(response.data.confidence)||0)/100));
              results.push({id:region.id,purpose:region.purpose,text,
                tokens:text?[{text,x:region.x+region.width*.04,y:region.y+region.height*.08,
                  width:region.width*.92,height:region.height*.84,confidence}]:[],confidence});
            }
          }finally{bitmap.close();await worker.terminate();}
          return results;
        }

        function geometryFromDetection(detection){
          const columns=pixelSupportedColumnBounds(detection);
          const header=detection.structure.rowBands[0]?.bounds??null;
          const rows=detection.structure.rowBands.slice(1).map(x=>x.bounds);
          if(!header||columns.length<2||!rows.length)return {
            valid:false,columns,header,rows,label:null,dateColumns:[],regions:[],calendar:null,
          };
          const label=columns[0],dateColumns=columns.slice(1);
          const regions=[];
          dateColumns.forEach((col,index)=>regions.push({
            id:'date::grid-cell::detected::'+index,purpose:'date',
            x:col.x,y:header.y,width:col.width,height:header.height,
          }));
          rows.forEach((row,index)=>regions.push({
            id:'person::detected::'+index,purpose:'person',
            x:label.x,y:row.y,width:label.width,height:row.height,
          }));
          rows.forEach((row,ri)=>dateColumns.forEach((col,ci)=>regions.push({
            id:'cell::detected::'+ri+'::'+ci,purpose:'cell',
            x:col.x,y:row.y,width:col.width,height:row.height,
          })));
          const calendar={
            id:'calendar::detected',purpose:'context',
            x:label.x,y:0,
            width:Math.min(detection.raster.width-label.x,
              Math.max(label.width*1.7,(dateColumns[0]?.x+dateColumns[0]?.width-label.x)||label.width*2)),
            height:Math.max(1,header.y),
          };
          return {valid:true,columns,header,rows,label,dateColumns,regions,calendar};
        }

        function oracleRegions(truth){
          const regions=[];
          truth.dateRects.forEach((r,i)=>regions.push({
            id:'date::grid-cell::oracle::'+i,purpose:'date',...r}));
          truth.personRects.forEach((r,i)=>regions.push({
            id:'person::oracle::'+i,purpose:'person',...r}));
          truth.cellRects.forEach(item=>regions.push({
            id:'cell::oracle::'+item.personIndex+'::'+item.dateIndex,purpose:'cell',...item.bounds}));
          return regions;
        }

        function mapById(results){return new Map(results.map(x=>[x.id,x]));}
        function pick(source,id,purpose){return cloneAs(source.get(id),id,purpose);}
        function semantic(result,purpose){
          if(purpose==='context')return contextValue(result);
          if(purpose==='date')return String(dayValue(result)??'');
          if(purpose==='person')return normalizeName(result?.text);
          if(purpose==='cell')return timesFrom(result).join('|');
          return '';
        }
        function chooseSafe(primary,secondary,id,purpose,knownNames){
          const p=cloneAs(primary,id,purpose),s=cloneAs(secondary,id,purpose);
          const ps=semantic(p,purpose),ss=semantic(s,purpose);
          if(ps&&ss&&ps===ss)return p.confidence>=s.confidence?p:s;
          if(purpose==='person'){
            const pKnown=knownNames.includes(ps),sKnown=knownNames.includes(ss);
            if(pKnown&&!sKnown&&p.confidence>=.55)return p;
            if(sKnown&&!pKnown&&s.confidence>=.55)return s;
          }
          const pHigh=!!ps&&p.confidence>=.82,sHigh=!!ss&&s.confidence>=.82;
          if(pHigh&&!sHigh)return p;
          if(sHigh&&!pHigh)return s;
          if(pHigh&&sHigh&&ps!==ss)return emptyLike(null,id,purpose);
          if(ps&&ss&&ps===ss)return p.confidence>=s.confidence?p:s;
          return emptyLike(null,id,purpose);
        }
        function selectedResult(arch,tMap,pMap,id,purpose,names){
          if(arch==='TESSERACT')return pick(tMap,id,purpose);
          if(arch==='PADDLE')return pick(pMap,id,purpose);
          if(arch==='H1')return purpose==='cell'?pick(pMap,id,purpose):pick(tMap,id,purpose);
          if(arch==='H2')return purpose==='person'||purpose==='cell'
            ?pick(pMap,id,purpose):pick(tMap,id,purpose);
          const primary=(purpose==='date'||purpose==='context')?tMap.get(id):pMap.get(id);
          const secondary=(purpose==='date'||purpose==='context')?pMap.get(id):tMap.get(id);
          return chooseSafe(primary,secondary,id,purpose,names);
        }

        function commonMappings(geometry,truth){
          const rowMatches=truth.personRects.map(tr=>{
            let best=-1,score=0;
            geometry.rows.forEach((r,i)=>{const s=yIoU(tr,r);if(s>score){score=s;best=i;}});
            return {index:best,iou:score};
          });
          const colMatches=truth.dateRects.map(tr=>{
            let best=-1,score=0;
            geometry.dateColumns.forEach((r,i)=>{const s=xIoU(tr,r);if(s>score){score=s;best=i;}});
            return {index:best,iou:score};
          });
          return {rowMatches,colMatches};
        }

        function geometryMetrics(detection,geometry,truth,mappings){
          const rowIoUs=mappings.rowMatches.map(x=>x.iou);
          const colIoUs=mappings.colMatches.map(x=>x.iou);
          const personIoUs=truth.personRects.map((r,i)=>{
            const m=mappings.rowMatches[i];
            if(m.index<0||!geometry.label)return 0;
            return rectIoU(r,{x:geometry.label.x,y:geometry.rows[m.index].y,
              width:geometry.label.width,height:geometry.rows[m.index].height});
          });
          const cellIoUs=truth.cellRects.map(item=>{
            const rm=mappings.rowMatches[item.personIndex],cm=mappings.colMatches[item.dateIndex];
            if(rm.index<0||cm.index<0)return 0;
            return rectIoU(item.bounds,{x:geometry.dateColumns[cm.index].x,y:geometry.rows[rm.index].y,
              width:geometry.dateColumns[cm.index].width,height:geometry.rows[rm.index].height});
          });
          return {
            tableIoU:rectIoU(truth.table,detection.structure.tableBounds),
            rowIoU:avg(rowIoUs),dateColumnIoU:avg(colIoUs),
            personCropIoU:avg(personIoUs),cellCropIoU:avg(cellIoUs),
          };
        }

        function scoreRaw(prefix,arch,tMap,pMap,truth,mappings,names){
          let personCorrect=0,dateCorrect=0,startCorrect=0,endCorrect=0;
          let personTotal=truth.names.length,dateTotal=truth.dateRects.length,startTotal=0,endTotal=0;
          truth.names.forEach((name,i)=>{
            const idx=prefix==='oracle'?i:mappings.rowMatches[i].index;
            if(idx<0)return;
            const id='person::'+prefix+'::'+idx;
            if(normalizeName(selectedResult(arch,tMap,pMap,id,'person',names).text)===name)personCorrect++;
          });
          truth.dateRects.forEach((_,i)=>{
            const idx=prefix==='oracle'?i:mappings.colMatches[i].index;
            if(idx<0)return;
            const id='date::grid-cell::'+prefix+'::'+idx;
            const expected=truth.cells[0].day+i;
            if(dayValue(selectedResult(arch,tMap,pMap,id,'date',names))===expected)dateCorrect++;
          });
          truth.cells.forEach(cell=>{
            const pi=cell.personIndex;
            const di=cell.day-truth.cells[0].day;
            const ri=prefix==='oracle'?pi:mappings.rowMatches[pi].index;
            const ci=prefix==='oracle'?di:mappings.colMatches[di].index;
            if(cell.start)startTotal++;
            if(cell.end)endTotal++;
            if(ri<0||ci<0)return;
            const result=selectedResult(arch,tMap,pMap,'cell::'+prefix+'::'+ri+'::'+ci,'cell',names);
            const times=timesFrom(result);
            if(cell.start&&times[0]===cell.start)startCorrect++;
            if(cell.end&&times[1]===cell.end)endCorrect++;
          });
          return {personCorrect,personTotal,dateCorrect,dateTotal,startCorrect,startTotal,endCorrect,endTotal,
            allCorrect:personCorrect+dateCorrect+startCorrect+endCorrect,
            allTotal:personTotal+dateTotal+startTotal+endTotal};
        }

        function buildSelectedLayout(arch,tMap,pMap,geometry,truth,names){
          const tokens=[];
          if(geometry.calendar){
            tokens.push(...selectedResult(arch,tMap,pMap,geometry.calendar.id,'context',names).tokens);
          }
          for(const region of geometry.regions){
            tokens.push(...selectedResult(arch,tMap,pMap,region.id,region.purpose,names).tokens);
          }
          return {width:truth.width,height:truth.height,tokens};
        }

        function mapRegionalResults(matrix,arch,tMap,pMap,geometry,names){
          const results=[];
          const matrixRows=matrix.rows;
          const rowIndexBySource=new Map();
          for(const row of matrixRows){
            let best=-1,score=0;
            geometry.rows.forEach((r,i)=>{const s=yIoU(row.bounds,r);if(s>score){score=s;best=i;}});
            rowIndexBySource.set(row.sourceRow,best);
            const result=best>=0?selectedResult(arch,tMap,pMap,'person::detected::'+best,'person',names)
              :emptyLike(null,'','person');
            results.push(cloneAs(result,'person::'+row.sourceRow,'person'));
          }
          for(const cell of matrix.cells){
            const ri=rowIndexBySource.get(cell.sourceRow)??-1;
            const date=matrix.dates.find(x=>x.date===cell.date);
            let ci=-1,score=0;
            if(date)geometry.dateColumns.forEach((r,i)=>{const s=xIoU(date.bounds,r);if(s>score){score=s;ci=i;}});
            const result=ri>=0&&ci>=0
              ?selectedResult(arch,tMap,pMap,'cell::detected::'+ri+'::'+ci,'cell',names)
              :emptyLike(null,'','cell');
            results.push(cloneAs(result,cell.id,'cell'));
          }
          return results;
        }

        function scorePipeline(parsed,matrix,truth){
          const outputs=new Map();
          for(const item of parsed.scheduleCandidates){
            outputs.set(item.sourcePersonName+'|'+item.date,{
              state:'WORK',start:item.start,end:item.end});
          }
          for(const item of parsed.reviewCandidates??[]){
            outputs.set(item.sourcePersonName+'|'+item.date,{
              state:item.recognitionState??'UNREADABLE',start:item.start,end:item.end});
          }
          const people=new Set(parsed.detectedPeople.map(x=>x.sourceName));
          const dates=new Set(matrix.dates.map(x=>x.date));
          let cellCorrect=0,falseOff=0,nonOff=0,startCorrect=0,startTotal=0,endCorrect=0,endTotal=0;
          let offTruth=0,offPredicted=0,offCorrect=0;
          const logical={};
          for(const cell of truth.cells){
            const key=cell.person+'|'+cell.date,out=outputs.get(key);
            if(cell.state!=='OFF')nonOff++; else offTruth++;
            if(out?.state==='OFF'){
              offPredicted++;
              if(cell.state==='OFF')offCorrect++; else falseOff++;
            }
            if(cell.start){startTotal++;if(out?.start===cell.start)startCorrect++;}
            if(cell.end){endTotal++;if(out?.end===cell.end)endCorrect++;}
            const exact=!!out&&out.state===cell.state&&
              (cell.start==null||out.start===cell.start)&&
              (cell.end==null||out.end===cell.end);
            if(exact)cellCorrect++;
            logical[key]=out?out.state+'|'+(out.start??'')+'|'+(out.end??''):'MISSING';
          }
          const personCorrect=truth.names.filter(x=>people.has(x)).length;
          const truthDates=[...new Set(truth.cells.map(x=>x.date))];
          const dateCorrect=truthDates.filter(x=>dates.has(x)).length;
          const wrongAuto=[...people].filter(x=>!truth.names.includes(x)&&!x.startsWith('이름 확인 필요')).length;
          const complete=truth.cells.every(x=>outputs.has(x.person+'|'+x.date))&&
            truth.names.every(x=>people.has(x))&&truthDates.every(x=>dates.has(x));
          return {
            personCorrect,personTotal:truth.names.length,dateCorrect,dateTotal:truthDates.length,
            startCorrect,startTotal,endCorrect,endTotal,cellCorrect,cellTotal:truth.cells.length,
            falseOff,nonOff,offTruth,offPredicted,offCorrect,wrongAuto,
            complete:complete?1:0,imageExact:cellCorrect===truth.cells.length?1:0,logical,
          };
        }

        const paddle=await createPaddleDetectedRegionRecognizer();
        const items=[];
        const initialMemory=performance.memory?.usedJSHeapSize??null;
        try{
          for(const spec of specs){
            const generated=await generate(spec);
            const detector=new BrowserScheduleTableStructureDetector();
            const detectionStarted=performance.now();
            const detection=await detector.detect(generated.file);
            const detectionMs=Math.round(performance.now()-detectionStarted);
            const geometry=geometryFromDetection(detection);
            const mappings=commonMappings(geometry,generated.truth);
            const geomScore=geometryMetrics(detection,geometry,generated.truth,mappings);
            const oracle=oracleRegions(generated.truth);
            const detected=geometry.regions;
            const allRegions=[...detected,...oracle];

            const tessExtractor=new TesseractScheduleImageTextExtractor(
              new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS),
              new BrowserScheduleOcrPreprocessor(),{useStructureFirstMode:true});
            const tessStarted=performance.now();
            let tessRegional=[];
            try{tessRegional=allRegions.length?await tessExtractor.extractRegions(generated.file,allRegions):[];}
            catch(error){tessRegional=[];}
            const tessContexts=await tesseractRawRegions(generated.file,[
              ...(geometry.calendar?[geometry.calendar]:[]),
              {...generated.truth.calendar,id:'calendar::oracle',purpose:'context'},
            ]);
            const tessMs=Math.round(performance.now()-tessStarted);
            const tMap=mapById([...tessRegional,...tessContexts]);

            const paddleStarted=performance.now();
            const paddleBatch=await paddle.recognizeRegions(generated.file,[
              ...allRegions,
              ...(geometry.calendar?[geometry.calendar]:[]),
              {...generated.truth.calendar,id:'calendar::oracle',purpose:'context'},
            ]);
            const paddleMs=Math.round(performance.now()-paddleStarted);
            const pMap=mapById(paddleBatch.results);

            const architectures={};
            for(const arch of architectureNames){
              const detectedRaw=scoreRaw('detected',arch,tMap,pMap,generated.truth,mappings,generated.truth.names);
              const oracleRaw=scoreRaw('oracle',arch,tMap,pMap,generated.truth,
                {rowMatches:generated.truth.personRects.map((_,i)=>({index:i,iou:1})),
                 colMatches:generated.truth.dateRects.map((_,i)=>({index:i,iou:1}))},
                generated.truth.names);
              const parseStarted=performance.now();
              let pipeline,diagnostics,error=null;
              try{
                if(!geometry.valid)throw Error('STRUCTURE_COMMON_ROI_UNAVAILABLE');
                const layout=buildSelectedLayout(arch,tMap,pMap,geometry,generated.truth,generated.truth.names);
                const matrix=buildScheduleCellMatrix(detection,layout);
                diagnostics=inspectScheduleMatrixInput(detection,layout);
                if(!matrix)throw Error('MATRIX_NULL:'+diagnostics.failureStage);
                const regionResults=mapRegionalResults(matrix,arch,tMap,pMap,geometry,generated.truth.names);
                const parsed=interpretStructureFirstSchedule(matrix,regionResults,generated.truth.names);
                pipeline=scorePipeline(parsed,matrix,generated.truth);
              }catch(e){
                error=String(e).slice(0,260);
                const logical={};
                for(const cell of generated.truth.cells)logical[cell.person+'|'+cell.date]='MISSING';
                pipeline={personCorrect:0,personTotal:generated.truth.names.length,
                  dateCorrect:0,dateTotal:new Set(generated.truth.cells.map(x=>x.date)).size,
                  startCorrect:0,startTotal:generated.truth.cells.filter(x=>x.start).length,
                  endCorrect:0,endTotal:generated.truth.cells.filter(x=>x.end).length,
                  cellCorrect:0,cellTotal:generated.truth.cells.length,falseOff:0,
                  nonOff:generated.truth.cells.filter(x=>x.state!=='OFF').length,
                  offTruth:generated.truth.cells.filter(x=>x.state==='OFF').length,
                  offPredicted:0,offCorrect:0,wrongAuto:0,complete:0,imageExact:0,logical};
              }
              const parseMs=Math.round(performance.now()-parseStarted);
              const ocrMs=arch==='TESSERACT'?tessMs:arch==='PADDLE'?paddleMs:tessMs+paddleMs;
              architectures[arch]={detectedRaw,oracleRaw,pipeline,error,diagnostics,
                timing:{detectionMs,ocrMs,parseMs,totalMs:detectionMs+ocrMs+parseMs}};
            }
            items.push({id:spec.id,family:spec.family,variant:spec.variant,bytes:generated.bytes,
              geometry:geomScore,geometryValid:geometry.valid,
              detectedRows:geometry.rows.length,detectedColumns:geometry.dateColumns.length,
              tessMs,paddleMs,paddleInferenceMs:paddleBatch.inferenceMs,
              architectures});
          }
        }finally{await paddle.release();}
        return {paddleMetadata:paddle.metadata,initialMemory,
          finalMemory:performance.memory?.usedJSHeapSize??null,items};
      },specs);
      browserResults.push({browser:browserName,pageErrors,result});
    }finally{await browser.close();}
  }
}finally{await server.close();}

function ratio(correct,total){return total?correct/total:null;}
function aggregate(browser,arch,filter=()=>true){
  const rows=browser.result.items.filter(filter).map(x=>x.architectures[arch]);
  const sum=key=>rows.reduce((n,x)=>n+(x.pipeline[key]??0),0);
  const raw=(which,key)=>rows.reduce((n,x)=>n+(x[which][key]??0),0);
  const times=rows.map(x=>x.timing.totalMs);
  return {
    images:rows.length,
    person:ratio(sum('personCorrect'),sum('personTotal')),
    date:ratio(sum('dateCorrect'),sum('dateTotal')),
    start:ratio(sum('startCorrect'),sum('startTotal')),
    end:ratio(sum('endCorrect'),sum('endTotal')),
    cell:ratio(sum('cellCorrect'),sum('cellTotal')),
    falseOffCount:sum('falseOff'),falseOffRate:ratio(sum('falseOff'),sum('nonOff')),
    offPrecision:ratio(sum('offCorrect'),sum('offPredicted')),
    offRecall:ratio(sum('offCorrect'),sum('offTruth')),
    wrongAuto:sum('wrongAuto'),completeImageRate:ratio(sum('complete'),rows.length),
    imageExactRate:ratio(sum('imageExact'),rows.length),
    oraclePerson:ratio(raw('oracleRaw','personCorrect'),raw('oracleRaw','personTotal')),
    oracleDate:ratio(raw('oracleRaw','dateCorrect'),raw('oracleRaw','dateTotal')),
    oracleStart:ratio(raw('oracleRaw','startCorrect'),raw('oracleRaw','startTotal')),
    oracleEnd:ratio(raw('oracleRaw','endCorrect'),raw('oracleRaw','endTotal')),
    detectedPerson:ratio(raw('detectedRaw','personCorrect'),raw('detectedRaw','personTotal')),
    detectedDate:ratio(raw('detectedRaw','dateCorrect'),raw('detectedRaw','dateTotal')),
    detectedStart:ratio(raw('detectedRaw','startCorrect'),raw('detectedRaw','startTotal')),
    detectedEnd:ratio(raw('detectedRaw','endCorrect'),raw('detectedRaw','endTotal')),
    meanImageMs:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null,
    maxImageMs:times.length?Math.max(...times):null,
  };
}
function parity(arch){
  const left=browserResults.find(x=>x.browser==='CHROMIUM');
  const right=browserResults.find(x=>x.browser==='WEBKIT');
  let match=0,total=0;
  for(const li of left?.result.items??[]){
    const ri=right?.result.items.find(x=>x.id===li.id);
    const lp=li.architectures[arch],rp=ri?.architectures[arch];
    const keys=Object.keys(lp.pipeline.logical);
    for(const key of keys){
      total++;
      if(!lp.error&&!rp?.error&&lp.pipeline.logical[key]===rp.pipeline.logical[key])match++;
    }
  }
  return {match,total,rate:ratio(match,total)};
}
const architectures=['TESSERACT','PADDLE','H1','H2','H3'];
const summary={};
for(const arch of architectures){
  summary[arch]={parity:parity(arch),browsers:{}};
  for(const browser of browserResults){
    summary[arch].browsers[browser.browser]={
      overall:aggregate(browser,arch),
      clean:aggregate(browser,arch,x=>x.variant==='CLEAN'),
      degraded:aggregate(browser,arch,x=>x.variant==='DEGRADED'),
      cleanHoldoutC:aggregate(browser,arch,x=>x.family==='C'&&x.variant==='CLEAN'),
      degradedHoldoutC:aggregate(browser,arch,x=>x.family==='C'&&x.variant==='DEGRADED'),
    };
  }
}
const geometry=browserResults.map(browser=>({
  browser:browser.browser,
  mean:Object.fromEntries(['tableIoU','rowIoU','dateColumnIoU','personCropIoU','cellCropIoU'].map(key=>[
    key,browser.result.items.reduce((n,x)=>n+x.geometry[key],0)/browser.result.items.length,
  ])),
  perImage:browser.result.items.map(x=>({id:x.id,valid:x.geometryValid,...x.geometry,
    rows:x.detectedRows,columns:x.detectedColumns})),
}));
const gate={};
for(const arch of architectures){
  const b=summary[arch].browsers;
  const checks=['CHROMIUM','WEBKIT'].every(name=>{
    const clean=b[name].cleanHoldoutC,degraded=b[name].degradedHoldoutC;
    return clean.person>=.98&&clean.date>=.99&&
      Math.min(clean.start??0,clean.end??0)>=.97&&clean.cell>=.98&&
      (clean.falseOffRate??1)<=.005&&clean.wrongAuto===0&&
      degraded.person>=.95&&degraded.date>=.98&&
      Math.min(degraded.start??0,degraded.end??0)>=.95&&degraded.cell>=.95&&
      (degraded.falseOffRate??1)<=.01&&degraded.wrongAuto===0;
  });
  gate[arch]={quality:checks,parity:(summary[arch].parity.rate??0)>=.99,
    accepted:checks&&(summary[arch].parity.rate??0)>=.99};
}
const modelSize={
  paddleOnnxBytes:fs.statSync(path.join(root,'public/ocr-paddle-probe/inference.onnx')).size,
  paddleDictionaryBytes:fs.statSync(path.join(root,'public/ocr-paddle-probe/dict.json')).size,
  ortWasmBytes:fs.statSync(path.join(root,'public/ort/ort-wasm-simd-threaded.wasm')).size,
  tesseractRuntimeBytes:49903840,
};
const report={
  input:'GENERATED_ONLY_COMMON_DETECTED_ROI_NO_USER_IMAGE',
  browsers:browserResults.map(x=>({browser:x.browser,pageErrors:x.pageErrors,
    paddleMetadata:x.result.paddleMetadata,initialMemory:x.result.initialMemory,
    finalMemory:x.result.finalMemory,items:x.result.items})),
  geometry,summary,gate,modelSize,
  physicalIPhone:'PHYSICAL_IPHONE_NOT_VERIFIED',
  userImageUsed:false,kakaoLiveRouteCalls:0,
};
console.log('CBH_DETECTED_ENGINE_MATRIX_REPORT='+JSON.stringify(report));
const accepted=architectures.filter(x=>gate[x].accepted);
console.log('CBH_DETECTED_ENGINE_ACCEPTED='+JSON.stringify(accepted));
if(browserResults.some(x=>x.pageErrors.length))throw Error('Browser runtime page errors observed');
if(!accepted.length)throw Error('OCR merge gate failed after complete Tesseract/Paddle/Hybrid matrix evaluation');
