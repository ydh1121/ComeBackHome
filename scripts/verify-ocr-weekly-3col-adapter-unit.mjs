import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

// Contract/unit test. Injected synthetic tokens are NOT OCR performance
// evidence and must never be included in the real-image quality report.
const root=fileURLToPath(new URL('../',import.meta.url));
const vite=await createServer({root,logLevel:'error',server:{middlewareMode:true}});
try {
  const {Weekly3ColumnScheduleImageRecognizer} =
    await vite.ssrLoadModule('/src/providers/import/Weekly3ColumnScheduleImageRecognizer.ts');
  const width=1180,height=240,nameWidth=110,fieldWidth=50;
  const colWidths=[nameWidth,...Array(21).fill(fieldWidth)];
  let x=10;
  const columns=colWidths.map((w,index)=>{
    const item={index,bounds:{x,y:0,width:w,height},confidence:1};
    x+=w;
    return item;
  });
  const raster={width,height,luminance:new Uint8Array(width*height).fill(255)};
  const rowBands=[
    {index:0,bounds:{x:10,y:25,width:1160,height:48},confidence:1},
    {index:1,bounds:{x:10,y:73,width:1160,height:48},confidence:1},
    {index:2,bounds:{x:10,y:121,width:1160,height:60},confidence:1},
  ];
  const structure={
    imageWidth:width,imageHeight:height,
    tableBounds:{x:10,y:25,width:1160,height:156},
    rowBands,columnBands:columns,confidence:1,
    evidence:{
      horizontalLinePositions:[],verticalLinePositions:[],
      horizontalContinuity:0,verticalContinuity:0,
      repeatedRowSpacing:0,repeatedColumnSpacing:0,source:'PIXEL_PARTIAL',
    },
  };
  const detector={async detect(){return {
    raster,structure,preprocessingMs:1,structureDetectionMs:1,
  }}};
  const titleTokens=[
    {text:'2026',x:12,y:2,width:35,height:15,confidence:1},
    {text:'년',x:49,y:2,width:10,height:15,confidence:1},
    {text:'10',x:61,y:2,width:18,height:15,confidence:1},
    {text:'월',x:82,y:2,width:12,height:15,confidence:1},
  ];
  const header={async extract(){return {
    width,height,tokens:titleTokens,
  }}};
  const regional={
    async extract(){return {width,height,tokens:[]}},
    async extractRegions(_file,regions){
      return regions.map(region=>{
        const match=/^date::grid-cell::weekly::(\d)$/.exec(region.id);
        const text=match?String(12+Number(match[1]))+'일':
          region.id==='weekly-person::0'?'김가은':'';
        const token=text?{
          text,x:region.x+region.width*.2,y:region.y+region.height*.3,
          width:region.width*.6,height:region.height*.4,confidence:1,
        }:null;
        return {id:region.id,purpose:region.purpose,text,
          tokens:token?[token]:[],confidence:text?1:0};
      });
    },
  };
  const recognizer=new Weekly3ColumnScheduleImageRecognizer(
    detector,header,regional,async()=>['다른직원']);
  const parsed=await recognizer.parse(new File(['generated'],'unit.png',{type:'image/png'}));
  assert.equal(parsed.structure.needsReview,true);
  assert.equal(parsed.detectedPeople.length,1);
  assert.equal(parsed.detectedPeople[0].sourceName,'김가은');
  assert.equal(parsed.detectedPeople[0].confidence,.2);
  assert.equal(parsed.scheduleCandidates.length,0);
  assert.equal(parsed.reviewCandidates.length,7);
  assert.deepEqual(parsed.reviewCandidates.map(x=>x.date),
    Array.from({length:7},(_,i)=>'2026-10-'+String(12+i).padStart(2,'0')));
  assert.ok(parsed.reviewCandidates.every(x=>
    x.recognitionState==='OFF_CANDIDATE' && x.enabled===true &&
    x.start===null&&x.end===null));

  const {
    buildWeekly3ColumnPhysicalMatrix,resolveWeekly3ColumnDates,
    weekly3ColumnProbeRegions,
  }=await vite.ssrLoadModule('/src/providers/import/Weekly3ColumnScheduleMatrix.ts');
  const matrix=buildWeekly3ColumnPhysicalMatrix(
    await detector.detect(),{width,height,tokens:[]});
  assert.ok(matrix,'Generated test grid should exist independently of title OCR');
  const regions=weekly3ColumnProbeRegions(matrix);
  const probes=await regional.extractRegions(null,regions);
  const first={width,height,tokens:[]};
  const title=probes.find(x=>x.id==='weekly::title::observed');
  assert.ok(title,'Physical title crop must exist in the same image');
  const observedYearMonth={
    ...title,text:'2026년 10월',confidence:.99,
  };
  const dated=resolveWeekly3ColumnDates(matrix,first,[
    ...probes.filter(x=>x.purpose==='date'),observedYearMonth,
  ]);
  assert.equal(dated.yearMonthObserved,true);
  assert.equal(dated.observedDayAnchors,7);
  assert.equal(dated.uniqueWeek,true);
  assert.deepEqual(dated.dates.map(x=>x.date),parsed.reviewCandidates.map(x=>x.date));
  assert.equal(dated.acceptedForAutomaticSave,false);
  // Broad header OCR can see an unrelated numeral inside a date group's
  // physical header. An exact dedicated date crop must outrank that noise.
  const falselyLocatedDate={
    text:'25일',x:matrix.days[0].bounds.x+8,
    y:matrix.headerBands[0].y+8,width:24,height:18,confidence:.9,
  };
  const scoped=resolveWeekly3ColumnDates(matrix,{
    width,height,tokens:[...titleTokens,falselyLocatedDate],
  },[...probes.filter(x=>x.purpose==='date')]);
  assert.deepEqual(scoped.dates.map(x=>x.date),dated.dates.map(x=>x.date),
    'Broad OCR noise must not veto clean dedicated date-crop evidence');
  // OCR boxes reported by rec runtimes may drift into adjacent dates;
  // the already-detected crop ID is the authoritative physical owner.
  const dateZero=probes.find(x=>x.id==='date::grid-cell::weekly::0');
  assert.ok(dateZero);
  const shiftedBox={...dateZero,tokens:dateZero.tokens.map(token=>({
    ...token,
    x:matrix.days[1].bounds.x+matrix.days[1].bounds.width*.20,
  }))};
  const ownership=resolveWeekly3ColumnDates(matrix,{
    width,height,tokens:titleTokens,
  },[...probes.filter(x=>x.purpose==='date'&&x.id!==dateZero.id),shiftedBox]);
  assert.deepEqual(ownership.dates.map(x=>x.date),dated.dates.map(x=>x.date),
    'A dated crop cannot change weekday when OCR text boxes shift');
  // Two contradictory high-confidence readings INSIDE the same dedicated
  // physical date crop remain unresolved, never calendar-interpolated.
  const dayZero=probes.find(x=>x.id==='date::grid-cell::weekly::0');
  assert.ok(dayZero);
  const contradictory={...dayZero,tokens:[
    ...dayZero.tokens,{
      text:'25일',x:dayZero.tokens[0].x,
      y:dayZero.tokens[0].y,
      width:dayZero.tokens[0].width,
      height:dayZero.tokens[0].height,
      confidence:.99,
    },
  ]};
  const ambiguous=resolveWeekly3ColumnDates(matrix,{
    width,height,tokens:titleTokens,
  },[...probes.filter(x=>x.purpose==='date'&&x.id!==dayZero.id),
    contradictory]);
  assert.ok(ambiguous.dates.every(x=>x.date===null),
    'Contradictory dedicated OCR evidence must remain review-only');
  const conflict=resolveWeekly3ColumnDates(matrix,{
    width,height,tokens:titleTokens,
  },[...probes.filter(x=>x.purpose==='date'),{
    ...observedYearMonth,text:'2026년 11월',
  }]);
  assert.equal(conflict.yearMonthObserved,false,
    'Contradictory calendar OCR must not be auto-resolved');
  assert.ok(conflict.dates.every(x=>x.date===null));
  // Regression for the verified private-layout defect: four physical header
  // rows (weekday / full date / note / shift labels) with no YYYY년 M월 title.
  // No private image bytes or private roster values are used here.
  const fourHeaderRows=[
    {index:0,bounds:{x:10,y:0,width:1160,height:24},confidence:1},
    {index:1,bounds:{x:10,y:24,width:1160,height:24},confidence:1},
    {index:2,bounds:{x:10,y:48,width:1160,height:24},confidence:1},
    {index:3,bounds:{x:10,y:72,width:1160,height:24},confidence:1},
    {index:4,bounds:{x:10,y:96,width:1160,height:60},confidence:1},
  ];
  const shiftLabelTokens=[0,1,2].map(day=>{
    const band=columns[1+day*3].bounds;
    return {text:'출근',x:band.x+5,y:77,width:28,height:14,confidence:1};
  });
  const fourMatrix=buildWeekly3ColumnPhysicalMatrix({
    raster,structure:{...structure,rowBands:fourHeaderRows,
      tableBounds:{x:10,y:0,width:1160,height:156}},
    preprocessingMs:1,structureDetectionMs:1,
  },{width,height,tokens:shiftLabelTokens});
  assert.ok(fourMatrix,'Four-header-row generated matrix must be detected');
  assert.equal(fourMatrix.headerBands.length,4);
  assert.equal(fourMatrix.headerBands[0].y,0,
    'Verified real-layout shape starts its first header band at y=0');
  assert.equal(fourMatrix.rows.length,1);
  const allDateRegions=weekly3ColumnProbeRegions(fourMatrix)
    .filter(x=>x.purpose==='date');
  assert.equal(allDateRegions.length,7*fourMatrix.headerBands.length);
  for(const [index,band] of fourMatrix.headerBands.entries()){
    const owned=allDateRegions.filter(x=>index
      ? x.id.endsWith('::header::'+index)
      : /^date::grid-cell::weekly::[0-6]$/.test(x.id));
    assert.equal(owned.length,7);
    assert.ok(owned.every(x=>x.y===band.y&&x.height===band.height));
  }
  const legacyDateRegions=allDateRegions.filter(x=>
    /^date::grid-cell::weekly::[0-6]$/.test(x.id));

  const fullDateToken=(dayIndex,text)=>{
    const day=fourMatrix.days[dayIndex];
    return {text,x:day.bounds.x+20,y:28,width:90,height:14,confidence:.99};
  };
  const titleless=(pairs)=>({width,height,tokens:pairs.map(
    ([index,text])=>fullDateToken(index,text))});
  const expectedJulyWeek=Array.from({length:7},(_,i)=>
    '2026-07-'+String(20+i).padStart(2,'0'));

  // CASE B — perfect ISO tokens.
  const perfectIso=resolveWeekly3ColumnDates(fourMatrix,titleless(
    expectedJulyWeek.map((date,index)=>[index,date])),[]);
  assert.deepEqual(perfectIso.dates.map(x=>x.date),expectedJulyWeek);
  assert.equal(perfectIso.observedDayAnchors,7);
  assert.ok(perfectIso.dates.every(x=>x.observed&&!x.reviewRequired));
  assert.equal(perfectIso.acceptedForAutomaticSave,false);

  // CASE C — separator-free YYYYMMDD.
  const noSeparators=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'20260720'],[1,'20260721'],
  ]),[]);
  assert.deepEqual(noSeparators.dates.map(x=>x.date),expectedJulyWeek);
  assert.equal(noSeparators.observedDayAnchors,2);
  assert.deepEqual(noSeparators.dates.map(x=>x.observed),
    [true,true,false,false,false,false,false]);
  assert.ok(noSeparators.dates.slice(2).every(x=>x.reviewRequired));

  // CASE D — partial separator loss.
  const partialSeparators=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'2026-0720'],[1,'202607-21'],
  ]),[]);
  assert.deepEqual(partialSeparators.dates.map(x=>x.date),expectedJulyWeek);

  // CASE E — two independent physically-owned anchors are sufficient.
  const twoAnchors=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'2026.07.20'],[6,'2026/07/26'],
  ]),[]);
  assert.deepEqual(twoAnchors.dates.map(x=>x.date),expectedJulyWeek);
  assert.equal(twoAnchors.observedDayAnchors,2);

  // CASE F — one full-date anchor cannot infer an entire week.
  const oneAnchor=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'2026-07-20'],
  ]),[]);
  assert.ok(oneAnchor.dates.every(x=>x.date===null));
  assert.equal(oneAnchor.acceptedForAutomaticSave,false);

  // CASE G — contradictory valid dates in the same physical day fail closed.
  const contradictionFull=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'2026-07-20'],[0,'2026-07-27'],[1,'2026-07-21'],
  ]),[]);
  assert.ok(contradictionFull.dates.every(x=>x.date===null));

  // CASE H — individually valid anchors from different weeks fail closed.
  const inconsistentWeek=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'2026-07-20'],[1,'2026-07-28'],
  ]),[]);
  assert.ok(inconsistentWeek.dates.every(x=>x.date===null));

  // CASE I — impossible calendar evidence is never corrected or accepted.
  const invalidCalendar=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'2026-02-30'],[1,'2026-03-03'],
  ]),[]);
  assert.ok(invalidCalendar.dates.every(x=>x.date===null));

  // Full-date evidence wins before the legacy first-band weekday probes.
  const weekdayProbeNoise=legacyDateRegions.map((region,index)=>({
    id:region.id,purpose:'date',text:['월','화','수','목','금','토','일'][index],
    tokens:[],confidence:.99,
  }));
  const physicalEvidenceFirst=resolveWeekly3ColumnDates(fourMatrix,titleless([
    [0,'2026-07-20'],[1,'2026-07-21'],
  ]),weekdayProbeNoise);
  assert.deepEqual(physicalEvidenceFirst.dates.map(x=>x.date),expectedJulyWeek);
  console.log('WEEKLY_FULL_DATE_PHYSICAL_EVIDENCE_REGRESSION_PASS');
  console.log('WEEKLY_TITLE_FALLBACK_AND_CONFLICT_REVIEW_UNIT_PASS');
  console.log('WEEKLY_ADAPTER_UNIT_DATE_INDEPENDENCE_AND_MANUAL_OFF_REVIEW_PASS');
}finally{await vite.close()}
