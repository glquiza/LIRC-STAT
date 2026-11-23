import React, { useEffect, useRef, useState } from 'react';

// Custom event types for triggering top progress bar globally
const PROGRESS_EVENT = 'lirc:top-progress';

type ProgressAction =
  | { type: 'start' }
  | { type: 'set'; progress: number }
  | { type: 'pulse'; duration?: number }
  | { type: 'done' };

export const topProgressBar = {
  start: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ProgressAction>(PROGRESS_EVENT, { detail: { type: 'start' } })
      );
    }
  },
  set: (progress: number) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ProgressAction>(PROGRESS_EVENT, {
          detail: { type: 'set', progress: Math.min(100, Math.max(0, progress)) },
        })
      );
    }
  },
  pulse: (duration = 450) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ProgressAction>(PROGRESS_EVENT, {
          detail: { type: 'pulse', duration },
        })
      );
    }
  },
  done: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ProgressAction>(PROGRESS_EVENT, { detail: { type: 'done' } })
      );
    }
  },
};

interface TopProgressBarProps {
  /** Optional dependency value to watch: automatically triggers a quick progress pulse when it changes */
  watchKey?: unknown;
  /** Force active loading state from parent */
  isLoading?: boolean;
}

export const TopProgressBar: React.FC<TopProgressBarProps> = ({ watchKey, isLoading }) => {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);
  const trickleRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (trickleRef.current) {
      window.clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
  };

  const startProgress = () => {
    clearTimers();
    setVisible(true);
    setProgress(18);

    // Trickle progress naturally up to ~85%
    trickleRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) {
          if (trickleRef.current) window.clearInterval(trickleRef.current);
          return prev;
        }
        const delta = Math.max(1, (85 - prev) * 0.12);
        return Math.min(85, prev + delta);
      });
    }, 160);
  };

  const finishProgress = () => {
    clearTimers();
    setProgress(100);
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      timerRef.current = window.setTimeout(() => {
        setProgress(0);
      }, 250);
    }, 280);
  };

  const pulseProgress = (duration = 450) => {
    clearTimers();
    setVisible(true);
    setProgress(32);

    timerRef.current = window.setTimeout(() => {
      setProgress(76);
      timerRef.current = window.setTimeout(() => {
        setProgress(100);
        timerRef.current = window.setTimeout(() => {
          setVisible(false);
          timerRef.current = window.setTimeout(() => {
            setProgress(0);
          }, 200);
        }, 180);
      }, duration * 0.45);
    }, duration * 0.35);
  };

  // Listen to global events
  useEffect(() => {
    const handleEvent = (e: Event) => {
      const customEvent = e as CustomEvent<ProgressAction>;
      const detail = customEvent.detail;
      if (!detail) return;

      if (detail.type === 'start') {
        startProgress();
      } else if (detail.type === 'set') {
        clearTimers();
        setVisible(true);
        setProgress(detail.progress);
        if (detail.progress >= 100) {
          finishProgress();
        }
      } else if (detail.type === 'pulse') {
        pulseProgress(detail.duration);
      } else if (detail.type === 'done') {
        finishProgress();
      }
    };

    window.addEventListener(PROGRESS_EVENT, handleEvent);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, handleEvent);
      clearTimers();
    };
  }, []);

  // React to prop changes (isLoading)
  useEffect(() => {
    if (isLoading) {
      startProgress();
    } else if (isLoading === false && visible) {
      finishProgress();
    }
  }, [isLoading]);

  // React to watchKey changes (tab navigation, route switch, etc.)
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    pulseProgress(400);
  }, [watchKey]);

  if (!visible && progress === 0) {
    return null;
  }

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-label="Page loading progress"
      className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {/* Top Bar Line with Warm Academic gradient and trailing glow */}
      <div
        className="h-[3px] bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#A83232] shadow-[0_0_10px_#A83232,0_0_5px_#E7B84B] transition-all duration-200 ease-out relative"
        style={{
          width: `${progress}%`,
        }}
      >
        {/* Glow peg on the trailing right edge */}
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-r from-transparent to-white/60 opacity-80" />
      </div>
    </div>
  );
};
