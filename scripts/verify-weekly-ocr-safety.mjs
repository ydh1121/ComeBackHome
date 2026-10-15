import assert from 'node:assert/strict';
import {createServer} from 'vite';
// Injected observations test interpretation and review safety, NOT OCR accuracy.
const vite=await createServer({appType:'custom',logLevel:'error',server:{middlewareMode:true}});
const storage=new Map();
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
try {
  const {interpretWeekly3Column,parseWeeklyBreakMinutes}=await vite.ssrLoadModule('/src/providers/import/Weekly3ColumnScheduleMatrix.ts');
  const {WorkbookImportFileSelectionAction,releasePrivateImportImage}=await vite.ssrLoadModule('/src/application/services/WorkbookImportFileSelectionAction.ts');
  const {BrowserImportRepository}=await vite.ssrLoadModule('/src/providers/browser/BrowserImportRepository.ts');
  const fields=['start','end','break'];
  for(const [raw,wanted] of [['0.25',15],['0.75',45],['1.5',90],['30분',30],['1:15',75],['12',720],['13',null],['0.2',null],['?',null],['1:60',null]])
    assert.equal(parseWeeklyBreakMinutes(raw),wanted,raw);
  const inputs=[['0.5','08:15','0.25'],['','',''],['OFF','',''],['??','??',''],['09','09','0.5'],['09','10','2'],['휴무','18','0.5']];
  const days=Array.from({length:7},(_,index)=>({index,bounds:{x:100+index*90,y:0,width:90,height:180}}));
  const matrix={kind:'WEEKLY_7D_3COL',geometrySource:'PIXEL',headerSource:'OBSERVED_LABELS',headerBands:[{x:0,y:0,width:730,height:30}],days,
    rows:[0,1].map(index=>({index,bounds:{x:0,y:40+index*60,width:730,height:60},nameBounds:{x:0,y:40+index*60,width:100,height:60},cells:days.flatMap(day=>fields.map((field,f)=>({
      id:`weekly::${index}::${day.index}::${field}`,rowIndex:index,dayIndex:day.index,field,bounds:{x:day.bounds.x+f*30,y:40+index*60,width:30,height:60},visual:{occupancy:inputs[day.index][f]?'CONTENT':'EMPTY'},
    })))})),physicalCellCount:42};
  const dates={dates:days.map(day=>({dayIndex:day.index,date:'2026-10-'+(12+day.index),observed:true,reviewRequired:false})),yearMonthObserved:true,observedDayAnchors:7,uniqueWeek:true,acceptedForAutomaticSave:false};
  const regional=matrix.rows.flatMap(row=>[
    {id:'weekly-person::'+row.index,purpose:'person',text:'김가은',confidence:.99,tokens:[]},
    ...row.cells.map(cell=>({id:cell.id,purpose:'cell',text:inputs[cell.dayIndex][fields.indexOf(cell.field)],confidence:.99,tokens:[]})),
  ]);
  const result=interpretWeekly3Column(matrix,dates,regional,['김가은']);
  const all=[...result.parsed.scheduleCandidates,...result.parsed.reviewCandidates];
  assert.equal(all.length,14);assert.equal(result.parsed.detectedPeople.length,2);
  assert.notEqual(result.parsed.detectedPeople[0].sourceName,result.parsed.detectedPeople[1].sourceName,'equal OCR names must not collapse physical people');
  const first=all.filter(x=>x.sourceRow===1).sort((a,b)=>a.dayIndex-b.dayIndex);
  assert.deepEqual(first.map(c=>c.sourceCellKind),['SHIFT','BLANK','EXPLICIT_OFF','UNREADABLE','UNREADABLE','UNREADABLE','UNREADABLE']);
  assert.equal(first[0].start,'00:30');assert.equal(first[0].end,'08:15');assert.equal(first[0].breakMinutes,15);
  assert.equal(first[1].recognitionState,'OFF_CANDIDATE');assert.equal(first[2].recognitionState,'OFF_CANDIDATE');
  assert.equal(first[5].breakReviewRequired,true);
  assert.ok(all.every(c=>c.enabled!==false),'no empty or OFF label is a confirmed OFF');
  assert.equal(result.parsed.structure.needsReview,true);assert.equal(result.parsed.structure.weeklyReview.confirmed,false);
  const imports=new BrowserImportRepository();let writes=0;
  const people={list:async()=>[{id:'one-person',name:'김가은'}]};
  const schedules={getByDate:async()=>null,upsert:async()=>{writes++;}};
  const action=new WorkbookImportFileSelectionAction(imports,people,schedules,{parse:async()=>{throw Error('XLSX_UNUSED');}},{parse:async()=>result.parsed});
  const id=await action.accept([{kind:'IMAGE',file:new File(['synthetic'],'unit.png',{type:'image/png'})}]);
  const batch=await imports.getBatch(id);
  assert.equal(batch.reviewItems.length,14);assert.equal(batch.detectedPeople.length,2);
  assert.ok(batch.detectedPeople.every(p=>p.matchedPersonId===null),'colliding OCR names require separate identity mapping');
  assert.ok(batch.reviewItems.every(c=>c.resolution===null&&c.personId===null));
  assert.deepEqual(batch.reviewItems.filter(c=>c.sourceRow===1).sort((a,b)=>a.dayIndex-b.dayIndex).map(c=>c.sourceCellKind),first.map(c=>c.sourceCellKind));
  assert.equal(writes,0);releasePrivateImportImage();
  console.log('CBH_WEEKLY_OCR_SAFETY_PASS blank_explicit_off_unreadable_distinct duplicate_rows_preserved quarter_break early_clock invalid_duration no_automatic_approval writes=0 injected_observations_not_accuracy');
} finally {delete globalThis.localStorage;await vite.close();}
