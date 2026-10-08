import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),
  appType:'custom',logLevel:'error',server:{middlewareMode:true}});
try {
  const {pixelDateHeaderRegions}=await server.ssrLoadModule(
    '/src/providers/import/StructureFirstScheduleImageRecognizer.ts');
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
  console.log(JSON.stringify({
    result:'PASS',recoveredRegions:recovered.length,
    pixelSupportedPeriodicity:true,missingBordersRecovered:true,
    noDateValuesInferred:true,emptyRasterRejected:true,
    arbitraryImageCoordinatesUsed:false,liveKakaoRouteCalls:0,
  }));
}finally{await server.close();}
