import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { AccountPage, useAuth } from '../modules/auth/AuthRoot';

const InjuryApp = lazy(() => import('../modules/injury/ui/InjuryApp').then(module => ({ default: module.InjuryApp })));
const HouseholdApp = lazy(() => import('../modules/household/ui/HouseholdApp').then(module => ({ default: module.HouseholdApp })));

function PrivateRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.enabled) return <Navigate to="/" replace />;
  // AuthRoot handles login and mandatory first-password change. Keep a second
  // render boundary here so private modules never mount outside that session.
  if (!auth.user || auth.user.mustChangePassword) return null;
  return children;
}
export function InjuryRoute() {
  return <PrivateRoute><Suspense fallback={<p className="auth-loading" role="status">산재 자료를 여는 중…</p>}><InjuryApp /></Suspense></PrivateRoute>;
}
export function HouseholdRoute() {
  return <PrivateRoute><Suspense fallback={<p className="auth-loading" role="status">생활비와 할 일을 여는 중…</p>}><HouseholdApp /></Suspense></PrivateRoute>;
}
export function AccountRoute() {
  return <PrivateRoute><AccountPage /></PrivateRoute>;
}
