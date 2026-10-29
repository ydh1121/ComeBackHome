import { Icon, type IconName } from '../../../shared/components/Icon';
import { RECORD_SPECS } from '../domain/records';
import { isProfile } from '../advisor/model';
import type { CaseData } from '../ui/types';
export const managementSections = [
  {id:'tasks', title:'준비할 일', description:'기한, 회사에 요청한 내용, 구직활동', icon:'check'},
  {id:'claim', title:'신청·치료', description:'산재 진행 상황과 진료·요양 기록', icon:'calendar'},
  {id:'employment', title:'일한 곳·근무 기간', description:'직장 이력과 고용보험 일수 확인', icon:'people'},
  {id:'payments', title:'받을 돈·받은 돈', description:'청구·결정·입금 내역을 구분해서 확인', icon:'file'},
  {id:'documents', title:'자료·메모', description:'서류와 메모를 모아 분석 요청 준비', icon:'edit'},
] as const;
export type ManagementSection = (typeof managementSections)[number]['id'];
export function ManageHome({data,choose}:{data:CaseData;choose:(id:ManagementSection|'settings')=>void}) {
  return <section className="management-home" aria-label="내 관리함 목록">
    <div className="materials-heading"><div><h2>내 관리함</h2></div></div>
    <div className="management-list">{managementSections.map(s=>{
      const count=data.records.filter(r=>!r.archivedAt&&!isProfile(r)&&RECORD_SPECS[r.kind].group===s.id).length+(s.id==='documents'?data.documents.filter(d=>d.status!=='trashed').length:0);
      return <button key={s.id} className="management-row" onClick={()=>choose(s.id)}><span className="material-icon"><Icon name={s.icon as IconName}/></span><span><strong>{s.title}</strong><small>{s.description}</small></span><span className="management-count">{count}</span><Icon name="chevron-right"/></button>;
    })}</div>
    <button className="management-settings secondary" onClick={()=>choose('settings')}><Icon name="settings"/>자료 접근권한·수정 이력<Icon name="chevron-right"/></button>
  </section>;
}
