export function decodeCtc(output, alphabet) {
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
    let rawSum=0,allUnit=true;
    for(let c=0;c<classes;c++){
      const value=Number(data[offset+c]);
      rawSum+=value;
      if(value<0||value>1)allUnit=false;
    }
    // Official PP-OCRv5 ONNX often emits probabilities, not logits.
    // Applying softmax to a probability vector collapses near-certain
    // classes to ~1/11947 and invalidates confidence gating.
    let probability=0;
    if(allUnit&&Math.abs(rawSum-1)<.02){
      probability=Math.max(0,Math.min(1,best));
    }else{
      let sum=0;
      for(let c=0;c<classes;c++)sum+=Math.exp(Number(data[offset+c])-best);
      probability=sum>0?1/sum:0;
    }
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

