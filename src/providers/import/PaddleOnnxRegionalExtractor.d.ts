import type { ImageTextProbeRegion, ImageTextProbeResult } from '../../application/contracts/providers';
export interface PaddleRegionResult {
  metadata: {backend:string;threads:number;modelBytes:number;dictionaryCharacters:number;downloadMs:number;modelInitMs:number};
  recognizeRegions(file:File,regions:ImageTextProbeRegion[]):Promise<{results:ImageTextProbeResult[];inferenceMs:number}>;
  release():Promise<void>;
}
export function createPaddleDetectedRegionRecognizer(options?:{
  modelUrl?:string;dictionaryUrl?:string;wasmBase?:string;
}):Promise<PaddleRegionResult>;
export function runPaddleBrowserProbe():Promise<unknown>;
