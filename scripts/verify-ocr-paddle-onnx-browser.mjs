import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

// The official ONNX and dictionary are downloaded by CI into ignored
// temporary public/ paths, not checked into Git or loaded on application boot.
const root=fileURLToPath(new URL('../',import.meta.url));
const model=path.join(root,'public/ocr-paddle-probe/inference.onnx');
const dict=path.join(root,'public/ocr-paddle-probe/dict.json');
const wasm=path.join(root,'public/ort/ort-wasm-simd-threaded.wasm');
for(const p of [model,dict,wasm])assert.ok(fs.existsSync(p),'Missing: '+p);
const size={onnxBytes:fs.statSync(model).size,dictBytes:fs.statSync(dict).size,
            runtimeWasmBytes:fs.statSync(wasm).size};
assert.ok(size.onnxBytes<=25*1024*1024,'Cloudflare Pages 25MiB per-file cap');
assert.ok(size.runtimeWasmBytes<=25*1024*1024,'Cloudflare Pages WASM asset cap');
const web=await createServer({root,logLevel:'error',server:{host:'127.0.0.1',port:0}});
const browsers=[['CHROMIUM',chromium],['WEBKIT',webkit]];
const results=[];
try{
 await web.listen();
 const port=web.httpServer.address()?.port;
 for(const [label,engine] of browsers){
   const browser=await engine.launch({headless:true});
   try{
     const page=await browser.newPage({serviceWorkers:'block'});
     const errors=[];
     page.on('pageerror',e=>errors.push(e.message.slice(0,300)));
     page.setDefaultTimeout(120000);
     await page.goto('http://127.0.0.1:'+port+'/tools/ocr-eval/index.html',
       {waitUntil:'domcontentloaded'});
     const started=Date.now();
     try{
       const metrics=await page.evaluate(async()=>{
         const {runPaddleBrowserProbe}=await import(
           '/tools/ocr-eval/paddle-onnx-browser-entry.js');
         return await runPaddleBrowserProbe();
       });
       results.push({browser:label,...metrics,totalMs:Date.now()-started,
         pageErrors:errors});
     }catch(e){
       results.push({browser:label,error:String(e).slice(0,1000),
         totalMs:Date.now()-started,pageErrors:errors});
     }
   }finally{await browser.close()}
 }
}finally{await web.close()}
const report={source:'PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx',
  input:'GENERATED_ORACLE_CROPS_NO_USER_IMAGE',
  cloudflarePageAssetLimitBytes:25*1024*1024,size,
  pipeline:'NOT_EVALUABLE',iPhonePhysical:'NOT_EVALUABLE',results};
console.log('CBH_OFFICIAL_ONNX_BROWSER_REPORT='+JSON.stringify(report));
if(results.length!==2||results.some(x=>x.error||x.pageErrors?.length))
 throw Error('ONNX browser CPU WASM execution failed in Chromium and/or WebKit');
const misses=results.flatMap(x=>x.samples.filter(y=>!y.exact));
if(misses.length)
 throw Error('Browser glyph exact-match misses: '+misses.length+
  '; NOT ADOPTABLE without evidence');
console.log('CBH_ONNX_ORACLE_ONLY_NO_PRODUCTION_MERGE');
