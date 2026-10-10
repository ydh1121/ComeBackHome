import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { SAMPLE_IMPORT_WORKBOOK_BASE64 } from '../test/fixtures/import/sample-workbook-base64.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

function workbookArrayBuffer() {
  const bytes = Buffer.from(SAMPLE_IMPORT_WORKBOOK_BASE64, 'base64');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}


// Generate a minimal *binary* XLSX in memory. Uses only anonymous synthetic
// schedule cells; does not store or publish the user's private workbook.
function makeWeeklyXlsx(rows) {
  const escapeXml = value => String(value).replace(/&/g,'&amp;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const colName = index => {
    let i=index+1,s='';
    while(i){i--;s=String.fromCharCode(65+i%26)+s;i=Math.floor(i/26);}
    return s;
  };
  const rendered = rows.map((row,r)=>{
    const cells = row.map((value,c)=>{
      if(value==null||value==='')return '';
      const ref=colName(c)+(r+1);
      return typeof value==='number'
        ? '<c r="'+ref+'"><v>'+value+'</v></c>'
        : '<c r="'+ref+'" t="inlineStr"><is><t>'+
            escapeXml(value)+'</t></is></c>';
    }).join('');
    return '<row r="'+(r+1)+'">'+cells+'</row>';
  }).join('');
  const merges=Array.from({length:7},(_,day)=>{
    const start=1+day*3;
    return '<mergeCell ref="'+colName(start)+'1:'+
      colName(start+2)+'1"/>';
  }).join('');
  const sheetXml='<?xml version="1.0" encoding="UTF-8"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<dimension ref="A1:V'+rows.length+'"/><sheetData>'+rendered+
    '</sheetData><mergeCells count="7">'+merges+'</mergeCells></worksheet>';
  const files=[
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
      '</Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '+
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<sheets><sheet name="SyntheticWeekly" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml',sheetXml],
  ];
  const crc32 = bytes => {
    let crc=0xffffffff;
    for(const b of bytes){
      crc ^= b;
      for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return (crc^0xffffffff)>>>0;
  };
  const local=[], central=[];
  let offset=0;
  for(const [name,xml] of files){
    const filename=Buffer.from(name), data=Buffer.from(xml);
    const crc=crc32(data);
    const lh=Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0);
    lh.writeUInt16LE(20,4);
    lh.writeUInt32LE(crc,14);
    lh.writeUInt32LE(data.length,18);
    lh.writeUInt32LE(data.length,22);
    lh.writeUInt16LE(filename.length,26);
    local.push(lh,filename,data);
    const ch=Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0);
    ch.writeUInt16LE(20,4);
    ch.writeUInt16LE(20,6);
    ch.writeUInt32LE(crc,16);
    ch.writeUInt32LE(data.length,20);
    ch.writeUInt32LE(data.length,24);
    ch.writeUInt16LE(filename.length,28);
    ch.writeUInt32LE(offset,42);
    central.push(ch,filename);
    offset+=lh.length+filename.length+data.length;
  }
  const centralBytes=Buffer.concat(central);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(files.length,8);
  end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(centralBytes.length,12);
  end.writeUInt32LE(offset,16);
  const zip=Buffer.concat([...local,centralBytes,end]);
  return zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const parserModule = await vite.ssrLoadModule('/src/providers/import/ReadExcelWorkbookParser.ts');
  const serviceModule = await vite.ssrLoadModule('/src/application/services/WorkbookImportFileSelectionAction.ts');
  const commitModule = await vite.ssrLoadModule('/src/application/use-cases/commitImportReview.ts');
  const reposModule = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

  const parser = new parserModule.ReadExcelWorkbookParser();
  const parsed = await parser.parse(workbookArrayBuffer());

  expect(parsed.structure.sheet === '근무표', 'actual XLSX sheet name mismatch');
  expect(parsed.structure.headerRow === 1, 'actual XLSX header row mismatch');
  expect(parsed.structure.personColumn === 'A', 'actual XLSX person column mismatch');
  expect(parsed.structure.dateColumn === 'B', 'actual XLSX date column mismatch');
  expect(parsed.structure.shiftColumn === 'C:D', 'actual XLSX shift columns mismatch');
  expect(parsed.detectedPeople.length === 1, 'actual XLSX detected-person count mismatch');
  expect(parsed.detectedPeople[0]?.sourceName === '여자친구', 'actual XLSX detected person mismatch');
  expect(parsed.scheduleCandidates.length === 2, 'actual XLSX schedule candidate count mismatch');
  expect(parsed.scheduleCandidates[0]?.date === '2099-01-04', 'actual XLSX first date mismatch');
  expect(parsed.scheduleCandidates[0]?.start === '09:00', 'actual XLSX first start mismatch');
  expect(parsed.scheduleCandidates[0]?.end === '18:00', 'actual XLSX first end mismatch');
  expect(parsed.scheduleCandidates[1]?.start === '10:30', 'actual XLSX second start mismatch');
  expect(parsed.scheduleCandidates[1]?.end === '19:30', 'actual XLSX second end mismatch');

  const combined = parserModule.parseWorkbookSheets([{
    sheet: '교대',
    data: [
      ['성명', '근무일', '근무시간'],
      ['여자친구', '2099-01-06', '09:00~18:00'],
      ['김하나', '2099-01-07', '오전 10:30-오후 7:30'],
    ],
  }]);
  expect(combined.detectedPeople.length === 2, 'combined-shift multi-person detection mismatch');
  expect(combined.scheduleCandidates.length === 2, 'combined-shift candidate count mismatch');
  expect(combined.structure.shiftColumn === 'C', 'combined-shift column mapping mismatch');
  expect(combined.scheduleCandidates[1]?.start === '10:30', 'Korean AM start parsing mismatch');
  expect(combined.scheduleCandidates[1]?.end === '19:30', 'Korean PM end parsing mismatch');


  // Independent anonymous 7x3 weekly matrix: seven consecutive days across a year
  // boundary, merged-heading anchor layout, reordered staff and uncertain blanks.
  const monday = Date.UTC(2026, 11, 28);
  const dayDates = Array.from({length:7}, (_,i)=>
    new Date(monday+i*86400000).toISOString().slice(0,10));
  const weekdayRow = ['12월', ...Array.from({length:21},(_,i)=>
    i%3===0 ? '요일'+(Math.floor(i/3)+1) : null)];
  const dateRow = [null, ...Array.from({length:21},(_,i)=>
    i%3===0 ? dayDates[Math.floor(i/3)] : null)];
  const memoRow = [null, ...Array.from({length:21},(_,i)=>
    i===6 ? '특이사항 예시' : null)];
  const tripleRow = ['직원', ...Array.from({length:21},(_,i)=>
    ['출근','퇴근','쉬는시간'][i%3])];
  const firstStaff = ['테스트가', ...Array(21).fill(null)];
  firstStaff.splice(1,3,9.5,23.5,0.5);
  firstStaff.splice(4,3,12,21,1);
  firstStaff.splice(7,3,10,20,2);
  const secondStaff = ['테스트나', ...Array(21).fill(null)];
  secondStaff.splice(1,3,14,23.5,'잘못된 휴게');
  secondStaff.splice(7,3,9.5,null,null);
  const weeklyFixture = [{
    sheet:'2026-12-28_01-03',
    data:[weekdayRow,dateRow,memoRow,tripleRow,firstStaff,secondStaff],
  }];
  const weekly = parserModule.parseWorkbookSheets(weeklyFixture);
  expect(weekly.structure.needsReview===true,'weekly XLSX must require review');
  expect(weekly.structure.headerRow===4 && weekly.structure.shiftColumn==='B:V',
    'variable weekly 7x3 header mapping mismatch');
  expect(weekly.scheduleCandidates.length===0 && weekly.reviewCandidates?.length===14,
    'weekly XLSX must preserve every day as a review candidate');
  expect(weekly.detectedPeople.length===2,'weekly roster detection mismatch');
  const work=weekly.reviewCandidates?.find(x=>x.sourcePersonName==='테스트가'&&x.date==='2026-12-28');
  expect(work?.start==='09:30'&&work.end==='23:30'&&work.breakMinutes===30&&
    work.recognitionState==null,'numeric 23.5 / 0.5 conversion mismatch');
  const oneHour=weekly.reviewCandidates?.find(x=>x.sourcePersonName==='테스트가'&&x.date==='2026-12-29');
  const twoHours=weekly.reviewCandidates?.find(x=>x.sourcePersonName==='테스트가'&&x.date==='2026-12-30');
  expect(oneHour?.breakMinutes===60&&twoHours?.breakMinutes===120,
    'hour-based rest conversion mismatch');
  const offCandidate=weekly.reviewCandidates?.find(x=>x.sourcePersonName==='테스트가'&&x.date==='2027-01-01');
  expect(offCandidate?.recognitionState==='OFF_CANDIDATE'&&offCandidate.enabled===true,
    'empty slots must never be committed as OFF automatically');
  expect(weekly.reviewCandidates?.some(x=>x.recognitionState==='INCOMPLETE'&&x.breakMinutes===null),
    'uncertain break/partial schedule should be preserved for review');
  expect(weekly.reviewCandidates?.at(-1)?.date==='2027-01-03',
    'weekly year-boundary date association mismatch');
  let duplicateWeeklyRejected=false;
  try{parserModule.parseWorkbookSheets([weeklyFixture[0],weeklyFixture[0]]);}
  catch(error){duplicateWeeklyRejected=String(error).includes('중복');}
  expect(duplicateWeeklyRejected,'weekly duplicate employee/date must fail closed');
  const invalidDates=structuredClone(weeklyFixture[0]);
  invalidDates.data[1][4]='2026-12-30';
  let conflictRejected=false;
  try{parserModule.parseWorkbookSheets([invalidDates]);}
  catch(error){conflictRejected=String(error).includes('연속된 7일');}
  expect(conflictRejected,'contradictory weekly header dates must fail closed');

  const fromBinary=await parser.parse(makeWeeklyXlsx(weeklyFixture[0].data));
  expect(fromBinary.structure.sheet==='weekly 7 day x start/end/break physical matrix',
    'real synthetic XLSX binary should reach weekly matrix parser');
  expect(fromBinary.reviewCandidates?.length===14 &&
    fromBinary.scheduleCandidates.length===0,
    'real synthetic XLSX binary should preserve 14 review-only cells');
  const fromBinaryTime=fromBinary.reviewCandidates?.find(c=>
    c.sourcePersonName==='테스트가'&&c.date==='2026-12-28');
  expect(fromBinaryTime?.start==='09:30' && fromBinaryTime.end==='23:30' &&
    fromBinaryTime.breakMinutes===30,'real XLSX numeric shifts/break mismatch');
  console.log('NONIMAGE_WEEKLY_XLSX_REAL_BINARY_PASS');

  console.log('NONIMAGE_WEEKLY_XLSX_SYNTHETIC_MATRIX_CASES_PASS');

  const store = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  store.mutate((state) => {
    state.importBatches = [];
  });

  const imports = new reposModule.MockImportRepository(store);
  const people = new reposModule.MockPersonRepository(store);
  const schedules = new reposModule.MockScheduleRepository(store);
  const action = new serviceModule.WorkbookImportFileSelectionAction(
    imports,
    people,
    schedules,
    parser,
  );

  const workbookFile = {
    name: '근무표.xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    arrayBuffer: async () => workbookArrayBuffer(),
  };
  const imageFile = {
    name: '근무표.png',
    type: 'image/png',
    arrayBuffer: async () => new ArrayBuffer(0),
  };

  const batchId = await action.accept([
    { kind: 'WORKBOOK', file: workbookFile },
    { kind: 'IMAGE', file: imageFile },
  ]);
  const batch = await imports.getBatch(batchId);

  expect(batch?.files.length === 2, 'import batch file count mismatch');
  expect(batch?.files[0]?.status === 'READY', 'workbook file status must be READY');
  expect(batch?.files[1]?.status === 'ERROR', 'image file must remain explicit ERROR until recognizer exists');
  expect(batch?.detectedPeople.length === 1, 'parsed batch person count mismatch');
  expect(batch?.detectedPeople[0]?.matchedPersonId === 'mock-person-1', 'exact-name person auto-match failed');
  expect(batch?.reviewItems.length === 2, 'parsed batch review item count mismatch');
  expect(batch?.reviewItems.every((item) => item.personId === 'mock-person-1'), 'review person ownership mismatch');
  expect(batch?.reviewItems.every((item) => item.detectedPersonId === batch.detectedPeople[0]?.id), 'review detected-person linkage mismatch');
  expect(batch?.reviewItems.every((item) => item.resolution === 'NEW'), 'matched newly imported schedules must default selected');

  const commit = new commitModule.CommitImportReview(imports, schedules);
  const detectedId = batch?.detectedPeople[0]?.id;
  if (detectedId) await imports.setDetectedPersonMatch(batchId, detectedId, null);

  let unresolvedBlocked = false;
  try {
    await commit.execute(batchId);
  } catch (error) {
    unresolvedBlocked = error instanceof Error && error.message === 'Import contains unresolved people.';
  }
  expect(unresolvedBlocked, 'unresolved import person must block schedule commit');

  if (detectedId) await imports.setDetectedPersonMatch(batchId, detectedId, 'mock-person-1');
  const rematched = await imports.getBatch(batchId);
  expect(rematched?.reviewItems.every((item) => item.personId === 'mock-person-1'), 'person rematch did not propagate to review items');
  expect(rematched?.reviewItems.every((item) => item.resolution === 'NEW'), 'rematched import rows must default selected');

  const skippedId = rematched?.reviewItems[0]?.id;
  if (skippedId) await imports.setResolution(batchId, skippedId, 'SKIP');
  await commit.execute(batchId);
  const firstSaved = await schedules.getByDate('mock-person-1', '2099-01-04');
  const secondSaved = await schedules.getByDate('mock-person-1', '2099-01-05');
  expect(firstSaved === null, 'unchecked imported schedule must not be committed');
  expect(secondSaved?.start === '10:30' && secondSaved?.end === '19:30', 'second parsed schedule commit mismatch');
  expect((await imports.getBatch(batchId))?.committed === true, 'parsed import batch was not marked committed');

  const nextBatch = await imports.getCurrentBatch();
  expect(nextBatch === null, 'committed import batch must not remain current');

  const resetStore = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  resetStore.mutate((state) => { state.importBatches = []; });
  const resetImports = new reposModule.MockImportRepository(resetStore);
  const resetAction = new serviceModule.WorkbookImportFileSelectionAction(
    resetImports,
    new reposModule.MockPersonRepository(resetStore),
    new reposModule.MockScheduleRepository(resetStore),
    parser,
  );
  const firstResetBatchId = await resetAction.accept([{ kind: 'WORKBOOK', file: workbookFile }]);
  const secondResetBatchId = await resetAction.accept([{ kind: 'WORKBOOK', file: workbookFile }]);
  expect(firstResetBatchId !== secondResetBatchId, 'new upload must create a distinct batch');
  expect(await resetImports.getBatch(firstResetBatchId) === null, 'new upload must remove the previous import batch');
  expect((await resetImports.getCurrentBatch())?.id === secondResetBatchId, 'latest upload must be the only current import batch');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5P real workbook import parser verification passed');
