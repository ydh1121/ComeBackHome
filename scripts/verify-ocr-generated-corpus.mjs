import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const families = [
  { id: 'A', seed: 112733, count: 24 },
  { id: 'B', seed: 291079, count: 24 },
  { id: 'C', seed: 894119, count: 24 },
];
function rng(seed) {
  let value = seed >>> 0;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function pick(random, values) { return values[Math.floor(random() * values.length)]; }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, bytes) {
  const name = Buffer.from(type);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([header, name, bytes, checksum]);
}
function encodeRasterPng(raster) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(raster.width, 0);
  ihdr.writeUInt32BE(raster.height, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale
  const scanlines = Buffer.alloc((raster.width + 1) * raster.height);
  for (let y = 0; y < raster.height; y++) {
    scanlines[y * (raster.width + 1)] = 0;
    scanlines.set(raster.luminance.subarray(y * raster.width, (y + 1) * raster.width),
      y * (raster.width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 4 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function personName(id) {
  return String.fromCharCode(0xac00 + (id * 53) % 11172) +
    String.fromCharCode(0xac00 + (id * 139 + 27) % 11172) +
    String.fromCharCode(0xac00 + (id * 41 + 47) % 11172);
}
function token(text, x, y, width, height, confidence = 0.97) {
  return { text, x, y, width, height, confidence };
}
function generate(family, index) {
  const random = rng(family.seed + index * 7907);
  const personCount = index === 0 ? 1 : index === 1 ? 30 : 1 + Math.floor(random() * 30);
  const dateCount = index === 0 ? 2 : index === 1 ? 31 : 2 + Math.floor(random() * 30);
  const cellWidth = 56 + Math.floor(random() * 25);
  const cellHeight = 25 + Math.floor(random() * 15);
  const labelWidth = 100 + Math.floor(random() * 24);
  const top = 38 + Math.floor(random() * 23), left = 18 + Math.floor(random() * 18);
  const width = left + labelWidth + cellWidth * dateCount + 28;
  const height = top + cellHeight * (personCount + 1) + 22;
  const background = pick(random, [255,249,241,223,208]);
  const raster = { width, height, luminance: new Uint8Array(width * height).fill(background) };
  const tableLeft = left, tableTop = top;
  const right = left + labelWidth + cellWidth * dateCount;
  const bottom = top + cellHeight * (personCount + 1);
  function rect(x, y, w, h, value) {
    const x0=Math.max(0,Math.floor(x)), x1=Math.min(width,Math.ceil(x+w));
    const y0=Math.max(0,Math.floor(y)), y1=Math.min(height,Math.ceil(y+h));
    for(let yy=y0;yy<y1;yy++) for(let xx=x0;xx<x1;xx++)
      raster.luminance[yy*width+xx]=value;
  }
  const style = ['THIN','THICK','PARTIAL','NONE'][((index+family.id.charCodeAt(0))%4)];
  const line = style === 'THICK' ? 3 : 1;
  const tokens = [], regions = new Map(), truth = [];
  tokens.push(token('2026년 10월', left, Math.max(3,top-30), 90, 18));
  const names = Array.from({ length:personCount }, (_,i) => personName(i+index*33+family.seed));
  for(let d=0;d<dateCount;d++) {
    const day = d+1, headX=left+labelWidth+d*cellWidth;
    const format=(index+d+family.id.charCodeAt(0))%7;
    const label = format===0 ? String(day) : format===1 ? String(day).padStart(2,'0') :
      format===2 ? '10/'+day : format===3 ? '10/'+String(day).padStart(2,'0') :
      format===4 ? day+'일' : format===5 ? '10월'+day+'일' :
      '2026-10-'+String(day).padStart(2,'0');
    tokens.push(token(label,headX+cellWidth*0.2,top+cellHeight*0.2,
      cellWidth*0.6,cellHeight*0.5));
    rect(headX+cellWidth*0.34,top+cellHeight*0.34,cellWidth*0.27,3,45);
  }
  // Draw solid local-background colored blanks before painting content.
  for(let p=0;p<personCount;p++){
    const y=top+(p+1)*cellHeight;
    tokens.push(token(names[p],left+8,y+cellHeight*0.3,labelWidth*0.72,cellHeight*0.48));
    rect(left+15,y+cellHeight*0.45,labelWidth*0.45,3,41);
    for(let d=0;d<dateCount;d++){
      const x=left+labelWidth+d*cellWidth;
      const offRun=d>0 && d%11<4 && ((p+index)%5===0);
      const state = offRun ? 'OFF' : pick(random,
        ['WORK','WORK','WORK','WORK','OFF','OFF','INCOMPLETE','UNREADABLE']);
      const date='2026-10-'+String(d+1).padStart(2,'0');
      const colored=pick(random,[background,230,205,192,171]);
      if(state==='OFF' && random()<0.65) rect(x+2,y+2,cellWidth-4,cellHeight-4,colored);
      const pieces=[];
      if(state==='WORK'||state==='INCOMPLETE'){
        rect(x+cellWidth*0.20,y+cellHeight*0.38,cellWidth*0.60,3,49);
        const shape=(index+p+d+family.id.charCodeAt(0))%8;
        const time=shape===0?'09:00':shape===1?'9:00':shape===2?'09':
          shape===3?'9':shape===4?'0900':shape===5?'09-18':
          shape===6?'09:00~18:00':'9.5';
        pieces.push(token(time,x+cellWidth*0.14,y+cellHeight*0.24,
          cellWidth*0.7,cellHeight*0.52));
        if(state==='WORK' && shape!==5 && shape!==6)
          pieces.push(token('18:00',x+cellWidth*0.2,y+cellHeight*0.65,
            cellWidth*0.6,cellHeight*0.22));
      }else if(state==='UNREADABLE'){
        rect(x+cellWidth*0.16,y+cellHeight*0.3,cellWidth*0.58,3,65);
        rect(x+cellWidth*0.34,y+cellHeight*0.52,cellWidth*0.4,3,90);
      }else if(state==='OFF' && random()<0.1) {
        rect(x+cellWidth*0.16,y+cellHeight*0.40,cellWidth*0.65,3,50);
        pieces.push(token('휴무',x+cellWidth*0.18,y+cellHeight*0.20,cellWidth*0.6,cellHeight*0.52));
      }
      regions.set(p+'|'+date, pieces);
      truth.push({p,date,state,expectedStart:pieces.length? (pieces[0].text==='9.5'?'09:30':'09:00'):null,expectedEnd:state==='WORK'?'18:00':null});
    }
  }
  if(style!=='NONE'){
    for(let row=0;row<=personCount+1;row++){
      if(style==='PARTIAL' && row>0 && row%3===1)continue;
      rect(tableLeft,tableTop+row*cellHeight-line/2,right-tableLeft,line,80);
    }
    for(let col=0;col<=dateCount+1;col++){
      if(style==='PARTIAL' && col>0 && col%4===1)continue;
      const x=col===0?left:col===1?left+labelWidth:left+labelWidth+(col-1)*cellWidth;
      rect(x-line/2,tableTop,line,bottom-tableTop,80);
    }
  }
  // Header/footer noise is never a person or a scheduled cell.
  tokens.push(token(pick(random,['합계','휴게시간','쉬는시간','출근','퇴근','요일','store','sole']),
    Math.max(0,width-90),Math.max(0,height-18),65,14,0.61));
  return { raster, layout:{width,height,tokens}, truth, names, regions,
    meta:{family:family.id,personCount,dateCount,style,background} };
}
function summarize(truth, matrix, parsed, knownNames) {
  const actual = new Map();
  if(parsed){
    for(const c of parsed.scheduleCandidates) actual.set((c.sourceRow-1)+'|'+c.date,
      {state:'WORK',start:c.start,end:c.end,person:c.sourcePersonName});
    for(const c of parsed.reviewCandidates)actual.set((c.sourceRow-1)+'|'+c.date,
      {state:c.recognitionState,start:c.start,end:c.end,person:c.sourcePersonName});
  }
  const expectedCells=truth.length;
  let correct=0,falseOff=0,falseWork=0,unreadable=0,states={WORK:0,OFF:0,INCOMPLETE:0,UNREADABLE:0};
  let startCorrect=0,endCorrect=0,totalStart=0,totalEnd=0;
  for(const x of truth){
    const found=actual.get(x.p+'|'+x.date);
    const state=found?.state??'UNREADABLE';
    states[state]=(states[state]??0)+1;
    if(state===x.state)correct++;
    if(x.state!=='OFF'&&state==='OFF')falseOff++;
    if(x.state!=='WORK'&&state==='WORK')falseWork++;
    if(state==='UNREADABLE')unreadable++;
    if(x.expectedStart){totalStart++;if(found?.start===x.expectedStart)startCorrect++;}
    if(x.expectedEnd){totalEnd++;if(found?.end===x.expectedEnd)endCorrect++;}
  }
  return {expectedCells,correct,falseOff,falseWork,unreadable,states,
    startCorrect,totalStart,endCorrect,totalEnd,
    personCorrect:parsed?.detectedPeople?.length??0,
    personTotal:new Set(truth.map(x=>x.p)).size,
    dateCorrect:matrix?.dates?.filter(x=>truth.some(t=>t.date===x.date)).length??0,
    dateTotal:new Set(truth.map(x=>x.date)).size,
    garbagePerson:parsed?.detectedPeople?.filter(x=>!knownNames.includes(x.sourceName)).length??0};
}
const results=[];
const temp=await mkdtemp(join(tmpdir(),'cbh-ocr-generated-corpus-'));
const vite=await createServer({root,appType:'custom',logLevel:'error',server:{middlewareMode:true}});
try{
  const detector=await vite.ssrLoadModule('/src/providers/import/ScheduleTableStructureDetector.ts');
  const matrixModule=await vite.ssrLoadModule('/src/providers/import/ScheduleCellMatrix.ts');
  const interp=await vite.ssrLoadModule('/src/providers/import/StructureFirstScheduleImageRecognizer.ts');
  const clocks=await vite.ssrLoadModule('/src/providers/import/StructuredTableImageScheduleRecognizer.ts');
  for(const [input,expected] of [
    ['09:00','09:00'],['9:00','09:00'],['09','09:00'],
    ['9','09:00'],['0900','09:00'],['930','09:30'],
    ['09:30','09:30'],['9.5','09:30'],['1830','18:30'],
    ['2360',null],['2500',null],['2',null],
  ]) assert.equal(clocks.parseScheduleImageClock(input),expected,'Generic clock format '+input);
  for(const family of families){
    const familyResult={family:family.id,seed:family.seed,images:0,cells:0,correct:0,falseOff:0,falseWork:0,
      garbagePerson:0,unreadable:0,personTotal:0,personCorrect:0,dateTotal:0,dateCorrect:0,
      startCorrect:0,totalStart:0,endCorrect:0,totalEnd:0,decodeFailed:0,
      borderStyles:{THIN:0,THICK:0,PARTIAL:0,NONE:0}};
    for(let index=0;index<family.count;index++){
      const item=generate(family,index);
      const png=encodeRasterPng(item.raster);
      assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
      // Actual PNG files (not text mocks); test cleanup is immediate.
      await writeFile(join(temp,family.id+'-'+String(index).padStart(3,'0')+'.png'),png);
      const structure=detector.detectScheduleTableStructureFromRaster(item.raster);
      const detection={structure,raster:item.raster,preprocessingMs:0,structureDetectionMs:0};
      const matrix=matrixModule.buildScheduleCellMatrix(detection,item.layout);
      let parsed=null;
      if(matrix){
        const regional=[];
        for(const row of matrix.rows){
          const name=item.names[row.sourceRow-1]??'';
          regional.push({id:'person::'+row.sourceRow,purpose:'person',
            text:name,confidence:0.98,tokens:[]});
        }
        for(const cell of matrix.cells){
          const parts=item.regions.get((cell.sourceRow-1)+'|'+cell.date)??[];
          regional.push({id:cell.id,purpose:'cell',text:parts.map(x=>x.text).join(' '),
            confidence:0.97,tokens:parts});
        }
        try{parsed=interp.interpretStructureFirstSchedule(matrix,regional,item.names);}
        catch{familyResult.decodeFailed++;}
      } else familyResult.decodeFailed++;
      const m=summarize(item.truth,matrix,parsed,item.names);
      familyResult.images++;
      familyResult.borderStyles[item.meta.style]++;
      for(const key of ['expectedCells','correct','falseOff','falseWork','garbagePerson','unreadable',
        'personTotal','personCorrect','dateTotal','dateCorrect','startCorrect','totalStart',
        'endCorrect','totalEnd']){
        const target=key==='expectedCells'?'cells':key;
        familyResult[target]+=m[key];
      }
    }
    familyResult.cellMatrixAccuracy=+(familyResult.correct/familyResult.cells).toFixed(4);
    familyResult.personAccuracy=+(familyResult.personCorrect/familyResult.personTotal).toFixed(4);
    familyResult.dateAccuracy=+(familyResult.dateCorrect/familyResult.dateTotal).toFixed(4);
    familyResult.startTimeAccuracy=+(familyResult.startCorrect/Math.max(1,familyResult.totalStart)).toFixed(4);
    familyResult.endTimeAccuracy=+(familyResult.endCorrect/Math.max(1,familyResult.totalEnd)).toFixed(4);
    results.push(familyResult);
  }
  const unseen=results.find((item)=>item.family==='C');
  const generatedHoldoutPass=Boolean(unseen && unseen.cellMatrixAccuracy>=0.98 &&
    unseen.falseOff===0 && unseen.garbagePerson===0 &&
    unseen.personAccuracy>=0.98 && unseen.dateAccuracy>=0.98);
  console.log(JSON.stringify({
    generatorFamilies:families.length,
    totalRasterPngImages:results.reduce((sum,item)=>sum+item.images,0),
    testExecution:'PASS_METRIC_COLLECTION_ONLY',
    generatedUnseenHoldoutVerdict:generatedHoldoutPass?'PASS':'FAIL',
    userHoldoutVerdict:'PENDING_USER_QA',
    expectedOriginalImage:'UNSEEN_USER_HOLDOUT',
    realOcrTokens:'GENERATED_REGION_FIXTURE_ONLY',
    codecCoverage:'PNG_ONLY',
    results,
  },null,2));
  const total=results.reduce((s,x)=>s+x.images,0);
  assert.equal(total,72,'A/B/C generated raster corpus incomplete');
  assert.ok(results.every(r=>r.cells>0 && r.images===24),'Generated corpus missing cell truth');
  // These are reported metrics; do not mark USER HOLDOUT PASS from generated data.
}finally{
  await vite.close();
  await rm(temp,{recursive:true,force:true});
}
