'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from './ReviewBenefits.module.css';

export function ReviewBenefitsDraft() {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('The team explained everything clearly.');
  const draftId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  return (
    <div className={styles.preview}>
      <label className={styles.previewLabel} htmlFor={draftId}>
        Example draft
      </label>
      <div className={styles.draftSheet} data-editing={editing}>
        <textarea
          className={styles.draftText}
          id={draftId}
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          readOnly={!editing}
          tabIndex={editing ? 0 : -1}
          aria-label="Edit the example review draft"
          maxLength={260}
          rows={3}
          spellCheck
        />
        <span className={styles.draftLines} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <button
          className={styles.editButton}
          type="button"
          onClick={() => setEditing((previous) => !previous)}
          aria-controls={draftId}
          aria-pressed={editing}
          aria-label={editing ? 'Finish editing the example draft' : 'Edit the example draft'}
        >
          {editing ? 'Done' : 'Edit draft'}
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {editing ? <path d="m5 12 4 4L19 6" /> : <path d="M5 12h14m-5-5 5 5-5 5" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
