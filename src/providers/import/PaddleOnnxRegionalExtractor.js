import { decodeCtc } from '../../../packages/portable/ocr/ctc.js';
import { preprocessBitmapRegion } from '../../../packages/portable/ocr/paddle-raster.js';
import * as ort from 'onnxruntime-web/wasm';
import { parseScheduleImageClock } from './StructuredTableImageScheduleRecognizer.ts';

// Browser-only isolated candidate benchmark; NOT production wiring.
const MODEL_URL = '/ocr-paddle-probe/inference.onnx';
const DICT_URL = '/ocr-paddle-probe/dict.json';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = '/ort/';

async function preprocess(text) {
  await document.fonts.load('bold 25px "Nanum Gothic"');
  const source=document.createElement('canvas');
  source.width=Math.max(150,text.length*25+44);
  source.height=54;
  const ctx=source.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('Canvas unavailable');
  ctx.fillStyle='white';ctx.fillRect(0,0,source.width,source.height);
  ctx.fillStyle='#121212';ctx.font='bold 25px "Nanum Gothic"';
  ctx.fillText(text,15,35);
  const sw=Math.min(320,Math.ceil(source.width*48/source.height));
  const canvas=document.createElement('canvas');
  canvas.width=320;canvas.height=48;
  const view=canvas.getContext('2d',{willReadFrequently:true});
  if(!view)throw Error('Canvas resize unavailable');
  // Paddle RecResizeImg: aspect-preserving resize, right padding is zero
  // in normalized tensor space; BGR channel order and [-1,1] normalization.
  view.drawImage(source,0,0,source.width,source.height,0,0,sw,48);
  const rgba=view.getImageData(0,0,sw,48).data;
  const chw=new Float32Array(3*48*320);
  for(let y=0;y<48;y++)for(let x=0;x<sw;x++){
    const k=(y*sw+x)*4;
    for(let c=0;c<3;c++)chw[c*48*320+y*320+x]=(rgba[k+(2-c)]/255-.5)/.5;
  }
  return new ort.Tensor('float32',chw,[1,3,48,320]);
}

