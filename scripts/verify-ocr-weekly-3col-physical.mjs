import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

// Synthetic geometry + safety gates only. No OCR token is injected into any
// reported engine accuracy metric. Calendar unit evidence is labeled UNIT.
const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,logLevel:'error',
  server:{host:'127.0.0.1',port:0}});
const outcome=[];
try{
  await server.listen();
  const port=server.httpServer.address()?.port;
  for(const [browserName,engine] of [['CHROMIUM',chromium],['WEBKIT',webkit]]){
    const browser=await engine.launch({headless:true});
    try{
      const page=await browser.newPage({serviceWorkers:'block'});
      await page.goto('http://127.0.0.1:'+port+'/tools/ocr-eval/index.html',
        {waitUntil:'domcontentloaded'});
      const result=await page.evaluate(async()=>{
        const [{BrowserScheduleTableStructureDetector},
               {buildWeekly3ColumnPhysicalMatrix,resolveWeekly3ColumnDates,
                weekly3ColumnProbeRegions,interpretWeekly3Column,
                 reconcileWeekly3ColumnObservedHeader}] = await Promise.all([
          import('/src/providers/import/ScheduleTableStructureDetector.ts'),
          import('/src/providers/import/Weekly3ColumnScheduleMatrix.ts'),
        ]);
        const specs=[
          {id:'A_CLEAN',width:56,height:58,people:4,scale:1},
          {id:'B_CLEAN',width:50,height:54,people:6,scale:1},
          {id:'C_CLEAN_HOLDOUT',width:60,height:61,people:3,scale:1},
          {id:'A_DEGRADED',width:56,height:58,people:4,scale:.8},
          {id:'B_DEGRADED',width:50,height:54,people:6,scale:.78},
          {id:'C_DEGRADED_HOLDOUT',width:60,height:61,people:3,scale:.76},
          // Four physically separated header bands, with a late label row.
          {id:'D_MULTIBAND_HEADER',width:56,height:58,people:4,scale:1,
            headerRows:4,dateHeaderRow:2,headerLabelRow:3},
        ];
        const results=[];
        for(const spec of specs){
          const left=18,top=72,nameWidth=150,headerRows=spec.headerRows??2,
            dateHeaderRow=spec.dateHeaderRow??0,
            headerLabelRow=spec.headerLabelRow??1,subcolumns=21;
          const width=left+nameWidth+spec.width*subcolumns+18;
          const height=top+spec.height*(headerRows+spec.people)+18;
          const canvas=document.createElement('canvas');
          canvas.width=Math.round(width*spec.scale);
          canvas.height=Math.round(height*spec.scale);
          const ctx=canvas.getContext('2d',{alpha:false});
          const scaled=spec.scale;
          ctx.scale(scaled,scaled);
          ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
          ctx.strokeStyle='#636363';ctx.lineWidth=1.8;
          ctx.fillStyle='#191919';ctx.font='bold 21px sans-serif';
          ctx.fillText('2026년 10월',left+3,43);
          const labels=['출근','퇴근','쉬는시간'];
          for(let d=0;d<7;d++){
            const groupLeft=left+nameWidth+d*3*spec.width;
            ctx.font='bold 15px sans-serif';
            ctx.fillStyle='#171717';
            ctx.fillText(String(d+12)+'일',groupLeft+spec.width+8,top+dateHeaderRow*spec.height+34);
            for(let f=0;f<3;f++){
              ctx.fillText(labels[f],groupLeft+f*spec.width+4,top+headerLabelRow*spec.height+34);
            }
          }
          for(let p=0;p<spec.people;p++){
            const y=top+(headerRows+p)*spec.height;
            ctx.fillStyle='#1c1c1c';ctx.font='bold 19px sans-serif';
            ctx.fillText(['강하현','정지윤','박민준','한채린','조유리','서유진'][p],
              left+10,y+34);
            for(let d=0;d<7;d++){
              const off=p===0&&(d===2||d===3);
              const bg=off?(d===2?'#ededed':'#ffefab'):
                (d%3===1?'#f8f8f8':'#fff');
              for(let f=0;f<3;f++){
                const x=left+nameWidth+(d*3+f)*spec.width;
                ctx.fillStyle=bg;ctx.fillRect(x+2,y+2,spec.width-4,spec.height-4);
                if(!off){ctx.fillStyle='#101010';ctx.font='bold 15px sans-serif';
                  ctx.fillText(['9.5','23.5','0.5'][f],x+8,y+33);}
              }
            }
          }
          for(let c=0;c<=22;c++){
            const x=c===0?left:c===1?left+nameWidth:left+nameWidth+(c-1)*spec.width;
            ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+(headerRows+spec.people)*spec.height);ctx.stroke();
          }
          for(let r=0;r<=headerRows+spec.people;r++){
            const y=top+r*spec.height;
            ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+nameWidth+21*spec.width,y);ctx.stroke();
          }
          const blob=await new Promise((resolve,reject)=>canvas.toBlob(
            item=>item?resolve(item):reject(Error('encode fail')),
            spec.scale<1?'image/jpeg':'image/png',
            spec.scale<1?.76:1));
          const file=new File([blob],spec.id+'.png',{type:blob.type});
          const detector=new BrowserScheduleTableStructureDetector();
          const detection=await detector.detect(file);
          const emptyLayout={width:canvas.width,height:canvas.height,tokens:[]};
          const physical=buildWeekly3ColumnPhysicalMatrix(detection,emptyLayout);
          const unresolved=physical?resolveWeekly3ColumnDates(physical,emptyLayout):null;
          const regions=physical?weekly3ColumnProbeRegions(physical):[];
          const result={id:spec.id,physical:!!physical,
            rows:physical?.rows.length??0,days:physical?.days.length??0,
            cells:physical?.physicalCellCount??0,header:physical?.headerSource??null,
            dateResolved:unresolved?.dates.some(x=>x.date!=null)??false,
            autoSave:unresolved?.acceptedForAutomaticSave??false,
            roiCount:regions.length,
            pixelColumns:detection.structure.columnBands.length,
            rowBands:detection.structure.rowBands.length,
          };
          if(physical){
            if(spec.id==='D_MULTIBAND_HEADER'){
              // These are synthetic UNIT observations only, never credited
              // as OCR accuracy. They prove remapping and fail-closed dates.
              const labels=['출근','퇴근','쉬는시간'];
              const evidence=Array.from({length:7},(_,day)=>
                labels.map((text,field)=>({
                  id:'weekly::1::'+day+'::'+['start','end','break'][field],
                  purpose:'cell',text,confidence:.98,tokens:[],
                }))).flat();
              const sparse=evidence.filter(item=>item.id.includes('::0::'));
              const notEnough=reconcileWeekly3ColumnObservedHeader(physical,sparse);
              if(notEnough.shiftedRows!==0)
                throw Error('One-day header labels cannot change geometry');
              const aligned=reconcileWeekly3ColumnObservedHeader(physical,evidence);
              if(aligned.shiftedRows!==2||aligned.matrix.rows.length!==spec.people||
                 aligned.matrix.headerBands.length!==4||
                 aligned.matrix.headerSource!=='OBSERVED_LABELS')
                throw Error('Observed multi-day header not reconciled');
              const owned=weekly3ColumnProbeRegions(aligned.matrix)
                .filter(item=>item.purpose==='date');
              if(owned.length!==28||
                 !owned.some(item=>item.id==='date::grid-cell::weekly::4::header::2'))
                throw Error('Multi-band physical date ROI missing');
              const direct=[0,4].map(day=>({
                id:'date::grid-cell::weekly::'+day+'::header::2',
                purpose:'date',text:'2026-10-'+String(12+day).padStart(2,'0'),
                confidence:.99,tokens:[],
              }));
              const dates=resolveWeekly3ColumnDates(aligned.matrix,emptyLayout,direct);
              if(!dates.uniqueWeek||dates.observedDayAnchors!==2||
                 dates.dates[0].date!=='2026-10-12'||
                 dates.dates[6].date!=='2026-10-18'||
                 dates.acceptedForAutomaticSave)
                throw Error('Observed full-date anchors not preserved');
              const contradicted=resolveWeekly3ColumnDates(aligned.matrix,
                emptyLayout,[...direct,{...direct[1],text:'2026-10-17'}]);
              if(contradicted.uniqueWeek||contradicted.dates.some(x=>x.date!=null))
                throw Error('Conflicting physical date evidence accepted');
              result.headerRealignmentUnit='PASS';
              result.multibandDateUnit='PASS';
              result.dateContradictionUnit='PASS';
            }
            const emptyOcr=regions.map(region=>({
              id:region.id,purpose:region.purpose,text:'',tokens:[],confidence:0,
            }));
            const parsed=interpretWeekly3Column(physical,unresolved,emptyOcr,[]);
            result.blocked=parsed.blockedReason;
            result.offAutoCommit=parsed.parsed?.scheduleCandidates.filter(x=>false).length??0;
          }
          results.push(result);
        }
        return results;
      });
      outcome.push({browser:browserName,results:result});
    }finally{await browser.close();}
  }
}finally{await server.close();}
console.log('CBH_WEEKLY_3COL_PHYSICAL='+JSON.stringify(outcome));
for(const browser of outcome){
  for(const row of browser.results){
    assert.equal(row.physical,true,'No date OCR must not erase physical grid: '+row.id);
    assert.equal(row.days,7);
    assert.ok(row.rows>0&&row.rows<=6);
    assert.equal(row.cells,row.rows*21);
    assert.equal(row.dateResolved,false);
    assert.equal(row.autoSave,false);
    assert.equal(row.blocked,'WEEKLY_DATE_REVIEW_REQUIRED');
  }
}
console.log('CBH_WEEKLY_3COL_PHYSICAL_DATE_INDEPENDENCE_PASS');
