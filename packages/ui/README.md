# @ai-review/ui — shared UI primitives

This package is the small component kit used by the vendor workspace, onboarding, the sign-in
screens and the admin console in `apps/web`, plus the stylesheet that defines the design tokens
and loads Tailwind CSS v4. The public marketing site and the customer review flow are styled with
their own CSS and do not import these components. Read this when you build or restyle a screen,
or need a button, field, dialog, table or toast.

## What it contains

Everything is exported from `src/index.ts`.

**Components** (`src/components/`): `Badge` and `StatusBadge`, `Button`, `Card`, `Checkbox`,
`Drawer`, `EmptyState`, `Field`, `InlineError`, `Input`, `KpiCard`, `Modal`, `Select`, `Spinner`,
`Table`, `TagInput`, `Textarea`, `Toast` (`ToastProvider`, `ToastViewport`, `useToast`), `Toggle`.
`DialogShell.tsx` is the shared internals of `Modal` and `Drawer` and is not exported.

**Helpers** (`src/lib/`):

| File            | Provides                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| `cx.ts`         | `cx()`: joins conditional class names (no `clsx` dependency)                              |
| `focus-trap.ts` | `createFocusTrap`, `getFocusableElements`: keyboard focus containment for dialogs         |
| `use-dialog.ts` | `useDialogBehaviour`: focus trap, Escape, focus restore, scroll lock for `Modal`/`Drawer` |
| `tags.ts`       | Tag-list rules for `TagInput` (limits mirror `@ai-review/contracts`)                      |
| `tokens.ts`     | Shared class fragments: `FOCUS_RING`, `TOUCH_TARGET`, `CONTROL_SURFACE` and others        |

Components carry almost no product copy; screens pass their own text. That keeps wording rules
(for example, the product only ever says Google was opened) in the screens where copy is written.

## Styles and Tailwind

`src/styles.css` (exported as `@ai-review/ui/styles.css`) is the Tailwind v4 entry point. It
runs `@import 'tailwindcss'`, adds `@source '.'` so Tailwind scans this package's class names
(it reaches the app through a workspace symlink under `node_modules`, which Tailwind skips by
default), and declares the colour, font and radius tokens in `@theme` (for example
`--color-accent`, `--color-ink`, `--color-line`).

`apps/web/app/globals.css` imports it first:

```css
@import '@ai-review/ui/styles.css';
```

Without that import no utility class in this package resolves and screens render unstyled, with no
build error. `globals.css` then maps its older hand-written variables (`--bg`, `--text`, ...) onto
these tokens. Tailwind is compiled by `@tailwindcss/postcss` in `apps/web/postcss.config.mjs`.

Dark mode is a token swap under `prefers-color-scheme` in `styles.css`; components have no
`dark:` variants. The colour pairs were checked for WCAG AA contrast (see the header of
`styles.css`), so check contrast again if you change a token.

## Tests

`src/__tests__/` runs with `pnpm test`. The field, focus trap, modal, table and tag input tests
start with `// @vitest-environment jsdom`, so they run in a browser-like DOM, and all but the
focus-trap test render components with `@testing-library/react`. The `tags` test has no such line
and runs in Node, the root config's default. `src/tsconfig.json` exists only so Vitest can
transform `.tsx` here; see the comment inside it.
