import * as ort from 'onnxruntime-web/wasm';

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

function decodeCtc(output, alphabet) {
  const shape=output.dims;
  if(shape.length!==3||shape[0]!==1)throw Error('Unexpected ONNX tensor shape: '+shape);
  const time=shape[1],classes=shape[2],data=output.data;
  if(classes!==alphabet.length+1)throw Error(
    'CTC alphabet mismatch: '+classes+' outputs vs '+alphabet.length+' characters');
  let last=-1,text='',confidences=[],rawScores=[];
  for(let t=0;t<time;t++){
    let best=-Infinity,index=-1;
    const offset=t*classes;
    for(let c=0;c<classes;c++){
      const score=Number(data[offset+c]);
      if(score>best){best=score;index=c;}
    }
    let sum=0;
    for(let c=0;c<classes;c++)sum+=Math.exp(Number(data[offset+c])-best);
    const probability=sum>0?1/sum:0;
    if(index!==0&&index!==last){
      text+=alphabet[index-1];
      confidences.push(probability);
      rawScores.push(best);
    }
    last=index;
  }
  const confidence=confidences.length
    ? confidences.reduce((a,b)=>a+b,0)/confidences.length : 0;
  return {text,confidence,rawScores};
}

function clampRegion(region, width, height) {
  const x=Math.max(0,Math.min(width-1,Math.floor(region.x)));
  const y=Math.max(0,Math.min(height-1,Math.floor(region.y)));
  const right=Math.max(x+1,Math.min(width,Math.ceil(region.x+region.width)));
  const bottom=Math.max(y+1,Math.min(height,Math.ceil(region.y+region.height)));
  return {x,y,width:right-x,height:bottom-y};
}

function preprocessBitmapRegion(bitmap, region) {
  const safe=clampRegion(region,bitmap.width,bitmap.height);
  const ratio=safe.width/Math.max(1,safe.height);
  const resizedWidth=Math.max(1,Math.min(320,Math.ceil(48*ratio)));
  const canvas=document.createElement('canvas');
  canvas.width=320;canvas.height=48;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
  if(!ctx)throw Error('Paddle region canvas unavailable');
  ctx.fillStyle='black';ctx.fillRect(0,0,320,48);
  ctx.drawImage(bitmap,safe.x,safe.y,safe.width,safe.height,0,0,resizedWidth,48);
  const rgba=ctx.getImageData(0,0,resizedWidth,48).data;
  const chw=new Float32Array(3*48*320);
  for(let y=0;y<48;y++)for(let x=0;x<resizedWidth;x++){
    const k=(y*resizedWidth+x)*4;
    for(let channel=0;channel<3;channel++){
      chw[channel*48*320+y*320+x]=(rgba[k+(2-channel)]/255-.5)/.5;
    }
  }
  return new ort.Tensor('float32',chw,[1,3,48,320]);
}

export async function createPaddleDetectedRegionRecognizer(){
  const fetchStarted=performance.now();
  const [modelResponse,dictResponse]=await Promise.all([
    fetch(MODEL_URL),fetch(DICT_URL),
  ]);
  if(!modelResponse.ok||!dictResponse.ok)throw Error('Missing pinned official ONNX or dictionary');
  const [model,alphabet]=await Promise.all([
    modelResponse.arrayBuffer(),dictResponse.json(),
  ]);
  if(!Array.isArray(alphabet)||!alphabet.length)throw Error('Empty Korean CTC dictionary');
  const downloadMs=Math.round(performance.now()-fetchStarted);
  const initStarted=performance.now();
  const session=await ort.InferenceSession.create(model,{
    executionProviders:['wasm'],graphOptimizationLevel:'all',
  });
  const modelInitMs=Math.round(performance.now()-initStarted);
  const inputKey=session.inputNames[0],outputKey=session.outputNames[0];

  const infer=async(bitmap,region)=>{
    const tensor=preprocessBitmapRegion(bitmap,region);
    const started=performance.now();
    const output=await session.run({[inputKey]:tensor});
    const inferenceMs=Math.round(performance.now()-started);
    const decoded=decodeCtc(output[outputKey],alphabet);
    return {...decoded,inferenceMs};
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
            const item=await infer(bitmap,region);
            inferenceMs+=item.inferenceMs;
            const text=item.text.trim();
            const token=text?{
              text,x:region.x+region.width*0.04,y:region.y+region.height*0.08,
              width:region.width*0.92,height:region.height*0.84,
              confidence:item.confidence,
            }:null;
            results.push({
              id:region.id,purpose:region.purpose,text,
              tokens:token?[token]:[],confidence:item.confidence,
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
