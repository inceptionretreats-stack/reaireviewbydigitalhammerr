import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Review by Digital Hammerr',
  description: 'Write your review with a little help, then post it yourself on Google.',
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
