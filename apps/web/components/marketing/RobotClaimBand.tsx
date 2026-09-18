import Image from 'next/image';
import styles from './MarketingSite.module.css';

const ROBOT_IMAGE = '/marketing/ai-review-robot-mascot.png';

function GoogleWord() {
  return (
    <span className={styles.googleWord} aria-label="Google">
      <span aria-hidden="true">G</span>
      <span aria-hidden="true">o</span>
      <span aria-hidden="true">o</span>
      <span aria-hidden="true">g</span>
      <span aria-hidden="true">l</span>
      <span aria-hidden="true">e</span>
    </span>
  );
}

export function RobotClaimBand() {
  return (
    <section
      className={styles.reviewGrowth}
      id="review-growth"
      aria-labelledby="review-growth-title"
    >
      <div className={styles.reviewGrowthCopy} data-review-growth-copy>
        <h2 id="review-growth-title">
          <span className={styles.reviewGrowthLine}>Help your customers</span>{' '}
          <span className={styles.reviewGrowthLine}>
            share <strong>reviews</strong> on <GoogleWord /> with
          </span>{' '}
          <span className={styles.reviewGrowthLine}>our</span>{' '}
          <span className={styles.reviewGrowthLine}>
            Ai <strong>review assistant</strong>
          </span>
        </h2>
        <p className={styles.reviewGrowthMetric}>
          Ai drafts. <strong>Customers edit.</strong> <em>They choose what to post.</em>
        </p>
      </div>

      <div className={styles.reviewGrowthRobotStage}>
        <Image
          className={styles.reviewGrowthRobot}
          data-review-growth-robot
          src={ROBOT_IMAGE}
          alt="Friendly Ai robot representing the editable review draft assistant"
          width={1145}
          height={1374}
          sizes="(max-width: 560px) 78vw, (max-width: 820px) 350px, 430px"
        />
      </div>
    </section>
  );
}

export { ROBOT_IMAGE };
