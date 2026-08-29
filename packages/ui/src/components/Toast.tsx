'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx';
import { FOCUS_RING } from '../lib/tokens';

/**
 * Transient confirmations and failures.
 *
 * Three things here are accessibility requirements rather than preferences.
 *
 * 1. Both live regions are rendered at all times, even while empty. A live region is only
 *    announced if assistive technology was already observing it when the content arrived;
 *    mounting the region together with its first message reliably announces nothing.
 *
 * 2. There are two regions, not one. Errors go to an assertive `role="alert"` because they
 *    interrupt what the user is doing; confirmations go to a polite `role="status"` so a "Saved"
 *    does not cut across whatever is being read. A single region has to pick one, and picking
 *    assertive for everything makes the product exhausting to use with a screen reader.
 *
 * 3. Error toasts do not auto-dismiss. The default six seconds is a guess at reading speed that
 *    is wrong for anyone using magnification or a screen reader, and an error the user never
 *    saw is worse than a stale one. They stay until dismissed.
 */

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

export interface ShowToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds, or null to require an explicit dismiss. */
  durationMs?: number | null;
}

export interface ToastApi {
  toasts: readonly ToastMessage[];
  /** Returns the new toast's id so a caller can dismiss it early. */
  show: (options: ShowToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 6000;

export interface ToastProviderProps {
  children: ReactNode;
  defaultDurationMs?: number;
}

export function ToastProvider({
  children,
  defaultDurationMs = DEFAULT_DURATION_MS,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ShowToastOptions): string => {
      const tone = options.tone ?? 'info';
      nextId.current += 1;
      const id = `toast-${nextId.current}`;

      setToasts((current) => [
        ...current,
        { id, title: options.title, description: options.description, tone },
      ]);

      const duration =
        options.durationMs === undefined
          ? tone === 'danger'
            ? null
            : defaultDurationMs
          : options.durationMs;

      if (duration !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [defaultDurationMs, dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToast must be used inside a <ToastProvider>.');
  }
  return api;
}

const TONE_STYLE: Record<ToastTone, string> = {
  info: 'border-line bg-bg text-ink',
  success: 'border-success bg-success-soft text-ink',
  danger: 'border-danger bg-danger-soft text-ink',
};

const TONE_GLYPH: Record<ToastTone, string> = {
  info: '\u2139',
  success: '\u2713',
  danger: '\u2715',
};

/**
 * Rendered by `ToastProvider`; exported for the rare layout that needs to place the regions
 * itself. Rendering it twice would announce every message twice.
 */
export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  const polite = toasts.filter((toast) => toast.tone !== 'danger');
  const assertive = toasts.filter((toast) => toast.tone === 'danger');

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-stretch gap-2 p-4 sm:items-end">
      <div role="status" aria-live="polite" className="flex flex-col gap-2 sm:items-end">
        {polite.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col gap-2 sm:items-end">
        {assertive.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div
      className={cx(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border p-3 shadow-md',
        TONE_STYLE[toast.tone],
      )}
    >
      <span aria-hidden="true" className="text-base leading-6">
        {TONE_GLYPH[toast.tone]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description !== undefined && (
          <p className="mt-0.5 text-sm text-ink-muted">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className={cx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted',
          'hover:bg-surface hover:text-ink',
          FOCUS_RING,
        )}
      >
        <span aria-hidden="true">&times;</span>
        <span className="sr-only">Dismiss: {toast.title}</span>
      </button>
    </div>
  );
}
