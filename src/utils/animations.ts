import { useEffect, useRef } from 'react';
import gsap from 'gsap';

/**
 * GSAP Animation Suite for LIRC STAT (Academic Theme)
 * Uses gsap.context for React 19 safety & automatic cleanup.
 */

// Global defaults for refined, academic motion
gsap.defaults({
  duration: 0.45,
  ease: 'power2.out',
});

/**
 * Animate an element with a soft academic fade & upward rise
 */
export const gsapFadeIn = (
  target: gsap.DOMTarget,
  options: {
    y?: number;
    duration?: number;
    delay?: number;
    ease?: string;
  } = {}
) => {
  const { y = 14, duration = 0.5, delay = 0, ease = 'power2.out' } = options;
  return gsap.fromTo(
    target,
    { opacity: 0, y },
    { opacity: 1, y: 0, duration, delay, ease }
  );
};

/**
 * Stagger in a list or grid of child elements
 */
export const gsapStaggerIn = (
  targets: gsap.DOMTarget,
  options: {
    y?: number;
    stagger?: number;
    duration?: number;
    delay?: number;
    ease?: string;
  } = {}
) => {
  const { y = 16, stagger = 0.06, duration = 0.45, delay = 0.05, ease = 'power2.out' } = options;
  return gsap.fromTo(
    targets,
    { opacity: 0, y },
    { opacity: 1, y: 0, stagger, duration, delay, ease }
  );
};

/**
 * Academic Pop-in for Modals and Dialogs (soft back-out curve)
 */
export const gsapPopIn = (
  target: gsap.DOMTarget,
  options: {
    scale?: number;
    duration?: number;
    ease?: string;
  } = {}
) => {
  const { scale = 0.94, duration = 0.35, ease = 'back.out(1.5)' } = options;
  return gsap.fromTo(
    target,
    { opacity: 0, scale },
    { opacity: 1, scale: 1, duration, ease }
  );
};

/**
 * Smooth numerical count-up animation for stats & counters
 */
export const gsapCountUp = (
  target: HTMLElement | null,
  targetValue: number,
  options: {
    duration?: number;
    delay?: number;
    prefix?: string;
    suffix?: string;
    formatter?: (val: number) => string;
  } = {}
) => {
  if (!target) return null;
  const { duration = 1.0, delay = 0, prefix = '', suffix = '', formatter } = options;

  const obj = { val: 0 };
  return gsap.to(obj, {
    val: targetValue,
    duration,
    delay,
    ease: 'power2.out',
    onUpdate: () => {
      const rounded = Math.round(obj.val);
      const formatted = formatter ? formatter(rounded) : rounded.toLocaleString();
      target.textContent = `${prefix}${formatted}${suffix}`;
    },
  });
};

/**
 * Subtle pulse for attention/live badges
 */
export const gsapPulse = (target: gsap.DOMTarget) => {
  return gsap.fromTo(
    target,
    { scale: 1 },
    {
      scale: 1.08,
      duration: 0.8,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    }
  );
};

/**
 * Interactive button press / ripple feedback
 */
export const gsapButtonPress = (target: HTMLElement | null) => {
  if (!target) return;
  gsap.timeline()
    .to(target, { scale: 0.96, duration: 0.08, ease: 'power1.in' })
    .to(target, { scale: 1, duration: 0.18, ease: 'back.out(2)' });
};

/**
 * Custom React Hook: Scope GSAP animations cleanly with automatic cleanup
 */
export function useGsapContext(
  animationCallback: (ctx: gsap.Context) => void,
  dependencies: React.DependencyList = []
) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(animationCallback, containerRef);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return containerRef;
}

/**
 * Custom React Hook: Fade and rise on mount or dependency change
 */
export function useGsapFadeIn<T extends HTMLElement = HTMLDivElement>(
  dependencies: React.DependencyList = [],
  options?: { y?: number; duration?: number; delay?: number }
) {
  const elementRef = useRef<T | null>(null);

  useEffect(() => {
    if (!elementRef.current) return;
    const ctx = gsap.context(() => {
      gsapFadeIn(elementRef.current!, options);
    });
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return elementRef;
}

/**
 * Custom React Hook: Stagger animate child elements matching a CSS selector
 */
export function useGsapStagger<T extends HTMLElement = HTMLDivElement>(
  itemSelector: string,
  dependencies: React.DependencyList = [],
  options?: { stagger?: number; y?: number; duration?: number; delay?: number }
) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      const items = containerRef.current?.querySelectorAll(itemSelector);
      if (items && items.length > 0) {
        gsapStaggerIn(items, options);
      }
    }, containerRef);

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return containerRef;
}

export { gsap };
