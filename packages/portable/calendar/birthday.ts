import KoreanLunarCalendar from 'korean-lunar-calendar';
export interface Birthday { calendar: 'solar' | 'lunar'; month: number; day: number; leapMonth: boolean; }
const iso = (year:number,month:number,day:number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

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

