import type { Birthday } from '../../domain/birthday';

export function PersonProfileFields({phone,birthday,onPhone,onBirthday}: {
  phone:string; birthday:Birthday|null; onPhone(value:string):void; onBirthday(value:Birthday|null):void;
}) {
  const next = (patch:Partial<Birthday>) => onBirthday({...birthday!,...patch});
  const max = birthday?.calendar==='lunar' ? 30 : new Date(Date.UTC(2000,birthday?.month??1,0)).getUTCDate();
  return <>
    <label className="form-field"><span className="form-label">연락처</span><input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event=>onPhone(event.target.value)} placeholder="010-0000-0000" /></label>
    <div className="form-field"><div className="birthday-field-head"><span className="form-label">생일</span><button type="button" className="text-btn" onClick={()=>onBirthday(birthday?null:{calendar:'solar',month:1,day:1,leapMonth:false})}>{birthday?'삭제':'생일 추가'}</button></div>
    {birthday ? <><div className="birthday-inputs">
      <select aria-label="생일 달력" value={birthday.calendar} onChange={event=>next({calendar:event.target.value as Birthday['calendar'],leapMonth:false,day:Math.min(birthday.day,event.target.value==='solar'?new Date(Date.UTC(2000,birthday.month,0)).getUTCDate():30)})}><option value="solar">양력</option><option value="lunar">음력</option></select>
      <select aria-label="생일 월" value={birthday.month} onChange={event=>next({month:Number(event.target.value),day:Math.min(birthday.day,birthday.calendar==='solar'?new Date(Date.UTC(2000,Number(event.target.value),0)).getUTCDate():30)})}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}월</option>)}</select>
      <select aria-label="생일 일" value={birthday.day} onChange={event=>next({day:Number(event.target.value)})}>{Array.from({length:max},(_,i)=><option key={i+1} value={i+1}>{i+1}일</option>)}</select>
    </div>{birthday.calendar==='lunar'?<><label className="birthday-leap"><input type="checkbox" checked={birthday.leapMonth} onChange={event=>next({leapMonth:event.target.checked})}/>윤달</label><small className="form-hint">윤달이 없는 해에는 평달, 30일이 없는 달에는 29일로 알려드려요.</small></>:birthday.month===2&&birthday.day===29?<small className="form-hint">윤년이 아니면 2월 28일에 알려드려요.</small>:null}</>:null}
    </div>
  </>;
}
