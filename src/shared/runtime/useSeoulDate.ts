import { useEffect, useState } from 'react';
import { seoulDate } from '../../domain/product-time';

export function useSeoulDate(): string {
  const [date, setDate] = useState(() => seoulDate());
  useEffect(() => {
    const refresh = () => setDate(seoulDate());
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return date;
}
