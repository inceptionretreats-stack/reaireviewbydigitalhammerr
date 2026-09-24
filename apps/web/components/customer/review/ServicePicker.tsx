'use client';

import styles from './CustomerReview.module.css';
import { MAX_SELECTED_SERVICE_CHARACTERS } from '@/lib/customer/customer-services';

export function ServicePicker({
  services,
  selected,
  disabled,
  onChange,
}: {
  services: string[];
  selected: string[];
  disabled: boolean;
  onChange: (services: string[]) => void;
}) {
  return (
    <fieldset className={styles.servicePicker}>
      <legend className={styles.srOnly}>Services you used</legend>
      <div className={styles.serviceGrid}>
        {services.map((service) => {
          const isSelected = selected.includes(service);
          return (
            <button
              key={service}
              type="button"
              className={styles.serviceOption}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() =>
                onChange(
                  isSelected ? selected.filter((item) => item !== service) : [...selected, service],
                )
              }
            >
              <span className={styles.selectionBox} aria-hidden="true">
                {isSelected && (
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m4 10 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span>{service}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.selectionCount} aria-live="polite">
        {selected.join(', ').length > MAX_SELECTED_SERVICE_CHARACTERS
          ? 'Choose fewer services so your draft stays easy to read.'
          : selected.length === 0
            ? 'Choose at least one service to get started'
            : `${selected.length} ${selected.length === 1 ? 'service' : 'services'} selected`}
      </p>
    </fieldset>
  );
}
