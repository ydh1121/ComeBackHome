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
  let last=-1,text='',confidences=[];
  for(let t=0;t<time;t++){
    let best=-Infinity,index=-1;
    for(let c=0;c<classes;c++){
      const score=Number(data[t*classes+c]);
      if(score>best){best=score;index=c;}
    }
    if(index!==0&&index!==last){
      text+=alphabet[index-1];
      confidences.push(best);
    }
    last=index;
  }
  return {text,rawScores:confidences};
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
