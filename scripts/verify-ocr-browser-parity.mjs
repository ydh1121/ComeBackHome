import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

const vite = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
let summaries = [];
try {
  await vite.listen();
  const port = vite.httpServer.address()?.port;
  if (typeof port !== 'number') throw new Error('Local OCR test server did not bind');
  const base = 'http://127.0.0.1:' + port;
  for (const [name, engine] of [['CHROMIUM', chromium], ['WEBKIT', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(base + '/tools/ocr-eval/index.html',
        { waitUntil: 'domcontentloaded' });
      const summary = await page.evaluate(async () => {
        const detector = await import('/src/providers/import/ScheduleTableStructureDetector.ts');
        const matrixBuilder = await import('/src/providers/import/ScheduleCellMatrix.ts');
        const width = 980, height = 480;
        const raster = { width, height, luminance: new Uint8Array(width * height).fill(246) };
        const left = 70, top = 48, right = 950, bottom = 445;
        const rows = 5, cols = 8;
        const rh = (bottom - top) / rows, cw = (right - left) / cols;
        function paint(x, y, w, h, v) {
          for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y+h)); yy++) {
            for (let xx = Math.max(0,Math.floor(x)); xx < Math.min(width,Math.ceil(x+w)); xx++)
              raster.luminance[yy*width+xx] = v;
          }
        }
        for (let n=0;n<=rows;n++) paint(left,top+n*rh-1,right-left,2,68);
        for (let n=0;n<=cols;n++) paint(left+n*cw-1,top,2,bottom-top,68);
        const token=(text,cx,cy,w=52,h=16) =>
          ({ text,x:cx-w/2,y:cy-h/2,width:w,height:h,confidence:0.96 });
        const tokens=[];
        for (let n=1;n<cols;n++) {
          const cx=left+(n+0.5)*cw, cy=top+rh*0.3;
          paint(cx-24,cy-4,48,8,40);
          tokens.push(token('2026-10-'+String(n+19).padStart(2,'0'),cx,cy,90,16));
        }
        for(let n=1;n<rows;n++) {
          const cx=left+cw*0.45, cy=top+(n+0.5)*rh;
          paint(cx-24,cy-4,48,8,40);
          tokens.push(token(['가나다','라마바','사아자','차카타'][n-1],cx,cy,58,18));
        }
        paint(left+cw*1.25,top+rh*1.4,50,8,40);
        const structure = detector.detectScheduleTableStructureFromRaster(raster);
        const input = { structure, raster, preprocessingMs:0, structureDetectionMs:0 };
        const logical = matrixBuilder.buildScheduleCellMatrix(input, {
          width,height,tokens,
        });
        if (!logical) throw new Error('Browser logical OCR matrix not built');
        return {
          rows: logical.rows.length,
          dates: logical.dates.map(d=>d.date),
          cells: logical.cells.length,
          occupancy: logical.cells.reduce((s,c) => {
            s[c.visual.occupancy] = (s[c.visual.occupancy] ?? 0)+1;return s;
          }, {}),
          geometrySource: logical.geometrySource,
          structureRows: structure.rowBands.length,
          structureColumns: structure.columnBands.length,
        };
      });
      summaries.push({ browser: name, ...summary });
      await page.close();
    } finally {
      await browser.close();
    }
  }
  const strip = ({ browser, ...values }) => values;
  assert.deepEqual(strip(summaries[0]), strip(summaries[1]),
    'Chromium/WebKit pixel-to-matrix synthetic logic differs');
  assert.ok(summaries[0].rows >= 4 && summaries[0].cells >= 20,
    'Synthetic raster fixture did not reconstruct person/date logical matrix');
  console.log(JSON.stringify({ result: 'PASS', summaries,
    actualImageRecognition: 'NOT_TESTED',
    rawImageStored: false, providerRouteCalls: 0 }));
} finally {
  await vite.close();
}
