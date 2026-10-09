import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const publicDir=path.join(root,'public');
const probe=path.join(publicDir,'ocr-paddle-probe');
const destination=path.join(publicDir,'ocr','weekly');
const wasm=path.join(publicDir,'ort');
const OFFICIAL_HASH='92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08';
const digest=b=>createHash('sha256').update(b).digest('hex');
// Never fetch a user image or call an external OCR endpoint. Staging happens
// exclusively from the CI-downloaded, official, SHA-pinned model artifacts.
const model=await readFile(path.join(probe,'inference.onnx'));
const alphabet=JSON.parse(await readFile(path.join(probe,'dict.json'),'utf8'));
if(digest(model)!==OFFICIAL_HASH)throw Error('WEEKLY_PADDLE_MODEL_INTEGRITY_MISMATCH');
if(!Array.isArray(alphabet)||alphabet.length!==11946||
   !alphabet.includes('강')||!alphabet.includes('0'))throw Error('WEEKLY_PADDLE_DICTIONARY_INVALID');
if(model.byteLength>25*1024*1024)throw Error('CLOUDFLARE_ASSET_SIZE_LIMIT');
const runtimeFiles=(await readdir(wasm)).filter(n=>/^ort-wasm-[a-z0-9.-]+\.(mjs|wasm)$/.test(n));
if(!runtimeFiles.includes('ort-wasm-simd-threaded.wasm')||!runtimeFiles.some(x=>x.endsWith('.mjs')))
  throw Error('WEEKLY_PADDLE_WASM_RUNTIME_MISSING');
await mkdir(destination,{recursive:true});
await copyFile(path.join(probe,'inference.onnx'),path.join(destination,'inference.onnx'));
await copyFile(path.join(probe,'dict.json'),path.join(destination,'dict.json'));
const assets=[
  {url:'/ocr/weekly/inference.onnx',sha256:OFFICIAL_HASH,bytes:model.byteLength},
  {url:'/ocr/weekly/dict.json',sha256:digest(await readFile(path.join(destination,'dict.json'))),
   bytes:(await stat(path.join(destination,'dict.json'))).size},
];
for(const name of runtimeFiles){
  const data=await readFile(path.join(wasm,name));
  if(data.length>25*1024*1024)throw Error('CLOUDFLARE_WASM_SIZE_LIMIT');
  assets.push({url:'/ort/'+name,sha256:digest(data),bytes:data.length});
}
const manifest={kind:'COMEBACKHOME_OFFICIAL_KOREAN_PP_OCRV5_WEEKLY',version:1,
  modelSha256:OFFICIAL_HASH,onnxRuntimeWeb:'1.23.2',sameOrigin:true,assets};
await writeFile(path.join(destination,'integrity.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('CBH_WEEKLY_SAME_ORIGIN_ASSETS='+JSON.stringify({
  modelSha256:OFFICIAL_HASH,assetCount:assets.length,totalBytes:assets.reduce((n,x)=>n+x.bytes,0),
  modelUrl:assets[0].url,dictionaryUrl:assets[1].url,wasmBase:'/ort/',remoteD1Writes:0,
}));
