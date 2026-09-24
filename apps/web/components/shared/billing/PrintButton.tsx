'use client';

import { Button } from '@ai-review/ui';

/**
 * "Download receipt" on SUB-01 is the browser's own print-to-PDF: the receipt is a page, and
 * every phone and laptop already knows how to save one. No PDF library, no file the server has
 * to keep, and the printed copy is exactly what the owner saw.
 */
export function PrintButton({ label = 'Download or print' }: { label?: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
