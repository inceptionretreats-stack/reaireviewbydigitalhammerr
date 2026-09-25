'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from '../site/MarketingSite.module.css';

const VIDEO_CONFIG = {
  source: '/marketing/ai-review-customer-journey-v2-minimal-overlay.mp4',
  poster: '/marketing/ai-review-customer-journey-v2-minimal-overlay-poster.png',
} as const;

export function ReviewStoryVideo() {
  const captionId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const isInViewportRef = useRef(false);
  const isIntentionallyPausedRef = useRef(false);
  const prefersReducedMotionRef = useRef(false);
  const hasMediaErrorRef = useRef(false);
  const loadAttemptRef = useRef(0);
  const syncPlaybackRef = useRef<() => void>(() => undefined);
  const [autoPlayAllowed, setAutoPlayAllowed] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [hasMediaError, setHasMediaError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isMuted, setIsMuted] = useState(true);

  const retryMedia = useCallback(() => {
    if (
      !hasMediaErrorRef.current ||
      !isInViewportRef.current ||
      document.hidden ||
      prefersReducedMotionRef.current ||
      isIntentionallyPausedRef.current
    ) {
      return;
    }

    hasMediaErrorRef.current = false;
    loadAttemptRef.current += 1;
    setHasMediaError(false);
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
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
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
    videoRef.current?.load();
    syncPlaybackRef.current();
  }, [loadAttempt]);

  const handleMediaError = (sourceAttempt = loadAttemptRef.current) => {
    if (sourceAttempt !== loadAttemptRef.current) return;
    hasMediaErrorRef.current = true;
    videoRef.current?.pause();
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

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMutedState = !video.muted;
    video.muted = nextMutedState;
    setIsMuted(nextMutedState);
    if (isInViewportRef.current && !isIntentionallyPausedRef.current) {
      isIntentionallyPausedRef.current = false;
      void video.play().catch(() => undefined);
    }
  };

  return (
    <div
      className={styles.storyVideoFrame}
      data-story-media
      data-media-error={hasMediaError ? 'true' : 'false'}
    >
      <video
        ref={videoRef}
        className={styles.storyVideo}
        style={{ visibility: hasMediaError || prefersReducedMotion ? 'hidden' : undefined }}
        muted={isMuted}
        playsInline
        loop
        autoPlay={autoPlayAllowed}
        controls={false}
        tabIndex={0}
        preload="metadata"
        poster={VIDEO_CONFIG.poster}
        aria-label="Customer review journey video"
        aria-describedby={captionId}
        aria-keyshortcuts="Space Enter"
        data-story-video
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
        onVolumeChange={() => setIsMuted(videoRef.current?.muted ?? true)}
        onError={() => handleMediaError()}
      >
        <source
          key={`story-${loadAttempt}`}
          src={VIDEO_CONFIG.source}
          type="video/mp4"
          onError={() => handleMediaError(loadAttempt)}
        />
        Your browser does not support video playback.
      </video>

      {!hasMediaError && !prefersReducedMotion ? (
        <button
          type="button"
          className={styles.storyVideoControl}
          aria-label={isMuted ? 'Turn video sound on' : 'Mute video'}
          aria-pressed={!isMuted}
          data-story-sound
          onClick={toggleSound}
        >
          {isMuted ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9.4v5.2h3.5l4.2 3.4V6L7.5 9.4H4Zm10.1.2 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9.4v5.2h3.5l4.2 3.4V6L7.5 9.4H4Zm10.2-.9a5 5 0 0 1 0 7l1.2 1.2a6.7 6.7 0 0 0 0-9.4l-1.2 1.2Zm2.4-2.4a8.4 8.4 0 0 1 0 11.8l1.2 1.2a10.1 10.1 0 0 0 0-14.2l-1.2 1.2Z" />
            </svg>
          )}
          <span>{isMuted ? 'Sound on' : 'Mute'}</span>
        </button>
      ) : null}

      <span
        id={captionId}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
        }}
      >
        A customer scans the Digital Hammerr QR code, receives an editable Ai review draft, checks
        it, chooses a star rating, and posts it to Google. Corrected captions appear only where the
        original text was unclear. The video plays silently while visible; use the sound button to
        hear the dialogue. Focus the video and press Space or Enter to pause or resume. Reduced
        motion shows a static preview.
      </span>
    </div>
  );
}
