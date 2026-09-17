import Image from 'next/image';
import { HowItWorksClip } from './HowItWorksClip';
import { ROBOT_IMAGE } from './RobotClaimBand';
import styles from './HowItWorksVideos.module.css';

const STEPS = [
  {
    id: 'scan',
    icon: '🧮',
    title: 'Scan or Tap',
  },
  {
    id: 'draft',
    icon: 'robot',
    title: 'Ai Writes the Review',
  },
  {
    id: 'publish',
    icon: '✅',
    title: 'One Tap to Post',
  },
] as const;

export function HowItWorksVideos() {
  return (
    <section
      className={styles.section}
      id="how-it-works"
      data-how-it-works
      aria-labelledby="home-steps-title"
    >
      <header className={styles.heading}>
        <h2 id="home-steps-title">How it works</h2>
      </header>

      <ol className={styles.grid} data-how-grid role="list">
        {STEPS.map((step, index) => (
          <li className={styles.card} data-how-step key={step.id}>
            <div className={styles.copy}>
              <h3 className={styles.stepLabel} data-how-step-title>
                Step {index + 1}
              </h3>
              <span className={styles.stepIcon} aria-hidden="true">
                {step.icon === 'robot' ? (
                  <Image className={styles.robot} src={ROBOT_IMAGE} alt="" width={74} height={89} />
                ) : (
                  step.icon
                )}
              </span>
            </div>
            <div className={styles.media}>
              <HowItWorksClip id={step.id} title={step.title} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
