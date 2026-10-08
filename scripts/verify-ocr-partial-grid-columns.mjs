import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),
  appType:'custom',logLevel:'error',server:{middlewareMode:true}});
try {
  const {pixelDateHeaderRegions}=await server.ssrLoadModule(
    '/src/providers/import/StructureFirstScheduleImageRecognizer.ts');
  const {pixelSupportedColumnBounds,detectScheduleTableStructureFromRaster}=await server.ssrLoadModule(
    '/src/providers/import/ScheduleTableStructureDetector.ts');
  const {buildScheduleCellMatrix}=await server.ssrLoadModule(
    '/src/providers/import/ScheduleCellMatrix.ts');
  const width=780,height=300;
  const luminance=new Uint8Array(width*height).fill(246);
  const boundaries=[20,120,220,420,520,720];
  // The gap 220->420 and 520->720 represents missing 320 and 620
  // strokes. We verify column geometry only; no dates are inferred.
  for(const x of boundaries){
    for(let y=90;y<274;y++)luminance[y*width+x]=22;
  }
  const detection={
    raster:{width,height,luminance},
    structure:{
      rowBands:[{index:0,bounds:{x:20,y:40,width:700,height:50},confidence:1},
        {index:1,bounds:{x:20,y:90,width:700,height:46},confidence:1}],
      tableBounds:{x:20,y:40,width:700,height:235},
      evidence:{verticalLinePositions:boundaries,
        horizontalLinePositions:[40,90,136,182,228,275],
        source:'PIXEL_PARTIAL'},
    },
  };
  const recovered=pixelDateHeaderRegions(detection);
  assert.equal(recovered.length,7,'Missing partial vertical borders should produce seven physical column ROIs');
  assert.ok(recovered.every(r=>r.purpose==='date' && r.width>=80 && r.width<=105));
  assert.equal(recovered.some(r=>Object.hasOwn(r,'date')||Object.hasOwn(r,'day')),false,
    'Grid reconstruction must never fabricate calendar dates');
  const physical=pixelSupportedColumnBounds(detection);
  assert.deepEqual(physical.map(x=>Math.round(x.x)),
    [20,120,220,320,420,520,620],
    'Only continuous pixel columns may recover missing strokes');
  // Ground truth is supplied only in this generated test, never to recognition.
  // Recognize sparse 1/3/5 date anchors while physical grid has 1..6 columns.
  // The missing day values must NOT be synthesized by matrix reconstruction.
  for(let y=103;y<=115;y++)for(let x=47;x<=69;x++){
    luminance[y*width+x]=12; // representative visible person-row label glyph pixels
  }
  const token=(text,x,y,w=28,h=18)=>({text,x,y,width:w,height:h,confidence:0.99});
  const result=buildScheduleCellMatrix(detection,{
    tokens:[token('2026년 10월',22,6,170,24),
      token('1일',153,53),token('3일',353,53),token('5일',553,53),
      token('김서윤',47,101,65,18)]
  });
  assert.ok(result,'A physical row with recognized date anchors should be recoverable');
  assert.deepEqual(result.dates.map(x=>x.date),
    ['2026-10-01','2026-10-03','2026-10-05'],
    'Unreadable intermediate dates must stay unknown');
  assert.deepEqual(result.dates.map(x=>({x:x.bounds.x,width:x.bounds.width})),
    [{x:120,width:100},{x:320,width:100},{x:520,width:100}],
    'Recognized dates must map to actual cell edges, not sparse token midpoints');
  assert.ok(result.dates.every(x=>x.inferred===false),
    'Physical geometry never proves the date text for an unreadable column');
  const noEvidence=pixelDateHeaderRegions({
    ...detection,
    raster:{width,height,luminance:new Uint8Array(width*height).fill(246)},
  });
  assert.equal(noEvidence.length,0,'Missing pixel evidence must not invent geometry');
  const sparse=pixelDateHeaderRegions({
    ...detection,
    structure:{...detection.structure,evidence:{
      ...detection.structure.evidence,verticalLinePositions:[20,120]}},
  });
  assert.equal(sparse.length,0,'Two lines are insufficient to establish a table');
  // Long, sparse glyph strokes are not table borders even when their
  // projection occupancy resembles a true line. This tests raster detection,
  // without feeding any OCR token or generated calendar truth to production.
  const imageW=480,imageH=270;
  const gridRaster=new Uint8Array(imageW*imageH).fill(246);
  const glyphRaster=new Uint8Array(imageW*imageH).fill(246);
  for(const x of [30,150,270,390]){
    for(let y=40;y<=250;y++)gridRaster[y*imageW+x]=22;
  }
  for(const y of [40,110,180,250]){
    for(let x=30;x<=390;x++)gridRaster[y*imageW+x]=22;
  }
  for(const x of [205,210,215]){
    for(const [top,bottom] of [[75,112],[145,182],[215,252]]){
      for(let y=top;y<=bottom;y++){
        gridRaster[y*imageW+x]=22;
        glyphRaster[y*imageW+x]=22;
      }
    }
  }
  const structure=detectScheduleTableStructureFromRaster({
    width:imageW,height:imageH,luminance:gridRaster,
  });
  assert.equal(structure.evidence.source,'PIXEL_GRID');
  assert.deepEqual(structure.evidence.verticalLinePositions,[30,150,270,390],
    'Discontinuous glyph strokes must not split grid columns');
  assert.deepEqual(structure.evidence.horizontalLinePositions,[40,110,180,250],
    'Full physical horizontal borders must survive filtering');
  const glyphOnly=detectScheduleTableStructureFromRaster({
    width:imageW,height:imageH,luminance:glyphRaster,
  });
  assert.equal(glyphOnly.evidence.source,'WEAK_PIXEL',
    'Text-only glyph strokes must not claim pixel grid authority');
  console.log(JSON.stringify({
    result:'PASS',recoveredRegions:recovered.length,
    pixelSupportedPeriodicity:true,missingBordersRecovered:true,
    continuousBorderGate:true,glyphStrokesExcluded:true,
    noDateValuesInferred:true,emptyRasterRejected:true,
    sparseDateAnchorsMappedToPhysicalColumns:true,
    missingDateValuesNeverInvented:true,
    arbitraryImageCoordinatesUsed:false,liveKakaoRouteCalls:0,
  }));
}finally{await server.close();}
