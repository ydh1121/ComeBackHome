import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vite=await createServer({
  root:fileURLToPath(new URL('../',import.meta.url)),
  appType:'custom',logLevel:'error',server:{middlewareMode:true},
});
try{
  const {TesseractScheduleImageTextExtractor}=await vite.ssrLoadModule(
    '/src/providers/import/TesseractScheduleImageTextExtractor.ts');
  const bounds=(text,x,y)=>({
    text,confidence:99,bbox:{x0:x,y0:y,x1:x+44,y1:y+16},
  });
  const tests=[
    {name:'stacked',words:[bounds('18:00',25,57),bounds('09:00',25,16)]},
    {name:'side-by-side',words:[bounds('18:00',140,24),bounds('09:00',20,25)]},
  ];
  for(const input of tests){
    let disposed=false;
    const mock={
      async create(){return {
        async setParameters(){},
        async recognize(){return {data:{blocks:[{
          paragraphs:[{lines:[{words:input.words}]}],
        }]}};},
        async terminate(){disposed=true;},
      };},
    };
    const preprocessor={async prepare(){return {
      image:new Blob([Uint8Array.of(255)]),
      sourceWidth:400,sourceHeight:120,rasterWidth:400,rasterHeight:120,
    };}};
    const extractor=new TesseractScheduleImageTextExtractor(mock,preprocessor);
    const regions=[{id:'cell::1::2026-10-01',purpose:'cell',
      x:0,y:0,width:300,height:95}];
    const result=await extractor.extractRegions(new Blob([]),regions);
    assert.deepEqual(result[0].tokens.map(token=>token.text),
      ['09:00','18:00'],input.name+' incorrect clock order');
    assert.equal(disposed,true);
  }
  console.log(JSON.stringify({result:'PASS',
    cases:['stacked','side-by-side'],realOcr:false,routeCalls:0}));
}finally{await vite.close();}
