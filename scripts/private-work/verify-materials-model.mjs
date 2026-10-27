import assert from 'node:assert/strict';
export async function verifyMaterialsModel(vite) {
  const m=await vite.ssrLoadModule('/src/modules/injury/materials/model.ts');
  let checks=0;
  const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const invalid=value=>{assert.throws(()=>m.reviewAnalysis(value));checks++;};
  const memo={type:'memo',title:'Synthetic summary',body:'Synthetic source observations',sourceIds:[]};
  const task={type:'task',title:'Synthetic next step',body:'Ask for a missing document',sourceIds:['synthetic-document'],dueDate:'2026-12-31'};
  const input={version:'cbh-analysis/v1',approved:true,suggestions:[memo,task]};
  const reviewed=m.reviewAnalysis(input);
  check(reviewed.result.suggestions,[memo,task]);
  check(Object.hasOwn(reviewed.result,'approved'),false);
  check(reviewed.seed.records.map(r=>r.kind),['content','task']);
  check(reviewed.seed.records.map(r=>r.payload.certainty),['reported','reported']);
  check(reviewed.seed.records[1].payload.data,{status:'todo',deadlineKind:'recommended',dueDate:'2026-12-31'});
  check(reviewed.seed.records[1].payload.sourceIds,['synthetic-document']);
  for(const value of [null,[],{}, {version:'other',suggestions:[memo]}, {...input,suggestions:[]}, {...input,suggestions:Array(41).fill(memo)}])invalid(value);
  for(const bad of [{...memo,type:'decision'},{...memo,certainty:'official'},{...memo,approved:true},{...memo,title:''},{...memo,sourceIds:'x'},{...memo,sourceIds:[4]},{...memo,dueDate:'2026-12-31'},{...task,dueDate:'2026-02-30'},{...task,dueDate:false},{...task,amount:999}])invalid({...input,suggestions:[memo,bad]});
  check(m.memoPayload(' Synthetic memo ','<script>untrusted text</script>').certainty,'reported');
  check(m.memoPayload(' Synthetic memo ','body').title,'Synthetic memo');
  check(m.withinRequestLimit('가'.repeat(70000)),false);
  check(m.withinRequestLimit('가'.repeat(1000)),true);
  const file={name:'synthetic.pdf',type:'application/pdf',size:32};
  check(m.documentError(file),null);
  for(const patch of [{size:0},{size:21*1024*1024},{type:'text/html'},{name:'bad/file.pdf'},{name:'x'.repeat(161)}]){assert(m.documentError({...file,...patch}));checks++;}
  const prompt=m.analysisPrompt([{id:'synthetic-document',filename:'synthetic.pdf',sha256:'synthetic-hash',url:'https://drive.google.com/file/d/synthetic-file/view'}],[{id:'synthetic-note',title:'Synthetic note',body:'Synthetic memo',revision:2}],'Find missing materials');
  for(const text of ['synthetic-document','synthetic-note','"revision": 2','cbh-analysis/v1','직접 수정은 하지 마세요','추정으로 확정하지 마세요']){assert(prompt.includes(text));checks++;}
  assert.throws(()=>m.analysisPrompt([],[],''));checks++;
  console.log('PRIVATE_MATERIALS_MODEL_PASS checks='+checks+' drafts_only_explicit_approval_bounded_input_no_provider_calls');
}
