import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Icon, type IconName } from '../components/Icon';

const items: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: '오늘', icon: 'home' },
  { to: '/schedule', label: '일정', icon: 'calendar' },
  { to: '/import', label: '가져오기', icon: 'upload' },
  { to: '/people', label: '사람', icon: 'people' },
];

export function BottomNavigation() {
  const location = useLocation();
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const bar = nav.current;
    const chip = pill.current;
    if (!bar || !chip) return;
    const measure = (animate: boolean) => {
      const selected = bar.querySelector<HTMLElement>('.active');
      if (!selected) { chip.style.opacity = '0'; previous.current = null; return; }
      const x = selected.offsetLeft, width = selected.offsetWidth;
      const current = new DOMMatrixReadOnly(getComputedStyle(chip).transform).m41;
      running.current?.cancel();
      chip.style.transition = 'none';
      chip.style.width = width + 'px';
      chip.style.transform = `translateX(${x}px)`;
      chip.style.opacity = '1';
      if (animate && previous.current !== null && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const distance = x - current;
        const bounce = Math.sign(distance) * Math.min(12, Math.abs(distance) * .08);
        running.current = chip.animate([
          { transform: `translateX(${current}px) scaleX(1)`, offset: 0, easing: 'cubic-bezier(.45,0,.65,1)' },
          { transform: `translateX(${x+bounce}px) scaleX(1.04)`, offset: .66, easing: 'ease-out' },
          { transform: `translateX(${x-bounce*.28}px) scaleX(.99)`, offset: .85, easing: 'ease-out' },
          { transform: `translateX(${x}px) scaleX(1)`, offset: 1 },
        ], { duration: Math.min(580, 360+Math.abs(distance)*.5), fill: 'none' });
      }
      previous.current = x;
    };
    measure(true);
    let lastWidth = bar.clientWidth;
    const observer = new ResizeObserver(() => {
      if (lastWidth === bar.clientWidth) return;
      lastWidth = bar.clientWidth;
      measure(false);
    });
    observer.observe(bar);
    return () => { observer.disconnect(); };
  }, [location.pathname]);
  return <nav ref={nav} className="bottomnav t-tabs" data-component="BottomNavigation" aria-label="주요 탐색"><span ref={pill} className="t-tabs-pill" aria-hidden="true" />{items.map((item) => <NavLink key={item.to} to={item.to} end={item.to==='/'} className={({ isActive }: { isActive: boolean }) => `nav-btn t-tab${isActive ? ' active' : ''}`}><Icon name={item.icon} /><span>{item.label}</span></NavLink>)}</nav>;
}
