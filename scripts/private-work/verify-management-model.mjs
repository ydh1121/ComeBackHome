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
  console.log('PRIVATE_MANAGEMENT_MODEL_PASS checks=11');
}
