import KoreanLunarCalendar from 'korean-lunar-calendar';

export interface Birthday { calendar: 'solar' | 'lunar'; month: number; day: number; leapMonth: boolean; }
export const BIRTHDAY_REMINDER_DAYS = [7,3,1,0] as const;
const iso = (year:number,month:number,day:number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

export function parseBirthday(value: unknown): Birthday | null {
  if (value == null) return null;
  if (typeof value !== 'object') throw new Error('생일을 확인해 주세요.');
  const b = value as Record<string,unknown>;
  if (!['solar','lunar'].includes(String(b.calendar)) || !Number.isInteger(b.month) || !Number.isInteger(b.day) ||
      Number(b.month)<1 || Number(b.month)>12 || Number(b.day)<1 || typeof b.leapMonth!=='boolean') throw new Error('생일을 확인해 주세요.');
  const max = b.calendar==='lunar' ? 30 : new Date(Date.UTC(2000,Number(b.month),0)).getUTCDate();
  if (Number(b.day)>max || (b.calendar==='solar' && b.leapMonth)) throw new Error('생일 날짜를 확인해 주세요.');
  return {calendar:b.calendar as Birthday['calendar'],month:Number(b.month),day:Number(b.day),leapMonth:b.leapMonth};
}

export function parsePhone(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[+\d\s()-]+$/.test(value)) throw new Error('연락처를 확인해 주세요.');
  const phone=value.replace(/[\s()-]/g,'');
  if (!/^\+?\d{7,15}$/.test(phone)) throw new Error('연락처를 확인해 주세요.');
  return phone;
}

export function parseBirthdayDays(value:unknown): number[] {
  if (!Array.isArray(value) || value.length>4 || value.some(day=>![7,3,1,0].includes(day))) throw new Error('생일 알림 설정을 확인해 주세요.');
  return [...new Set(value as number[])].sort((a,b)=>b-a);
}

/** A fresh converter prevents reading the previous successful date on failure. */
export function lunarDate(year:number,month:number,day:number,leap=false): string | null {
  const calendar = new KoreanLunarCalendar();
  if (!calendar.setLunarDate(year,month,day,leap)) return null;
  const value=calendar.getSolarCalendar();
  return iso(value.year,value.month,value.day);
}

export function birthdayInYear(birthday:Birthday,year:number):string|null {
  if (birthday.calendar==='solar') return iso(year,birthday.month,Math.min(birthday.day,new Date(Date.UTC(year,birthday.month,0)).getUTCDate()));
  // Missing leap month -> ordinary month. Missing day 30 -> last day 29.
  const leap = birthday.leapMonth && lunarDate(year,birthday.month,1,true)!==null;
  return lunarDate(year,birthday.month,birthday.day,leap) ??
    (birthday.day===30 ? lunarDate(year,birthday.month,29,leap) : null);
}

export function nextBirthday(birthday:Birthday|null|undefined,today:string): {date:string;days:number}|null {
  if (!birthday) return null;
  const year=Number(today.slice(0,4));
  const dates=[year-1,year,year+1].map(y=>birthdayInYear(birthday,y)).filter((d):d is string=>!!d&&d>=today).sort();
  const date=dates[0];
  return date ? {date,days:Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000)} : null;
}

export function birthdayLabel(birthday:Birthday):string {
  return `${birthday.calendar==='lunar' ? (birthday.leapMonth?'음력 윤':'음력 ') : '양력 '}${birthday.month}월 ${birthday.day}일`;
}
