// Synthetic request contracts only; no private roster or OCR answer corpus.
export function weeklyPayload(requestId='weekly-contract-test-001',name='합성검토직원') {
  return {
    requestId,approved:true,source:'WEEKLY_IMAGE',weekStart:'2026-10-12',datesConfirmed:true,
    people:[{ref:'new',kind:'PENDING_NEW',name}],
    schedules:Array.from({length:7},(_,dayIndex)=>({
      personRef:'new',date:'2026-10-'+(12+dayIndex),dayIndex,breakReviewRequired:false,
      resolution:'NEW',approved:true,enabled:dayIndex<6,explicitOff:dayIndex===6,
      start:dayIndex<6?'09:00':null,end:dayIndex<6?'18:00':null,
      breakMinutes:dayIndex<6?30:null,existing:null,
    })),
  };
}
export function invalidWeeklyPayloads() {
  const cases=[
    ['UNAPPROVED',p=>{p.approved=false;},'IMPORT_NOT_APPROVED'],
    ['UNCONFIRMED_DATES',p=>{p.datesConfirmed=false;},'WEEKLY_DATES_NOT_CONFIRMED'],
    ['NON_MONDAY',p=>{p.weekStart='2026-10-13';},'WEEK_START_MUST_BE_MONDAY'],
    ['WRONG_DAY_OWNERSHIP',p=>{p.schedules[0].dayIndex=1;},'UNCONFIRMED_WEEKLY_DAY'],
    ['MISSING_DAY',p=>{p.schedules.pop();},'INCOMPLETE_WEEKLY_REVIEW'],
    ['UNREVIEWED_ROW',p=>{p.schedules[0].approved=false;},'IMPORT_UNREVIEWED_SCHEDULE'],
    ['UNCONFIRMED_OFF',p=>{p.schedules[6].explicitOff=false;},'IMPORT_OFF_NOT_APPROVED'],
    ['INVALID_CLOCK',p=>{p.schedules[0].start='99:77';},'INVALID_IMPORT_CLOCK'],
    ['UNREADABLE_BREAK',p=>{p.schedules[0].breakReviewRequired=true;p.schedules[0].breakMinutes=null;},'UNREVIEWED_BREAK_MINUTES'],
    ['DUPLICATE_DAY',p=>{p.schedules[1]={...p.schedules[0]};},'DUPLICATE_PERSON_DATE'],
  ];
  return cases.map(([name,mutate,error],index)=>{
    const payload=weeklyPayload('weekly-negative-'+index);
    mutate(payload);
    return {name,payload,error};
  });
}
