import { useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

export function App(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const [_route, _setRoute] = useState('dashboard');

  if (!user) return <LoginPage />;
  return <DashboardPage />;
}
