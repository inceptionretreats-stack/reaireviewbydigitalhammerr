/**
 * `@ai-review/ui` — the shared primitives from `18_UI_UX_Design_System_Brief.md`.
 *
 * Two things this package deliberately does not contain.
 *
 * Product copy. Almost every string here is supplied by the caller, so the review-policy rules
 * (AC-025: the platform may only ever say Google was *opened*; D-009: no star rating anywhere
 * before Google) are enforced where the screens are written, and no component can smuggle a
 * claim into every screen at once. The few fixed strings are structural — "Close", "Remove",
 * "Dismiss" — with one exception: `TagInput` states that terms are hints and not required
 * words, which is D-025 / AC-010 and belongs with the control rather than with each screen that
 * happens to use it.
 *
 * Theme switching. Dark mode is a token swap in `styles.css` under `prefers-color-scheme`, so
 * components carry no `dark:` variants; see the header of that file for why.
 *
 * Import the stylesheet once at the application root:
 *
 *   @import '@ai-review/ui/styles.css';
 */

export { Badge, StatusBadge } from './components/Badge';
export type {
  BadgeProps,
  BadgeTone,
  ItemStatus,
  LifecycleStatus,
  PlanStatus,
  StatusBadgeProps,
  StatusValue,
} from './components/Badge';

export { Button } from './components/Button';
export type { ButtonProps, ButtonVariant } from './components/Button';

export { Card } from './components/Card';
export type { CardProps } from './components/Card';

export { Checkbox } from './components/Checkbox';
export type { CheckboxProps } from './components/Checkbox';

export { Drawer } from './components/Drawer';
export type { DrawerProps } from './components/Drawer';

export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';

export { Field } from './components/Field';
export type { FieldControlProps, FieldProps } from './components/Field';

export { InlineError } from './components/InlineError';
export type { InlineErrorProps } from './components/InlineError';

export { Input } from './components/Input';
export type { InputProps } from './components/Input';

export { KpiCard } from './components/KpiCard';
export type { KpiCardProps, KpiTrend, TrendDirection, TrendTone } from './components/KpiCard';

export { Modal } from './components/Modal';
export type { ModalProps } from './components/Modal';

export { Select } from './components/Select';
export type { SelectOption, SelectProps } from './components/Select';

export { Spinner } from './components/Spinner';
export type { SpinnerProps } from './components/Spinner';

export { Table } from './components/Table';
export type { TableColumn, TableProps } from './components/Table';

export { TagInput } from './components/TagInput';
export type { TagInputProps } from './components/TagInput';

export { Textarea } from './components/Textarea';
export type { TextareaProps } from './components/Textarea';

export { ToastProvider, ToastViewport, useToast } from './components/Toast';
export type {
  ShowToastOptions,
  ToastApi,
  ToastMessage,
  ToastProviderProps,
  ToastTone,
} from './components/Toast';

export { Toggle } from './components/Toggle';
export type { ToggleProps } from './components/Toggle';

export { cx } from './lib/cx';
export type { ClassValue } from './lib/cx';

export { createFocusTrap, getFocusableElements } from './lib/focus-trap';
export type { FocusTrap } from './lib/focus-trap';

export {
  addTag,
  addTags,
  DEFAULT_TAG_RULES,
  describeTagRejection,
  normalizeTag,
  removeTagAt,
  splitTagInput,
} from './lib/tags';
export type { AddTagResult, TagRejection, TagRules } from './lib/tags';

export {
  CONTROL_INVALID,
  CONTROL_SURFACE,
  FOCUS_RING,
  PEER_FOCUS_RING,
  TOUCH_TARGET,
} from './lib/tokens';

export { useDialogBehaviour } from './lib/use-dialog';
export type { DialogBehaviour, DialogBehaviourOptions } from './lib/use-dialog';
