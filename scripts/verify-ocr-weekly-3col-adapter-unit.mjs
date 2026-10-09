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
  console.log('WEEKLY_ADAPTER_UNIT_DATE_INDEPENDENCE_AND_MANUAL_OFF_REVIEW_PASS');
}finally{await vite.close()}
