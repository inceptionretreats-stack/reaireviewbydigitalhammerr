import styles from './CustomerReview.module.css';

type IconName = 'edit' | 'shuffle' | 'copy' | 'arrow' | 'message' | 'spinner';

const paths: Record<IconName, string> = {
  edit: 'm16 3 5 5M4 15 15.5 3.5a2.12 2.12 0 0 1 3 0l2 2a2.12 2.12 0 0 1 0 3L9 20l-6 1 1-6Z',
  shuffle:
    'M3 6h3c4 0 8 12 12 12h3m-4-4 4 4-4 4M3 18h3c1.5 0 3-1.7 4.5-4M14 8c1.4-1.3 2.7-2 4-2h3m-4-4 4 4-4 4',
  copy: 'M9 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  message: 'M21 11.5a9 9 0 0 1-9 9 9.7 9.7 0 0 1-4-.9L3 21l1.4-4.7A9 9 0 1 1 21 11.5Z',
  spinner: 'M21 12a9 9 0 1 1-9-9',
};

export function ReviewFlowIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ?? styles.icon}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
