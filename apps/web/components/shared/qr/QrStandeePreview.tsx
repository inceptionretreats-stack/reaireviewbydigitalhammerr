import styles from './QrStandeePreview.module.css';

export interface QrStandeePreviewProps {
  businessName: string;
  qrSrc: string;
  /** Optional printed source code, used only to distinguish otherwise identical previews. */
  sourceCode?: string;
  size?: 'hero' | 'compact';
  className?: string;
}

/**
 * A screen-sized twin of the printable QR artwork.
 *
 * The QR itself stays as the encoder produced it: pure black on an opaque white plate with its
 * four-module quiet zone intact. All visual branding lives around that symbol, never on top of it.
 * The footer is the same lockup as the site header, sized to the card, because the printout
 * (lib/qr/qr-card.ts) carries that mark and the preview must not promise a different one.
 */
export function QrStandeePreview({
  businessName,
  qrSrc,
  sourceCode,
  size = 'hero',
  className,
}: QrStandeePreviewProps) {
  const classes = [styles.card, size === 'compact' ? styles.compact : styles.hero, className]
    .filter(Boolean)
    .join(' ');

  return (
    <figure
      className={classes}
      aria-label={`QR card${sourceCode ? ` ${sourceCode}` : ''} for ${businessName}`}
    >
      <figcaption className={styles.businessName} data-qr-card-part="name" title={businessName}>
        {businessName}
      </figcaption>

      <div className={styles.qrPlate} data-qr-card-part="qr">
        <span className={`${styles.corner} ${styles.cornerTopLeft}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.cornerTopRight}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.cornerBottomLeft}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.cornerBottomRight}`} aria-hidden="true" />
        <img
          className={styles.qr}
          src={qrSrc}
          alt={`QR code${sourceCode ? ` ${sourceCode},` : ''} opening the review page for ${businessName}`}
          width={240}
          height={240}
        />
      </div>

      <p
        className={styles.brandFooter}
        data-qr-card-part="credit"
        aria-label="Ai Review by Digital Hammerr"
      >
        <span className={styles.brandBars} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className={styles.brandCopy}>
          <strong>Ai Review</strong>
          <small>by Digital Hammerr</small>
        </span>
      </p>
    </figure>
  );
}
