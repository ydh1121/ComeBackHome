// Generate a minimal *binary* XLSX in memory. Uses only anonymous synthetic
// schedule cells; does not store or publish the user's private workbook.
export function makeWeeklyXlsx(rows) {
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
