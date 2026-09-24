'use client';

import Image from 'next/image';
import type { CommercialTerms } from '@/lib/marketing/commercial-terms';
import { useState } from 'react';
import styles from './FaqSection.module.css';

const QUESTIONS = (t: CommercialTerms) =>
  [
    {
      id: 'qr',
      question: 'How do I get started with my QR?',
      answer:
        'Create your account, add your business details and Google review link, then download your branded QR.',
      image: '/marketing/faq/qr-counter-scene-v1.webp',
      alt: 'Illustrative QR counter display',
    },
    {
      id: 'edit',
      question: 'Can customers edit the Ai review?',
      answer:
        'Yes. They can change every word or tap New review for another draft, then confirm it reflects their genuine experience. Ai gives them a starting point; the final words are always theirs.',
      image: '/marketing/faq/edit-review.webp',
      alt: 'Ai Review customer editor with an editable example review for Digital Hammerr',
    },
    {
      id: 'google',
      question: 'Does it post reviews to Google automatically?',
      answer:
        'No. Customers use Copy & open Google, then paste the review, choose their own star rating and post it themselves. Nothing is published automatically.',
      image: '/marketing/faq/google-handoff.webp',
      alt: 'Customer confirmation and Copy & open Google action in the Ai Review editor',
    },
    {
      id: 'location',
      question: 'Can I change my Google Maps location later?',
      answer:
        'Yes—update Google review location in your business profile. Your existing printed QR codes will use the saved location, so there is nothing to reprint.',
      image: '/marketing/faq/change-location.webp',
      alt: 'Google review location settings in the Ai Review business profile with an editable example review link',
    },
    {
      id: 'plans',
      question: 'What is included in Free and Pro?',
      answer: `Free includes ${t.freeDraftsLabel} Ai drafts per business, with no card needed to begin. Pro is ${t.priceLabel} per year and includes ${t.proDraftsLabel} Ai review drafts per year.`,
      image: '/marketing/faq/plans.webp',
      alt: `Ai Review Free and Pro plans showing ₹0 and ${t.priceLabel} per year pricing`,
    },
    {
      id: 'no-app',
      question: 'Do customers need to download an app?',
      answer:
        'No app or Ai Review account is needed. Customers scan your QR with their phone camera and open the review page in their browser. They only need to sign in to Google when they choose to post.',
      image: '/marketing/faq/edit-review.webp',
      alt: 'Digital Hammerr customer review page available in a phone browser without an Ai Review account',
    },
  ] as const;

type Question = ReturnType<typeof QUESTIONS>[number];

function FaqScreenshot({ item, mobile = false }: { item: Question; mobile?: boolean }) {
  const isPhoto = item.id === 'qr';

  return (
    <figure
      className={mobile ? styles.mobilePreview : styles.desktopPreview}
      data-faq-preview
      data-faq-preview-for={item.id}
      data-faq-photo={isPhoto || undefined}
    >
      <div className={styles.screenshotStage}>
        <div className={styles.screenshotFrame} key={item.image}>
          <a
            className={styles.screenshotLink}
            href={item.image}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={
              isPhoto
                ? 'View illustrative QR counter display'
                : `View full screenshot: ${item.question}`
            }
          >
            <Image
              data-faq-screenshot
              src={item.image}
              alt={isPhoto ? item.alt : `Example product screen: ${item.alt}`}
              fill
              unoptimized
              sizes="(max-width: 560px) calc(100vw - 32px), (max-width: 820px) calc(100vw - 48px), (max-width: 1280px) 44vw, 550px"
              className={styles.screenshot}
            />
          </a>
        </div>
      </div>
    </figure>
  );
}

export function FaqSection({ terms }: { terms: CommercialTerms }) {
  const [selection, setSelection] = useState({ index: 0, expanded: true });
  const questions = QUESTIONS(terms);
  const selected = questions[selection.index]!;

  function selectQuestion(index: number) {
    setSelection((current) => ({
      index,
      expanded: current.index === index ? !current.expanded : true,
    }));
  }

  return (
    <section className={styles.section} id="faq" aria-labelledby="faq-title" data-marketing-faq>
      <header className={styles.heading}>
        <div className={styles.eyebrow}>FAQ</div>
        <h2 id="faq-title">
          Everything you need to know <span>about Ai Review.</span>
        </h2>
      </header>

      <div className={styles.layout}>
        <div className={styles.questions}>
          {questions.map((item, index) => {
            const isExpanded = selection.index === index && selection.expanded;

            return (
              <div className={styles.item} data-open={isExpanded} key={item.id}>
                <h3>
                  <button
                    type="button"
                    id={`faq-question-${item.id}`}
                    aria-expanded={isExpanded}
                    aria-controls={`faq-answer-${item.id}`}
                    onClick={() => selectQuestion(index)}
                  >
                    <span>{item.question}</span>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="m5 9 7 7 7-7" />
                    </svg>
                  </button>
                </h3>
                <div
                  id={`faq-answer-${item.id}`}
                  role="region"
                  aria-labelledby={`faq-question-${item.id}`}
                  aria-hidden={!isExpanded}
                  inert={!isExpanded}
                  className={styles.answerContainer}
                >
                  <div className={styles.answerViewport}>
                    <div className={styles.answer}>
                      <p>{item.answer}</p>
                      <FaqScreenshot item={item} mobile />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <FaqScreenshot item={selected} />
      </div>
    </section>
  );
}
