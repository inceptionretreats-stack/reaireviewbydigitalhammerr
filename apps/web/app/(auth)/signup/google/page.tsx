import type { Metadata } from 'next';
import { GoogleFinishForm } from '@/components/auth/GoogleFinishForm';

export const metadata: Metadata = {
  title: 'Finish signing up with Google | Ai Review',
  description: 'Complete your vendor account and continue to business setup.',
};

export default function Page() {
  return <GoogleFinishForm />;
}
