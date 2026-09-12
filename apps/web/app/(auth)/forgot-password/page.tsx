import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Reset your password | Ai Review',
  description: 'Request a link to choose a new password.',
};

export default function Page() {
  return <ForgotPasswordForm />;
}
