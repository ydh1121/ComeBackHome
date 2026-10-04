export type IconName = 'home' | 'calendar' | 'upload' | 'people' | 'settings' | 'chevron-left';

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  const common = { className: ['svg', className].filter(Boolean).join(' '), viewBox: '0 0 24 24', 'aria-hidden': true } as const;

  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></svg>;
    case 'calendar':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>;
    case 'upload':
      return <svg {...common}><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v7h14v-7"/></svg>;
    case 'people':
      return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.6-4 2.4-6 5.5-6s4.9 2 5.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M15 15c3.2-.2 5.1 1.5 5.5 4.5"/></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.8-1.8.9-1.9-2.2-2.1-1.8 1-1.9-.8L10.5 2h-3l-.7 2.2-1.8.8-1.9-1L1 6.1 2 8l-.8 1.8-2 .7v3l2 .7L2 16l-1 1.9L3.1 20 5 19l1.8.8.7 2.2h3l.7-2.2 1.9-.8 1.8 1 2.2-2.1-1-1.9.8-1.8z" transform="translate(3 -1) scale(.75)"/></svg>;
    case 'chevron-left':
      return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
  }
}
