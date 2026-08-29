import type { ElementType, ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * Surface container for a group of related content.
 *
 * Renders a plain `<div>` by default rather than a `<section>` with a generated
 * `aria-labelledby`. A dashboard screen is a dozen cards; turning each into a named landmark
 * fills the screen-reader rotor with regions that carry no navigational value. Pass
 * `as="section"` when a card genuinely is a landmark.
 *
 * `titleAs` exists because heading level is a document-structure decision the card cannot make:
 * a card inside a page with an `<h1>` needs `h2`, one inside a section needs `h3`.
 */

export interface CardProps {
  title?: ReactNode;
  titleAs?: Extract<ElementType, 'h2' | 'h3' | 'h4'>;
  description?: ReactNode;
  /** Controls aligned with the title — usually one button or a link. */
  actions?: ReactNode;
  footer?: ReactNode;
  as?: Extract<ElementType, 'div' | 'section' | 'article' | 'li'>;
  padded?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Card({
  title,
  titleAs: Heading = 'h2',
  description,
  actions,
  footer,
  as: Root = 'div',
  padded = true,
  className,
  children,
}: CardProps) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;

  return (
    <Root
      className={cx(
        'rounded-card border border-line bg-bg text-ink shadow-sm',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {hasHeader && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title !== undefined && (
              <Heading className="text-base font-semibold text-ink">{title}</Heading>
            )}
            {description !== undefined && (
              <p className="mt-1 text-sm text-ink-muted">{description}</p>
            )}
          </div>
          {actions !== undefined && <div className="flex shrink-0 gap-2">{actions}</div>}
        </div>
      )}

      {children}

      {footer !== undefined && (
        <div className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">{footer}</div>
      )}
    </Root>
  );
}
