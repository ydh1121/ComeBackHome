import assert from 'node:assert/strict';
export async function verifyContentModel(vite){
  const m=await vite.ssrLoadModule('/src/modules/injury/content/model.ts');
  let checks=0;const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const guide={kind:'content',payload:m.guidancePayload('Synthetic guide','Synthetic public guidance')};
  const seed={version:'cbh-case-seed/v1',records:[guide]};
  const prepared=await m.preparePlanning(seed);
  check(prepared[0].group,'personal');
  check(await m.preparePlanning(seed),prepared);
  const untouched=structuredClone(prepared);
  const safe=m.planningSeed(prepared,[]);
  check(safe.records[0].kind,'content');check(safe.records[0].payload.certainty,'reported');check(safe.records[0].payload.sourceIds,[]);
  const record={id:'synthetic-review',caseId:'synthetic-case',kind:'content',payload:safe.records[0].payload,revision:1,updatedBy:'synthetic-actor',updatedAt:'2026-10-28',archivedAt:null};
  const review=m.readPersonalReview(record);check(review.answer,'pending');check(review.original,guide);
  check(m.personalAnswer(record,'same','').certainty,'reported');
  check(JSON.parse(m.personalAnswer(record,'unknown','').body).answer,'unknown');
  check(JSON.parse(m.personalAnswer(record,'different','Synthetic correction').body).original,guide);
  check(m.planningSeed(prepared,[record]).records,[]);
  check(m.planningSeed(prepared,[{...record,payload:m.personalAnswer(record,'different','Synthetic correction')}]).records,[]);
  check(m.planningSeed(prepared,[{...record,archivedAt:'2026-10-28'}]).records,[]);
  check(prepared,untouched);
  for(const [answer,note] of [['pending',''],['different',''],['same','x'.repeat(20001)]]){assert.throws(()=>m.personalAnswer(record,answer,note));checks++;}
  check(m.readPersonalReview({...record,payload:{...record.payload,body:'invalid'}}),null);
  check(m.readPersonalReview({...record,archivedAt:'2026-10-28'}),null);
  const groups=[{...prepared[0],group:'guide'}];
  const general=m.planningSeed(groups,[]);check(general.records[0].payload.body,guide.payload.body);check(general.records[0].payload.certainty,'reported');
  check(m.planningSeed(groups,[{...record,payload:guide.payload}]).records,[]);
  check(m.planningSeed([{...prepared[0],group:'hold'}],[]).records,[]);
  const manifest={version:'cbh-planning-preparation/v1',sourceSha256:'a'.repeat(64),records:[{...guide,group:'guide'}]};
  check((await m.preparePlanning(manifest))[0].group,'guide');
  for(const patch of [{sourceSha256:'not-sha'},{records:[{...guide,group:'auto'}]},{records:[{...guide,group:'guide',payload:{...guide.payload,certainty:'official',sourceIds:['synthetic-doc']}}]}]){await assert.rejects(()=>m.preparePlanning({...manifest,...patch}));checks++;}
  const official={...guide,payload:{...guide.payload,certainty:'official',sourceIds:['synthetic-doc']}};
  check((await m.preparePlanning({version:'cbh-case-seed/v1',records:[official]}))[0].group,'hold');
  const normal={...record,id:m.guidanceId(record.caseId,'A-reason'),payload:m.guidancePayload('Synthetic modified title','Edited guidance')};
  check(m.guidanceText([],record.caseId,'A-reason','Fallback'),'Fallback');
  check(m.guidanceText([normal],record.caseId,'A-reason','Fallback'),'Edited guidance');
  check(m.guidanceText([{...normal,archivedAt:'2026-10-28'}],record.caseId,'A-reason','Fallback'),'Fallback');
  console.log('PRIVATE_CONTENT_MODEL_PASS checks='+checks+' explicit_classification_personal_review_reported_only_original_preservation_idempotent_guidance');
}
