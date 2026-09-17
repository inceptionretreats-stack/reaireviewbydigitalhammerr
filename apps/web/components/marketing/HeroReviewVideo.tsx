'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from './HeroReviewVideo.module.css';

const VIDEO_ASSETS = {
  mp4: '/marketing/hero-review-walkthrough-v3.mp4',
  webm: '/marketing/hero-review-walkthrough-v3.webm',
  poster: '/marketing/hero-review-walkthrough-v3-poster.png',
  captions: '/marketing/hero-review-walkthrough-v3.vtt',
} as const;

const VIDEO_CHAPTERS = [
  { start: 0, step: 'scan' },
  { start: 5, step: 'generate' },
  { start: 10, step: 'shuffle' },
  { start: 15, step: 'copy' },
  { start: 19, step: 'post' },
  { start: 25, step: 'celebrate' },
] as const;

type VideoStep = (typeof VIDEO_CHAPTERS)[number]['step'];
type VideoFormat = 'mp4' | 'webm';

function getVideoStep(currentTime: number): VideoStep {
  for (let index = VIDEO_CHAPTERS.length - 1; index >= 0; index -= 1) {
    const chapter = VIDEO_CHAPTERS[index];
    if (chapter && currentTime >= chapter.start) {
      return chapter.step;
    }
  }

  return 'scan';
}

