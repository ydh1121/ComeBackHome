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
// Vite's development transform refuses to import JS modules under public/.
 // Serve the official ORT runtime via pre-transform middleware with exact
 // same-origin MIME handling; this is a CI-only static asset route.
const web=await createServer({
 root,logLevel:'error',server:{host:'127.0.0.1',port:0},
 plugins:[{
   name:'cbh-ocr-ort-runtime-assets',
   enforce:'pre',
   configureServer(server){
     server.middlewares.use((request,response,next)=>{
       const url=new URL(request.url??'/', 'http://127.0.0.1');
       if(!url.pathname.startsWith('/ort/'))return next();
       const basename=url.pathname.slice('/ort/'.length);
       if(!/^ort-wasm-[a-z0-9.-]+\.(?:mjs|wasm)$/.test(basename)){
         response.statusCode=404;response.end();return;
       }
       const asset=path.join(root,'public/ort',basename);
       if(!fs.existsSync(asset)){response.statusCode=404;response.end();return;}
       response.setHeader('Content-Type',
         basename.endsWith('.mjs')?'text/javascript':'application/wasm');
       response.setHeader('Cache-Control','no-store');
       response.end(fs.readFileSync(asset));
     });
   },
 }],
});
const browsers=[['CHROMIUM',chromium],['WEBKIT',webkit]];
const results=[];
try{
 await web.listen();
 const port=web.httpServer.address()?.port;
 for(const [label,engine] of browsers){
   const launchedAt=Date.now();
   const browser=await engine.launch({headless:true});
   const state={phase:'LAUNCHED',pageCrashed:false,disconnected:false};
   browser.on('disconnected',()=>{
     state.disconnected=true;
     console.log('CBH_ONNX_BROWSER_DISCONNECTED='+JSON.stringify({
       browser:label,phase:state.phase,elapsedMs:Date.now()-launchedAt,
     }));
   });
   try{
     const page=await browser.newPage({serviceWorkers:'block'});
     const errors=[];
     page.on('pageerror',e=>errors.push(e.message.slice(0,300)));
     page.on('crash',()=>{
       state.pageCrashed=true;
       console.log('CBH_ONNX_BROWSER_PAGE_CRASH='+JSON.stringify({
         browser:label,phase:state.phase,elapsedMs:Date.now()-launchedAt,
       }));
     });
     page.setDefaultTimeout(120000);
     await page.goto('http://127.0.0.1:'+port+'/tools/ocr-eval/index.html',
       {waitUntil:'domcontentloaded'});
     const started=Date.now();
     state.phase='MODEL_LOADING_AND_INFERENCE';
     console.log('CBH_ONNX_BROWSER_START='+JSON.stringify({browser:label}));
     try{
       const metrics=await page.evaluate(async()=>{
         const {runPaddleBrowserProbe}=await import(
           '/tools/ocr-eval/paddle-onnx-browser-entry.js');
         return await runPaddleBrowserProbe();
       });
       state.phase='COMPLETE';
       results.push({browser:label,...metrics,totalMs:Date.now()-started,
         pageErrors:errors,lifecycle:{
           pageCrashed:state.pageCrashed,
           disconnectedBeforeCompletion:state.disconnected,
         }});
     }catch(e){
       state.phase='FAILED';
       results.push({browser:label,error:String(e).slice(0,1000),
         totalMs:Date.now()-started,pageErrors:errors,
         lifecycle:{
           pageCrashed:state.pageCrashed,
           disconnectedBeforeCompletion:state.disconnected,
         }});
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
console.log('CBH_ONNX_ORACLE_EXACT_MISSES='+misses.length);
console.log('CBH_ONNX_ORACLE_ONLY_NO_PRODUCTION_MERGE');
// Accuracy misses are evidence, not runtime crashes. Do not stop the later
// detected-crop/matrix comparison; the final quality gate decides adoption.
