'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from './HowItWorksClip.module.css';

type VideoFormat = 'mp4' | 'webm';

// Shared environment listeners, not an exclusive-playback registry.
const howClipSynchronizers = new Map<HTMLVideoElement, (allowRetry: boolean) => void>();
let howMotionQuery: MediaQueryList | null = null;

function synchronizeHowVisibility() {
  for (const sync of howClipSynchronizers.values()) sync(!document.hidden);
}

function synchronizeHowMotion() {
  for (const sync of howClipSynchronizers.values()) sync(false);
}

function synchronizeHowOnline() {
  for (const sync of howClipSynchronizers.values()) sync(true);
}

export function HowItWorksClip({ id, title }: { id: string; title: string }) {
  const captionId = useId();
  const figureRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inViewportRef = useRef(false);
  const manuallyPausedRef = useRef(false);
  const sourcesActivatedRef = useRef(false);
  const failedSourcesRef = useRef(new Set<VideoFormat>());
  const hasTriedWebMRef = useRef(false);
  const mediaUnavailableRef = useRef(false);
  const loadAttemptRef = useRef(0);
  const playAttemptRef = useRef(0);
  const [sourcesActivated, setSourcesActivated] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasMediaError, setHasMediaError] = useState(false);
  const assetBase = '/marketing/how-it-works/' + id + '-v5';
  const poster = assetBase + '-poster.webp';

  const pauseClip = useCallback(() => {
    playAttemptRef.current += 1;
    videoRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const markMediaUnavailable = useCallback(() => {
    mediaUnavailableRef.current = true;
    pauseClip();
    setHasMediaError(true);
  }, [pauseClip]);

  const restartSources = useCallback(() => {
    // Only a new visibility/online event can retry; an error never retries itself.
    failedSourcesRef.current.clear();
    hasTriedWebMRef.current = false;
    mediaUnavailableRef.current = false;
    loadAttemptRef.current += 1;
    playAttemptRef.current += 1;
    videoRef.current?.removeAttribute('src');
    setHasMediaError(false);
    setLoadAttempt(loadAttemptRef.current);
  }, []);

  const synchronizePlayback = useCallback(
    (allowRetry = false) => {
      const video = videoRef.current;
      if (!video) return;
      if (
        !inViewportRef.current ||
        document.hidden ||
        howMotionQuery?.matches ||
        manuallyPausedRef.current
      ) {
        pauseClip();
        return;
      }
      if (mediaUnavailableRef.current) {
        if (allowRetry) restartSources();
        return;
      }
      if (!sourcesActivatedRef.current) {
        sourcesActivatedRef.current = true;
        setSourcesActivated(true);
        return;
      }
      const attempt = ++playAttemptRef.current;
      void video.play().catch((error: unknown) => {
        if (attempt !== playAttemptRef.current) return;
        if (
          video.error ||
          failedSourcesRef.current.size === 2 ||
          (error instanceof DOMException &&
            error.name === 'NotSupportedError' &&
            video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)
        ) {
          markMediaUnavailable();
          return;
        }
        // Autoplay can be blocked by the browser. Keep the preview, not a false playing state.
        pauseClip();
      });
    },
    [markMediaUnavailable, pauseClip, restartSources],
  );

  useEffect(() => {
    const figure = figureRef.current;
    const video = videoRef.current;
    if (!figure || !video) return;

    if (howClipSynchronizers.size === 0) {
      howMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      howMotionQuery.addEventListener('change', synchronizeHowMotion);
      document.addEventListener('visibilitychange', synchronizeHowVisibility);
      window.addEventListener('online', synchronizeHowOnline);
    }
    howClipSynchronizers.set(video, synchronizePlayback);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const wasVisible = inViewportRef.current;
        inViewportRef.current = entry.isIntersecting && entry.intersectionRatio >= 0.05;
        synchronizePlayback(!wasVisible && inViewportRef.current);
      },
      { threshold: [0, 0.05] },
    );
    observer.observe(figure);
    const onMetadata = () => synchronizePlayback();
    video.addEventListener('loadedmetadata', onMetadata);

    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', onMetadata);
      howClipSynchronizers.delete(video);
      if (howClipSynchronizers.size === 0) {
        howMotionQuery?.removeEventListener('change', synchronizeHowMotion);
        howMotionQuery = null;
        document.removeEventListener('visibilitychange', synchronizeHowVisibility);
        window.removeEventListener('online', synchronizeHowOnline);
      }
      playAttemptRef.current += 1;
      video.pause();
    };
  }, [synchronizePlayback]);

  useEffect(() => {
    if (!sourcesActivated) return;
    videoRef.current?.load();
    synchronizePlayback();
  }, [sourcesActivated, loadAttempt, synchronizePlayback, assetBase]);

  const handleSourceError = (format: VideoFormat, attempt: number) => {
    if (attempt !== loadAttemptRef.current) return;
    failedSourcesRef.current.add(format);
    if (failedSourcesRef.current.size === 2) markMediaUnavailable();
  };

  const handleVideoError = () => {
    const video = videoRef.current;
    if (!video?.error) return;
    if (
      !hasTriedWebMRef.current &&
      !failedSourcesRef.current.has('webm') &&
      video.currentSrc.endsWith('.mp4')
    ) {
      failedSourcesRef.current.add('mp4');
      hasTriedWebMRef.current = true;
      playAttemptRef.current += 1;
      video.src = assetBase + '.webm';
      video.load();
      synchronizePlayback();
      return;
    }
    markMediaUnavailable();
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat) return;
    manuallyPausedRef.current = !videoRef.current?.paused;
    if (manuallyPausedRef.current) pauseClip();
    else synchronizePlayback(true);
  };

  return (
    <figure
      ref={figureRef}
      className={styles.figure}
      style={{ backgroundImage: 'url("' + poster + '")' }}
      data-how-clip={id}
      data-media-error={hasMediaError ? 'true' : 'false'}
      data-playing={isPlaying ? 'true' : 'false'}
    >
      <video
        ref={videoRef}
        className={styles.video}
        width={480}
        height={900}
        autoPlay
        controls={false}
        muted
        loop
        playsInline
        preload="none"
        poster={poster}
        tabIndex={0}
        aria-label={'Video explanation: ' + title}
        aria-describedby={captionId}
        aria-keyshortcuts="Space Enter"
        data-how-video
        onKeyDown={handleKeyboard}
        onPlaying={() => {
          if (
            mediaUnavailableRef.current ||
            !inViewportRef.current ||
            document.hidden ||
            howMotionQuery?.matches ||
            manuallyPausedRef.current
          ) {
            pauseClip();
            return;
          }
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onError={handleVideoError}
      >
        {sourcesActivated ? (
          <>
            <source
              key={'mp4-' + loadAttempt}
              src={assetBase + '.mp4'}
              type="video/mp4"
              onError={() => handleSourceError('mp4', loadAttempt)}
            />
            <source
              key={'webm-' + loadAttempt}
              src={assetBase + '.webm'}
              type="video/webm"
              onError={() => handleSourceError('webm', loadAttempt)}
            />
          </>
        ) : null}
        Your browser does not support video playback. This clip illustrates {title.toLowerCase()}.
      </video>

      <figcaption className={styles.visuallyHidden} id={captionId}>
        {title}. A short illustrative explanation that plays automatically. Focus the video and
        press Space or Enter to pause or resume. Your reduced-motion setting keeps the preview
        static. This demonstration does not generate a real review, access your clipboard or post to
        Google.
      </figcaption>

      {hasMediaError ? (
        <span className={styles.visuallyHidden} role="status">
          The video could not load. Its preview remains visible. It will try again when you return
          to it or your connection comes back online.
        </span>
      ) : null}
    </figure>
  );
}
