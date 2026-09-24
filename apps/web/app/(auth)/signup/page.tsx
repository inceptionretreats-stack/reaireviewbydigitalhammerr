import type { Metadata } from 'next';
import { SignupForm } from '@/components/auth/SignupForm';

export const metadata: Metadata = {
  title: 'Create your account | Ai Review',
  description: 'Set up your business and create a branded QR code.',
};

export default function Page() {
  return <SignupForm googleClientId={process.env.GOOGLE_CLIENT_ID?.trim() || null} />;
}
