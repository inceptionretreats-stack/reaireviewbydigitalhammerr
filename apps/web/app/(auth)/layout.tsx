import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shell for the four unauthenticated screens (AUTH-01, AUTH-02, AUTH-03, and the reset screen
 * the pack never specifies — see OPEN-03).
 *
 * A route group rather than a path segment, so the URLs stay /login and /signup as the screen
 * spec writes them while still sharing this chrome.
 *
 * Deliberately narrow and centred: each of these screens has exactly one task, and the business
 * dashboard's sidebar would be navigation to places the visitor cannot yet reach.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-lg items-center px-5 py-4">
          <Link
            href="/"
            className="rounded text-base font-semibold tracking-tight text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            AI Review <span className="font-normal text-ink-muted">by Digital Hammerr</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10">
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto w-full max-w-lg px-5 py-4 text-xs text-ink-faint">
          An AI writing assistant for genuine customer feedback.
        </div>
      </footer>
    </div>
  );
}
