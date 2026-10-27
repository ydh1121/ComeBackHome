// Shared by the model gate and browser flow: validate these explicit synthetic
// input fields before a browser waits on a UI preview.
export function specialistAnalysisFixture(label,source) {
  return {version:'cbh-analysis/v2',suggestions:[
    {type:'record',kind:'exposure',title:'Synthetic exposure draft '+label,body:'Synthetic work and symptom note',sourceIds:[source],data:{date:'2026-10-28',measurement:'estimated',diagnosisStatus:'confirmed'}},
    {type:'record',kind:'paid_day',title:'Synthetic linked paid day '+label,body:'Synthetic unconfirmed paid day',sourceIds:[source],data:{employmentId:'@job',date:'2026-01-05',dayType:'paid_work',verification:'documented'}},
    {type:'record',kind:'employment',ref:'job',title:'Synthetic employment draft '+label,body:'Synthetic employment detail',sourceIds:[source],data:{employerName:'Synthetic workplace',hireDate:'2026-01-02',employmentType:'regular',actualOrSimulated:'actual',wageType:'monthly'}},
  ]};
}
