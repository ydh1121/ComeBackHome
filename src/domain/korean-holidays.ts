import { lunarDate } from './birthday';

// Rules and 2026/2027 dates cross-checked against KASI/KASA calendar notices.
// Keep one-off government-designated dates here; never infer a day off from
// an unregistered work schedule. See docs/daily-life-acceptance.md for sources.
const special:Record<string,string>={
  '2024-04-10':'국회의원선거','2024-10-01':'임시공휴일',
  '2025-01-27':'임시공휴일','2025-06-03':'대통령선거','2026-06-03':'전국동시지방선거',
};
const cache=new Map<number,Map<string,string>>();
const addDays=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=(date:string)=>new Date(date+'T00:00:00Z').getUTCDay();

function holidays(year:number):Map<string,string> {
  if(cache.has(year))return cache.get(year)!;
  const map=new Map<string,string>();
  const groups:Array<{dates:string[];name:string;sub:'weekend'|'sunday'|null}>=[];
  const put=(dates:string[],name:string,sub:'weekend'|'sunday'|null=null)=>{
    for(const date of dates)map.set(date,map.has(date)?map.get(date)+' · '+name:name);
    groups.push({dates,name,sub});
  };
  const fixed=(md:string,name:string,sub=false)=>put([`${year}-${md}`],name,sub?'weekend':null);
  fixed('01-01','새해');fixed('03-01','삼일절',year>=2021);
  if(year>=2026)fixed('05-01','노동절',true);
  fixed('05-05','어린이날',year>=2014);fixed('06-06','현충일');
  if(year<=2007||year>=2026)fixed('07-17','제헌절',year>=2026);
  fixed('08-15','광복절',year>=2021);fixed('10-03','개천절',year>=2021);
  if(year>=2013)fixed('10-09','한글날',year>=2021);
  fixed('12-25','성탄절',year>=2023);
  for(const [month,day,name] of [[1,1,'설날'],[8,15,'추석']] as const){
    const date=lunarDate(year,month,day);
    if(date)put([addDays(date,-1),date,addDays(date,1)],name,year>=2014?'sunday':null);
  }
  const buddha=lunarDate(year,4,8);
  if(buddha)put([buddha],'부처님오신날',year>=2023?'weekend':null);
  for(const [date,name] of Object.entries(special))if(date.startsWith(year+'-'))put([date],name);
  const substitutes=new Map<string,string>();
  for(const group of groups){
    if(!group.sub)continue;
    const collision=group.dates.some(date=>groups.some(other=>other!==group&&other.dates.includes(date)));
    const weekend=group.dates.some(date=>weekday(date)===0||(group.sub==='weekend'&&weekday(date)===6));
    if(collision||weekend)substitutes.set(group.dates.at(-1)!,group.name);
  }
  for(const [last,name] of [...substitutes].sort(([a],[b])=>a.localeCompare(b))){
    let date=addDays(last,1);
    while([0,6].includes(weekday(date))||map.has(date))date=addDays(date,1);
    map.set(date,`대체공휴일 (${name})`);
  }
  if(cache.size>=8)cache.delete(cache.keys().next().value!);
  cache.set(year,map);return map;
}
export function holidayName(date:string):string|null { return holidays(Number(date.slice(0,4))).get(date)??null; }
export function calendarDayClass(date:string):string {
  return holidayName(date)||weekday(date)===0?'day-holiday':weekday(date)===6?'day-saturday':'';
}
