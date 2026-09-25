import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in | Ai Review',
  description: 'Manage your review page, QR codes and analytics.',
};

export default function Page() {
  return <LoginForm googleClientId={process.env.GOOGLE_CLIENT_ID?.trim() || null} />;
}
