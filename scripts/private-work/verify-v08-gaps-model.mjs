import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function verifyV08GapsModel(vite){
  const s=await vite.ssrLoadModule('/src/modules/injury/advisor/scenarios.ts');
  const p=await vite.ssrLoadModule('/src/modules/injury/advisor/model.ts');
  const c=await vite.ssrLoadModule('/src/modules/injury/domain/calculations.ts');
  const {validatePayload}=await vite.ssrLoadModule('/src/modules/injury/domain/records.ts');
  let checks=0;
  const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
  const record=(id,kind,data,certainty='reported')=>({id,caseId:'synthetic-case',kind,payload:{title:'Synthetic '+kind,body:'Synthetic only',certainty,sourceIds:certainty==='official'?['synthetic-original']:[],data},revision:1,updatedBy:'synthetic-actor',updatedAt:'2026-10-28T00:00:00Z',archivedAt:null});
  const empty=()=>({caseId:'synthetic-case',owner:true,actors:[],records:[],policies:[],documents:[],payments:[],deadlines:[],overlaps:[]});
  assert(s.scenario('F').reason.includes('회사의 동의가 없어도 산재를 신청할 수 있어요'));checks++;
  assert(s.scenario('F').reason.includes('실제로 요청한 자료와 기한'));checks++;
  const reply=(data,scenario,answer)=>{
    const value={version:1,scenario,answer,deferred:false,basis:s.responseBasis(data),at:'2026-10-28T00:00:00Z'};
    const r={...record(s.responseId(data.caseId,scenario),'content',{}),payload:s.responsePayload(value)};
    equal(validatePayload('content',r.payload),r.payload,'reply uses the existing content contract');
    data.records.push(r);
    return r;
  };
  // QA11: an examination recommendation must not become a diagnosis or completion.
  const medical=empty();
  const examination=reply(medical,'A','exam'),medicalBefore=structuredClone(medical);
  equal(s.recommend(medical,'2026-10-28')[0].scenario.id,'B');
  equal(examination.payload.certainty,'reported');equal(examination.payload.sourceIds,[]);
  equal(medical.records.filter(r=>r.kind!=='content'),[],'examination reply creates no diagnosis or completed examination record');
  equal(medical,medicalBefore,'medical recommendation preserves all existing case data');

  // QA14: SMS-only results retain the request for the original decision.
  const sms=empty(),profile={...p.emptyProfile(),answers:['decision',null,null],confirmed:true};
  sms.records.push({...record(p.profileId(sms.caseId),'content',{}),payload:p.profilePayload(profile)});
  const smsReply=reply(sms,'G','sms'),smsBefore=structuredClone(sms);
  equal(s.recommend(sms,'2026-10-28')[0].scenario.id,'G');
  equal(s.scenario('G').options.find(([key])=>key==='sms')?.[2],undefined,'SMS does not advance to benefit guidance');
  equal(smsReply.payload.certainty,'reported');equal(smsReply.payload.sourceIds,[]);
  equal(sms.records.filter(r=>['treatment','benefit_claim','intake'].includes(r.kind)),[],'SMS does not create official periods or payment amounts');
  equal(sms.payments,[]);equal(sms,smsBefore);

  // QA16: treatment closure routes only to medical review and never a payment.
  const ended=empty();ended.records.push(record('synthetic-ended','treatment',{status:'ended'},'official'));
  const endedBefore=structuredClone(ended);
  equal(s.recommend(ended,'2026-10-28')[0].scenario.id,'L');
  equal(ended,endedBefore);equal(ended.payments,[]);
  const endedReply=reply(ended,'L','review'),afterReply=structuredClone(ended);
  equal(s.recommend(ended,'2026-10-28')[0].scenario.id,'L');
  equal(endedReply.payload.certainty,'reported');equal(ended.records.some(r=>r.kind==='benefit_claim'||r.kind==='disability'),false);
  equal(ended,afterReply,'assessment request creates no disability decision');

  // QA18: moving the simulation end date excludes older verified paid days.
  const policy=JSON.parse(await readFile('docs/private-work/policies/2026-confirmed.json','utf8')).policies.find(p=>p.key==='insurance_window');
  c.requirePolicy(policy,'insurance_window','2026-10-12',['months','requiredDays','maxMonths']);
  const window={months:policy.values.months,requiredDays:policy.values.requiredDays,maxMonths:policy.values.maxMonths};
  const previous=['2025-04-11','2025-04-12','2025-04-13'].map(date=>({date,employmentId:'synthetic-previous',type:'paid_work',verification:'documented',sourceId:'synthetic-original'}));
  equal(c.insuredDays(previous,'2026-10-10',window).documentedDays,3);
  const input={previous,hireDate:'2026-10-10',paidWeekdays:[0,1,2,3,4,5,6],unpaidDates:[],extraPaidDates:[],weeklyHolidayVerified:true};
  const early=c.simulateEmployment({...input,leaveDate:'2026-10-11'},window),later=c.simulateEmployment({...input,leaveDate:'2026-10-12'},window);
  equal([early.documentedDays,early.previousDaysExpired,early.estimatedDays],[2,1,2]);
  equal([later.documentedDays,later.previousDaysExpired,later.estimatedDays],[1,2,3]);
  equal(later.eligibilityConfirmed,false);equal(later.firstExpectedDate,null);

  // QA07: all actual answers retain their identity; their follow-up must differ.
  const branchResults=[];
  for(const answer of ['allowed','refused','waiting']){
    const data=empty(),profile={...p.emptyProfile(),answers:[null,'working','restriction'],confirmed:true};
    data.records.push({...record(p.profileId(data.caseId),'content',{}),payload:p.profilePayload(profile)});
    const saved=reply(data,'C',answer),before=structuredClone(data),advice=s.recommend(data,'2026-10-28')[0];
    equal(s.currentResponse(data,'C').answer,answer);
    equal(saved.payload.certainty,'reported');equal(saved.payload.sourceIds,[]);
    equal(data,before,'company answer does not establish resignation or benefit eligibility');
    const guidance=s.scenario('C').replyGuidance?.[answer];
    assert(guidance?.title&&guidance?.body,'QA07 each saved answer has direct follow-up guidance');checks++;
    branchResults.push({answer,scenario:advice.scenario.id,title:guidance.title,body:guidance.body});
  }
  equal(branchResults[2].scenario,'C','no reply stays a company follow-up, never refusal');
  equal(new Set(branchResults.map(r=>r.title)).size,3,'each company answer has a distinct next-action title');
  equal(new Set(branchResults.map(r=>r.body)).size,3,'each company answer has distinct follow-up instructions');
  console.log('PRIVATE_V08_GAPS_MODEL_PASS checks='+checks+' company_branches_exam_sms_closure_no_decisions_paid_window_exit');
}
