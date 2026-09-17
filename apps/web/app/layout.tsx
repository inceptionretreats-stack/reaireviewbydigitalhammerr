import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const siteFont = localFont({
  src: '../assets/fonts/dm-sans-variable.ttf',
  variable: '--font-dm-sans',
  weight: '100 1000',
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Ai Review by Digital Hammerr',
  description: 'Write your review with a little help, then post it yourself on Google.',
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={siteFont.variable}>
      <body>{children}</body>
    </html>
  );
}
