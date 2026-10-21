import type { Birthday } from '../../packages/portable/calendar/birthday';
export { type Birthday, lunarDate, birthdayInYear, nextBirthday } from '../../packages/portable/calendar/birthday';

export const BIRTHDAY_REMINDER_DAYS = [7,3,1,0] as const;

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

export function birthdayLabel(birthday:Birthday):string {
  return `${birthday.calendar==='lunar' ? (birthday.leapMonth?'음력 윤':'음력 ') : '양력 '}${birthday.month}월 ${birthday.day}일`;
}
