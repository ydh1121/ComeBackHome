import type { ReactNode } from 'react';
import { BackButton } from './BackButton';

interface SubpageHeaderProps {
  title: ReactNode;
  fallbackTo?: string;
}

export function SubpageHeader({ title, fallbackTo }: SubpageHeaderProps) {
  return <header className="subpage-header" data-component="SubpageHeader"><BackButton fallbackTo={fallbackTo} /><h1 className="page-title">{title}</h1></header>;
}
