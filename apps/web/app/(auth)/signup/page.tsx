import type { Metadata } from 'next';
import { SignupForm } from '@/components/auth/SignupForm';

export const metadata: Metadata = {
  title: 'Create your account | Ai Review',
  description: 'Set up your business and get a QR code in minutes.',
};

export default function Page() {
  return <SignupForm />;
}
