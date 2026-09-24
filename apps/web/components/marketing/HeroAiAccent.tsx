'use client';

import { useState } from 'react';
import styles from './MarketingSite.module.css';

/**
 * Keeps the headline's subtle interaction isolated from the server-rendered marketing page.
 * Re-keying only the decorative layers restarts their short animation without moving focus from
 * the button, so mouse, touch, Enter and Space all get the same response.
 */
export function HeroAiAccent() {
  const [animationCycle, setAnimationCycle] = useState(0);
  const hasInteracted = animationCycle > 0;

  return (
    <button
      className={`${styles.heroWordBlue} ${styles.heroAiButton}`}
      type="button"
      title="Click to animate Ai"
      data-hero-ai
      data-animation-cycle={animationCycle}
      onClick={() => setAnimationCycle((cycle) => cycle + 1)}
    >
      <span
        className={hasInteracted ? styles.heroAiTextClicked : styles.heroAiText}
        key={`text-${animationCycle}`}
      >
        Ai
      </span>
      {hasInteracted && (
        <span className={styles.heroAiClickEffect} key={`effect-${animationCycle}`} aria-hidden />
      )}
    </button>
  );
}