/** The animation illustrates the journey; it never submits a review to Google. */
export function HeroReviewVideo() {
  const captionId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const isInViewportRef = useRef(false);
  const isIntentionallyPausedRef = useRef(false);
  const prefersReducedMotionRef = useRef(false);
  const hasTriedWebMRef = useRef(false);
  const failedSourcesRef = useRef(new Set<VideoFormat>());
  const hasMediaErrorRef = useRef(false);
  const loadAttemptRef = useRef(0);
  const syncPlaybackRef = useRef<() => void>(() => undefined);
  const [autoPlayAllowed, setAutoPlayAllowed] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [hasMediaError, setHasMediaError] = useState(false);
  const [activeStep, setActiveStep] = useState<VideoStep>('scan');
  const [loadAttempt, setLoadAttempt] = useState(0);

  const retryMedia = useCallback(() => {
    const video = videoRef.current;
    if (
      !video ||
      !hasMediaErrorRef.current ||
      !isInViewportRef.current ||
      document.hidden ||
      prefersReducedMotionRef.current ||
      isIntentionallyPausedRef.current
    ) {
      return;
    }

    // One new load per visibility return or online event, never an error-driven retry loop.
    hasTriedWebMRef.current = false;
    failedSourcesRef.current.clear();
    hasMediaErrorRef.current = false;
    loadAttemptRef.current += 1;
    video.removeAttribute('src');
    setHasMediaError(false);
    setActiveStep('scan');
    setLoadAttempt(loadAttemptRef.current);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotionRef.current = motionPreference.matches;
    setPrefersReducedMotion(motionPreference.matches);

    const syncPlayback = () => {
      const canPlay =
        !prefersReducedMotionRef.current &&
        isInViewportRef.current &&
        !document.hidden &&
        !isIntentionallyPausedRef.current &&
        !hasMediaErrorRef.current;
      setAutoPlayAllowed(canPlay);
      if (!canPlay) {
        video.pause();
        return;
      }

      void video.play().catch(() => undefined);
    };
    syncPlaybackRef.current = syncPlayback;

    const handleMotionPreferenceChange = () => {
      prefersReducedMotionRef.current = motionPreference.matches;
      setPrefersReducedMotion(motionPreference.matches);
      syncPlayback();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) retryMedia();
      syncPlayback();
    };
    const handleOnline = () => {
      retryMedia();
      syncPlayback();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const wasInViewport = isInViewportRef.current;
        isInViewportRef.current = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        if (!wasInViewport && isInViewportRef.current) retryMedia();
        syncPlayback();
      },
      { threshold: [0, 0.25] },
    );

    video.addEventListener('loadedmetadata', syncPlayback);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    motionPreference.addEventListener('change', handleMotionPreferenceChange);
    observer.observe(video);

    // A failed initial load can finish before hydration attaches source error handlers.
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      failedSourcesRef.current.add('mp4');
      failedSourcesRef.current.add('webm');
      hasMediaErrorRef.current = true;
      setHasMediaError(true);
      setAutoPlayAllowed(false);
      video.pause();
    }

    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', syncPlayback);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      motionPreference.removeEventListener('change', handleMotionPreferenceChange);
      syncPlaybackRef.current = () => undefined;
      video.pause();
    };
  }, [retryMedia]);

  useEffect(() => {
    if (loadAttempt === 0) return;
    // The newly keyed sources are committed before starting the retry's resource selection.
    videoRef.current?.load();
    syncPlaybackRef.current();
  }, [loadAttempt]);

  const handleSourceError = (format: VideoFormat, sourceAttempt: number) => {
    if (sourceAttempt !== loadAttemptRef.current) return;

    failedSourcesRef.current.add(format);
    if (failedSourcesRef.current.size < 2) return;

    hasMediaErrorRef.current = true;
    videoRef.current?.pause();
    setAutoPlayAllowed(false);
    setHasMediaError(true);
  };

  const handleMediaError = () => {
    const video = videoRef.current;
    if (!video) return;

    // Source elements cover initial format selection; this also recovers MP4 decode failures.
    if (
      !hasTriedWebMRef.current &&
      !failedSourcesRef.current.has('webm') &&
      video.currentSrc.endsWith('.mp4')
    ) {
      failedSourcesRef.current.add('mp4');
      hasTriedWebMRef.current = true;
      video.src = VIDEO_ASSETS.webm;
      video.load();
      return;
    }

    video.pause();
    hasMediaErrorRef.current = true;
    setAutoPlayAllowed(false);
    setHasMediaError(true);
  };

  const handlePlaybackKey = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat || prefersReducedMotionRef.current || hasMediaErrorRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    isIntentionallyPausedRef.current = !video.paused;
    syncPlaybackRef.current();
  };

  const updateChapter = () => {
    const video = videoRef.current;
    if (!video) return;

    const nextStep = getVideoStep(video.currentTime);
    // timeupdate can fire often; React state changes only at the six chapter boundaries.
    setActiveStep((currentStep) => (currentStep === nextStep ? currentStep : nextStep));
  };

  return (
    <figure
      className={styles.figure}
      style={{ backgroundImage: `url("${VIDEO_ASSETS.poster}")` }}
      data-hero-media="video"
      data-active-step={activeStep}
      data-media-error={hasMediaError ? 'true' : 'false'}
      data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
    >
      <video
        ref={videoRef}
        className={styles.video}
        width={960}
        height={960}
        muted
        playsInline
        loop
        autoPlay={autoPlayAllowed}
        controls={false}
        tabIndex={0}
        preload="metadata"
        poster={VIDEO_ASSETS.poster}
        aria-label="Animated review walkthrough"
        aria-describedby={captionId}
        aria-keyshortcuts="Space Enter"
        data-hero-video
        onPlay={() => {
          if (
            hasMediaErrorRef.current ||
            prefersReducedMotionRef.current ||
            !isInViewportRef.current ||
            document.hidden ||
            isIntentionallyPausedRef.current
          ) {
            videoRef.current?.pause();
          }
        }}
        onKeyDown={handlePlaybackKey}
        onTimeUpdate={updateChapter}
        onError={handleMediaError}
      >
        <source
          key={`mp4-${loadAttempt}`}
          src={VIDEO_ASSETS.mp4}
          type="video/mp4"
          onError={() => handleSourceError('mp4', loadAttempt)}
        />
        <source
          key={`webm-${loadAttempt}`}
          src={VIDEO_ASSETS.webm}
          type="video/webm"
          onError={() => handleSourceError('webm', loadAttempt)}
        />
        <track src={VIDEO_ASSETS.captions} kind="captions" srcLang="en" label="Review steps" />
        Your browser does not support video playback. The review journey is described below.
      </video>

      <figcaption className={styles.visuallyHidden} id={captionId}>
        A friendly Ai robot illustrates the review journey: a customer scans a QR code, generates an
        Ai-assisted review, shuffles and chooses a draft, and copies it. The customer opens Google,
        pastes the review and posts it themselves. Stars then rise from the phone to celebrate. This
        demonstration does not post a real Google review automatically. The animation plays
        automatically while visible. Focus the video and press Space or Enter to pause or resume.
        Reduced motion displays a static preview.
      </figcaption>
    </figure>
  );
}
