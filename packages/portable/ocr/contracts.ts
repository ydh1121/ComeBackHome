export interface PreparedImageRaster {
  image: File | Blob;
  sourceWidth: number;
  sourceHeight: number;
  rasterWidth: number;
  rasterHeight: number;
}
export interface ImageRasterPreprocessor { prepare(file: File): Promise<PreparedImageRaster>; }