// Tested Korean PP-OCRv5 ONNX. Never accept an unverified replacement model.
const VERIFIED_MODEL_SHA256='92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08';
async function sha256Hex(bytes){
  if(!globalThis.crypto?.subtle)throw Error('WEEKLY_PADDLE_WEBCRYPTO_REQUIRED');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function checkModelHash(bytes){
  if((await sha256Hex(bytes))!==VERIFIED_MODEL_SHA256)
    throw Error('WEEKLY_PADDLE_MODEL_INTEGRITY_MISMATCH');
}
async function verifyProductAssetIntegrity(manifestUrl,model,dictionaryBytes){
  const response=await fetch(assertSameOriginAsset(manifestUrl),{
    credentials:'same-origin',redirect:'error',
  });
  if(!response.ok)throw Error('WEEKLY_PADDLE_INTEGRITY_MANIFEST_MISSING');
  const manifest=await response.json();
  if(manifest.kind!=='COMEBACKHOME_OFFICIAL_KOREAN_PP_OCRV5_WEEKLY'||
     manifest.onnxRuntimeWeb!=='1.23.2'||
     manifest.modelSha256!==VERIFIED_MODEL_SHA256||
     !Array.isArray(manifest.assets))
    throw Error('WEEKLY_PADDLE_INVALID_ASSET_MANIFEST');
  const declared=(url)=>manifest.assets.find(item=>item.url===url)?.sha256;
  if(declared('/ocr/weekly/inference.onnx')!==VERIFIED_MODEL_SHA256||
     declared('/ocr/weekly/dict.json')!==(await sha256Hex(dictionaryBytes)))
    throw Error('WEEKLY_PADDLE_DICTIONARY_INTEGRITY_MISMATCH');
  const wasmUrl='/ort/ort-wasm-simd-threaded.wasm';
  const wasmHash=declared(wasmUrl);
  if(!/^[0-9a-f]{64}$/.test(wasmHash??''))
    throw Error('WEEKLY_PADDLE_WASM_MANIFEST_MISSING');
  const wasm=await fetch(assertSameOriginAsset(wasmUrl),{
    credentials:'same-origin',redirect:'error',
  });
  if(!wasm.ok||await sha256Hex(await wasm.arrayBuffer())!==wasmHash)
    throw Error('WEEKLY_PADDLE_WASM_INTEGRITY_MISMATCH');
}
function assertSameOriginAsset(url){
  if(typeof url!=='string'||!url.startsWith('/')||url.startsWith('//')||
    url.includes('..')||url.includes('?')||url.includes('#'))
    throw Error('WEEKLY_PADDLE_ASSET_PATH_INVALID');
  const resolved=new URL(url,location.origin);
  if(resolved.origin!==location.origin)throw Error('WEEKLY_PADDLE_CROSS_ORIGIN_FORBIDDEN');
  return resolved.href;
}
export async function createPaddleDetectedRegionRecognizer(options={}){
  const modelUrl=assertSameOriginAsset(options.modelUrl??MODEL_URL);
  const dictionaryUrl=assertSameOriginAsset(options.dictionaryUrl??DICT_URL);
  const wasmBase=options.wasmBase??'/ort/';
  assertSameOriginAsset(wasmBase);
  ort.env.wasm.wasmPaths=wasmBase;
  const fetchStarted=performance.now();
  const [modelResponse,dictResponse]=await Promise.all([
    fetch(modelUrl,{credentials:'same-origin',redirect:'error'}),
    fetch(dictionaryUrl,{credentials:'same-origin',redirect:'error'}),
  ]);
  if(!modelResponse.ok||!dictResponse.ok)throw Error('Missing pinned official ONNX or dictionary');
  const [model,dictionaryBytes]=await Promise.all([
    modelResponse.arrayBuffer(),dictResponse.arrayBuffer(),
  ]);
  const alphabet=JSON.parse(new TextDecoder().decode(dictionaryBytes));
  await checkModelHash(model);
  if(options.manifestUrl){
    await verifyProductAssetIntegrity(options.manifestUrl,model,dictionaryBytes);
  }
  if(!Array.isArray(alphabet)||alphabet.length!==11946||
     !alphabet.includes('강')||!alphabet.includes('0'))
    throw Error('WEEKLY_PADDLE_DICTIONARY_INVALID');
  const downloadMs=Math.round(performance.now()-fetchStarted);
  const initStarted=performance.now();
  const session=await ort.InferenceSession.create(model,{
    executionProviders:['wasm'],graphOptimizationLevel:'all',
  });
  const modelInitMs=Math.round(performance.now()-initStarted);
  const inputKey=session.inputNames[0],outputKey=session.outputNames[0];

  const infer=async(bitmap,region,mode='DEFAULT')=>{
    const tensor=preprocessBitmapRegion(bitmap,region,mode);
    const started=performance.now();
    const output=await session.run({[inputKey]:tensor});
    const inferenceMs=Math.round(performance.now()-started);
    const decoded=decodeCtc(output[outputKey],alphabet);
    return {...decoded,inferenceMs,mode};
  };

  return {
    metadata:{
      backend:'wasm',threads:1,modelBytes:model.byteLength,
      dictionaryCharacters:alphabet.length,downloadMs,modelInitMs,
    },
    async recognizeRegions(file,regions){
      const bitmap=await createImageBitmap(file);
      const results=[];
      let inferenceMs=0;
      try{
        for(const region of regions){
          if(region.purpose==='cell'&&!region.id.startsWith('weekly::')){
            const half=Math.max(1,region.height/2);
            const top=await infer(bitmap,{...region,height:half});
            const bottom=await infer(bitmap,{...region,y:region.y+half,height:region.height-half});
            inferenceMs+=top.inferenceMs+bottom.inferenceMs;
            const pieces=[top,bottom].filter(x=>x.text.trim().length>0);
            const tokens=pieces.map((item,index)=>({
              text:item.text.trim(),
              x:region.x+region.width*0.08,
              y:region.y+(index===0?0.08:0.53)*region.height,
              width:region.width*0.84,
              height:region.height*0.39,
              confidence:item.confidence,
            }));
            results.push({
              id:region.id,purpose:region.purpose,
              text:tokens.map(x=>x.text).join(' '),tokens,
              confidence:tokens.length?Math.min(...tokens.map(x=>x.confidence)):0,
            });
          }else{
            let item=await infer(bitmap,region);
            inferenceMs+=item.inferenceMs;
            const initialText=item.text.trim();
            const isClockField=region.id.startsWith('weekly::')&&
              (region.id.endsWith('::start')||region.id.endsWith('::end'));
            let retryEvidence=[];
            if(isClockField&&!parseScheduleImageClock(initialText)){
              const variants=[];
              for(const mode of ['CRISP','PADDED']){
                const next=await infer(bitmap,region,mode);
                inferenceMs+=next.inferenceMs;
                variants.push(next);
                retryEvidence.push({
                  mode,text:next.text.trim(),confidence:next.confidence,
                  parsed:parseScheduleImageClock(next.text.trim()),
                });
              }
              const first=parseScheduleImageClock(variants[0].text.trim());
              const second=parseScheduleImageClock(variants[1].text.trim());
              // Contradicting or low-confidence retry results MUST stay
              // REVIEW_REQUIRED, never infer missing first digits by context.
              if(first&&first===second&&
                 variants.every(v=>v.confidence>=.70)){
                item=variants[0].confidence>=variants[1].confidence
                  ?variants[0]:variants[1];
              }
            }
            const text=item.text.trim();
            const token=text?{
              text,x:region.x+region.width*0.04,y:region.y+region.height*0.08,
              width:region.width*0.92,height:region.height*0.84,
              confidence:item.confidence,
            }:null;
            results.push({
              id:region.id,purpose:region.purpose,text,
              tokens:token?[token]:[],confidence:item.confidence,
              ...(retryEvidence.length?{
                initialText,
                retryEvidence,
                selectedMode:item.mode,
              }:{}),
            });
          }
        }
      }finally{bitmap.close();}
      return {results,inferenceMs};
    },
    async release(){await session.release();},
  };
}

export async function runPaddleBrowserProbe(){
  const start=performance.now();
  const [modelResponse,dictResponse]=await Promise.all([
    fetch(MODEL_URL),fetch(DICT_URL),
  ]);
  if(!modelResponse.ok||!dictResponse.ok)throw Error('Missing pinned official ONNX or dictionary');
  const [model,alphabet]=await Promise.all([
    modelResponse.arrayBuffer(),dictResponse.json(),
  ]);
  if(!Array.isArray(alphabet)||!alphabet.length)throw Error('Empty Korean CTC dictionary');
  const downloadMs=Math.round(performance.now()-start);
  const initStart=performance.now();
  const session=await ort.InferenceSession.create(model,{
    executionProviders:['wasm'],graphOptimizationLevel:'all',
  });
  const modelInitMs=Math.round(performance.now()-initStart);
  const key=session.inputNames[0],outputKey=session.outputNames[0];
  const samples=['강하현','정지윤','1일','15일','09:00','18:00'];
  const results=[];
  try {
    for(const expected of samples){
      const tensor=await preprocess(expected);
      const firstStart=performance.now();
      const first=await session.run({[key]:tensor});
      const firstMs=Math.round(performance.now()-firstStart);
      const secondStart=performance.now();
      const second=await session.run({[key]:tensor});
      const secondMs=Math.round(performance.now()-secondStart);
      const result=decodeCtc(second[outputKey],alphabet);
      results.push({expected,observed:result.text,
        exact:expected===result.text,firstMs,secondMs,
        shape:second[outputKey].dims});
    }
  } finally {
    await session.release();
  }
  return {backend:'wasm',threads:1,modelBytes:model.byteLength,
    dictionaryCharacters:alphabet.length,downloadMs,modelInitMs,
    peakMemoryBytes:performance.memory?.usedJSHeapSize??null,
    peakMemorySource:performance.memory?'JS_HEAP_NOT_PROCESS_RSS':'NOT_EVALUABLE',
    samples:results};
}
