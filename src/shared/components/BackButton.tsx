import { useNavigate } from 'react-router';
import { Icon } from './Icon';

interface BackButtonProps {
  fallbackTo?: string;
}

export function BackButton({ fallbackTo = '/' }: BackButtonProps) {
  const navigate = useNavigate();

  const goBack = () => {
    const index = Number(window.history.state?.idx ?? 0);
    if (index > 0) navigate(-1);
    else navigate(fallbackTo, { replace: true });
  };

  return <button type="button" className="back" onClick={goBack} aria-label="뒤로 가기" data-component="BackButton"><Icon name="chevron-left" /></button>;
}
