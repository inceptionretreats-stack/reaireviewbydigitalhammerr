import Image from 'next/image';
import styles from './RobotClaimBand.module.css';

const ROBOT_IMAGE = '/marketing/ai-review-floating-robot-v1.png';

export function RobotClaimBand() {
  return (
    <section className={styles.band} id="review-growth" aria-labelledby="review-growth-title">
      <div className={styles.inner}>
        <div className={styles.copy} data-review-growth-copy>
          <h2 id="review-growth-title">
            Help your customers share reviews on Google with our Ai review assistant
          </h2>
          <p>Ai drafts. Customers edit. They choose what to post.</p>
        </div>
        <div className={styles.artwork}>
          <Image
            className={styles.robot}
            data-review-growth-robot
            src={ROBOT_IMAGE}
            alt="Friendly waving Ai robot representing the editable review draft assistant"
            width={1273}
            height={1236}
            sizes="(max-width: 600px) 48vw, (max-width: 900px) 220px, (max-width: 1100px) 260px, (max-width: 1440px) 280px, 300px"
          />
          <p className={styles.note}>
            Better
            <br />
            reviews for
            <br />a brighter
            <br />
            tomorrow.
          </p>
        </div>
      </div>
    </section>
  );
}
