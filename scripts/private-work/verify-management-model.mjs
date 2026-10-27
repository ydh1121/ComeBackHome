import assert from 'node:assert/strict';

export async function verifyManagementModel(vite){
  const m=await vite.ssrLoadModule('/src/modules/injury/materials/management-ux.ts');
  const p={id:'synthetic',key:'work_injury',version:'test',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',status:'effective',sourceUrl:'https://example.com',checkedAt:'2026-01-01',values:{}};
  assert.equal(m.applicablePolicies([p],'2026-10-24').length,1);
  assert.equal(m.applicablePolicies([p],'2027-01-01').length,0);
  assert.equal(m.applicablePolicies([p,{...p,id:'second'}],'2026-10-24').length,2,'overlapping policies stay ambiguous');
  assert.equal(m.applicablePolicies([{...p,status:'proposed'}],'2026-10-24').length,0);
  assert.equal(m.applicablePolicies([{...p,sourceUrl:'http://example.com'}],'2026-10-24').length,0);
  assert.equal(m.calculationValue('amount',null),'아직 계산할 수 없어요');
  assert.equal(m.calculationValue('amount',280000),'280,000원');
  assert.equal(m.calculationValue('calendarDays',24),'24일');
  assert.equal(m.calculationValue('qualifiesByEnteredFacts',false),'해당하지 않아요');
  assert(!m.calculationError(Error('INVALID_DATE')).includes('INVALID_DATE'));
  assert(!m.calculationError(Error('UNEXPECTED_INTERNAL')).includes('UNEXPECTED_INTERNAL'));
  let checks=11;
  const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const {summarizeLedger}=await vite.ssrLoadModule('/src/modules/injury/domain/calculations.ts');
  const claim={benefitType:'unemployment',dailyRate:100,allocatedDays:100,expectedAmount:null};
  const display=(data,events)=>m.paymentDayDisplay(data,events,summarizeLedger(data,events.map((e,i)=>({id:String(i),eventType:e.event_type,amount:0,recognizedDays:e.recognized_days}))));
  const unknown=[{event_type:'decision',recognized_days:0}],positive=[{event_type:'decision',recognized_days:20}],cancelled=[...positive,{event_type:'decision_adjustment',recognized_days:-20}];
  check(display(claim,[]),{applicable:true,recognizedDays:null,remainingDays:null});
  check(display(claim,unknown),{applicable:true,recognizedDays:null,remainingDays:null});
  check(display(claim,positive),{applicable:true,recognizedDays:20,remainingDays:80});
  check(display(claim,cancelled),{applicable:true,recognizedDays:0,remainingDays:100});
  check(display({...claim,officialRemainingDays:72},unknown),{applicable:true,recognizedDays:null,remainingDays:72});
  check(display(claim,[...positive,...unknown]),{applicable:true,recognizedDays:null,remainingDays:null});
  check(display({...claim,officialRemainingDays:72},[...positive,...unknown]),{applicable:true,recognizedDays:null,remainingDays:72});
  check(display(claim,[{event_type:'deposit',recognized_days:0}]),{applicable:true,recognizedDays:null,remainingDays:null});
  for(const benefitType of ['medical_expense','disability','severance'])check(display({...claim,benefitType},unknown),{applicable:false,recognizedDays:null,remainingDays:null});
  console.log('PRIVATE_MANAGEMENT_MODEL_PASS checks='+checks);
}
