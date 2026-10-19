export type IconName = 'home' | 'calendar' | 'upload' | 'people' | 'settings' | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'check' | 'map' | 'bus' | 'train' | 'edit' | 'walk' | 'plus' | 'search' | 'grip' | 'phone';

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  const common = { className: ['svg', className].filter(Boolean).join(' '), viewBox: '0 0 24 24', 'aria-hidden': true } as const;

  switch (name) {
    case 'phone':
      return <svg {...common}><path d="M6 3h3l2 5-2.5 2a16 16 0 0 0 5.5 5.5l2-2.5 5 2v3a3 3 0 0 1-3.4 3A19 19 0 0 1 3 6.4 3 3 0 0 1 6 3Z"/></svg>;
    case 'home':
      return <svg {...common}><path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></svg>;
    case 'calendar':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>;
    case 'upload':
      return <svg {...common}><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v7h14v-7"/></svg>;
    case 'people':
      return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.6-4 2.4-6 5.5-6s4.9 2 5.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M15 15c3.2-.2 5.1 1.5 5.5 4.5"/></svg>;
    case 'settings':
      return <svg {...common}><path d="M4 6h4m4 0h8M4 12h9m4 0h3M4 18h2m4 0h10"/><circle cx="10" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></svg>;
    case 'chevron-left':
      return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
    case 'chevron-right':
      return <svg {...common}><path d="m9 5 7 7-7 7"/></svg>;
    case 'chevron-down':
      return <svg {...common}><path d="m5 9 7 7 7-7"/></svg>;
    case 'check':
      return <svg {...common}><path d="m5 12 4 4 10-10"/></svg>;
    case 'map':
      return <svg {...common}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>;
    case 'bus':
      return <svg {...common}><rect x="5" y="3" width="14" height="16" rx="2"/><path d="M5 11h14M12 6v5M8 6h8M3 7v4M21 7v4M8 19v2M16 19v2"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/></svg>;
    case 'train':
      return <svg {...common}><rect x="5" y="2" width="14" height="16" rx="5"/><rect x="8" y="6" width="8" height="5" rx="1"/><path d="M8 14h.01M16 14h.01M9 18l-3 4M15 18l3 4M8 20h8"/></svg>;
    case 'edit':
      return <svg {...common}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>;
    case 'walk':
      return <svg {...common}><circle cx="14" cy="3.5" r="1.75"/><path d="m7 12 3-4 3 1 3 4 4 1M13 9l-2 6 4 3 1 4M11 15l-3 6-3 1"/></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>;
    case 'grip':
      return <svg {...common}><path d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01"/></svg>;
  }
}
