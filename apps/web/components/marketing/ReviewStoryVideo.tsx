'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './MarketingSite.module.css';

const VIDEO_CONFIG = {
  startSeconds: 1.25,
  endSeconds: 8,
  source: '/marketing/ai-review-story-v2.webm',
  poster: '/marketing/ai-review-story-v2-poster.png',
  controlLabel: 'review journey animation',
} as const;

function getShapeSubtitleOpacity(currentTime: number) {
  if (currentTime < 2.85 || currentTime > 6) return 0;
  if (currentTime < 3.1) return (currentTime - 2.85) / 0.25;
  if (currentTime <= 5.5) return 1;
  return (6 - currentTime) / 0.5;
}

export function ReviewStoryVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isInViewportRef = useRef(false);
  const isIntentionallyPausedRef = useRef(false);
  const prefersReducedMotionRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shapeSubtitleOpacity, setShapeSubtitleOpacity] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

    const moveToCleanStart = () => {
      if (
        video.readyState >= HTMLMediaElement.HAVE_METADATA &&
        (video.currentTime < VIDEO_CONFIG.startSeconds ||
          video.currentTime >= VIDEO_CONFIG.endSeconds)
      ) {
        video.currentTime = VIDEO_CONFIG.startSeconds;
      }
    };

    const syncPlayback = () => {
      moveToCleanStart();

      if (
        prefersReducedMotionRef.current ||
        !isInViewportRef.current ||
        document.hidden ||
        isIntentionallyPausedRef.current
      ) {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        setIsPlaying(false);
      });
    };

    const handleMotionPreferenceChange = () => {
      prefersReducedMotionRef.current = motionPreference.matches;
      if (motionPreference.matches && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        video.currentTime = VIDEO_CONFIG.startSeconds;
      }
      syncPlayback();
    };

    const handleVisibilityChange = () => syncPlayback();

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        isInViewportRef.current = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        syncPlayback();
      },
      { threshold: [0, 0.25] },
    );

    prefersReducedMotionRef.current = motionPreference.matches;
    video.addEventListener('loadedmetadata', syncPlayback);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    motionPreference.addEventListener('change', handleMotionPreferenceChange);
    observer.observe(video);

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      syncPlayback();
    }

    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', syncPlayback);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionPreference.removeEventListener('change', handleMotionPreferenceChange);
      video.pause();
    };
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      isIntentionallyPausedRef.current = false;
      if (
        video.currentTime < VIDEO_CONFIG.startSeconds ||
        video.currentTime >= VIDEO_CONFIG.endSeconds
      ) {
        video.currentTime = VIDEO_CONFIG.startSeconds;
      }
      void video.play().catch(() => setIsPlaying(false));
    } else {
      isIntentionallyPausedRef.current = true;
      video.pause();
    }
  };

  const keepPlaybackInCleanRange = () => {
    const video = videoRef.current;
    if (!video) return;

    setShapeSubtitleOpacity(getShapeSubtitleOpacity(video.currentTime));

    if (video.currentTime >= VIDEO_CONFIG.endSeconds) {
      video.currentTime = VIDEO_CONFIG.startSeconds;
      setShapeSubtitleOpacity(0);
    }
  };

  const recoverFromEncodedEnd = () => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = VIDEO_CONFIG.startSeconds;
    setShapeSubtitleOpacity(0);
    if (
      isInViewportRef.current &&
      !prefersReducedMotionRef.current &&
      !isIntentionallyPausedRef.current &&
      !document.hidden
    ) {
      void video.play().catch(() => setIsPlaying(false));
    }
  };

  return (
    <div className={styles.storyVideoFrame}>
      <video
        ref={videoRef}
        className={styles.storyVideo}
        muted
        playsInline
        preload="metadata"
        poster={VIDEO_CONFIG.poster}
        aria-hidden="true"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={keepPlaybackInCleanRange}
        onEnded={recoverFromEncodedEnd}
      >
        <source src={VIDEO_CONFIG.source} type="video/webm" />
      </video>

      <span className={styles.storyVideoDraftLabel} aria-hidden="true">
        Ai Review Draft
      </span>
      <span
        className={styles.storyVideoShapeSubtitle}
        style={{ opacity: shapeSubtitleOpacity }}
        aria-hidden="true"
      >
        Ai,
      </span>

      <button
        className={styles.storyVideoControl}
        type="button"
        onClick={togglePlayback}
        aria-label={`${isPlaying ? 'Pause' : 'Play'} ${VIDEO_CONFIG.controlLabel}`}
      >
        {isPlaying ? (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="5" y="4" width="3.5" height="12" rx="1" />
            <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 4.8c0-1 1.1-1.6 1.9-1l7.1 5.2a1.2 1.2 0 0 1 0 2l-7.1 5.2c-.8.6-1.9 0-1.9-1V4.8Z" />
          </svg>
        )}
        <span>{isPlaying ? 'Pause' : 'Play'}</span>
      </button>
    </div>
  );
}
