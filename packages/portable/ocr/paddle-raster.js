import * as ort from 'onnxruntime-web/wasm';

function clampRegion(region, width, height) {
  const x=Math.max(0,Math.min(width-1,Math.floor(region.x)));
  const y=Math.max(0,Math.min(height-1,Math.floor(region.y)));
  const right=Math.max(x+1,Math.min(width,Math.ceil(region.x+region.width)));
  const bottom=Math.max(y+1,Math.min(height,Math.ceil(region.y+region.height)));
  return {x,y,width:right-x,height:bottom-y};
}

export function preprocessBitmapRegion(bitmap, region, mode='DEFAULT') {
  // Every mode operates strictly INSIDE the SAME detected physical cell.
  // No neighbor/time/weekday/OCR truth may enter a recognition retry.
  const safe=clampRegion(region,bitmap.width,bitmap.height);
  const ratio=safe.width/Math.max(1,safe.height);
  const padding=mode==='DEFAULT'?0:mode==='CRISP'?7:12;
  const resizedWidth=Math.max(1,Math.min(320-padding,Math.ceil(48*ratio)));
  const canvas=document.createElement('canvas');
  canvas.width=320;canvas.height=48;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
  if(!ctx)throw Error('Paddle region canvas unavailable');
  ctx.fillStyle='black';ctx.fillRect(0,0,320,48);
  if(mode!=='DEFAULT'){
    // A white in-image margin separates weak leading digits from
    // a neighboring black table border. Right ONNX padding remains zero.
    ctx.fillStyle='#fff';ctx.fillRect(0,0,padding,48);
  }
  ctx.drawImage(bitmap,safe.x,safe.y,safe.width,safe.height,
    padding,0,resizedWidth,48);
  const span=resizedWidth+padding;
  const rgba=ctx.getImageData(0,0,span,48).data;
  const chw=new Float32Array(3*48*320);
  const contrast=mode==='DEFAULT'?1:mode==='CRISP'?1.55:1.35;
  for(let y=0;y<48;y++)for(let x=0;x<span;x++){
    const k=(y*span+x)*4;
    for(let channel=0;channel<3;channel++){
      const unadjusted=rgba[k+(2-channel)];
      const adjusted=Math.max(0,Math.min(255,(unadjusted-127.5)*contrast+127.5));
      chw[channel*48*320+y*320+x]=(adjusted/255-.5)/.5;
    }
  }
  return new ort.Tensor('float32',chw,[1,3,48,320]);
}

