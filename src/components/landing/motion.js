import { useEffect, useRef, useState } from 'react';

// Small, dependency-free motion helpers for the landing page. Every effect here
// animates transform/opacity (or a CSS custom property read by one), checks the
// reduced-motion preference first, and stops working when its element is off
// screen or the tab is hidden.

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => (canMatch() ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!canMatch()) return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
};

export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

// Heavy parallax, tilt and spotlight only where a real cursor exists.
export const useFinePointer = () => useMediaQuery('(hover: hover) and (pointer: fine)');

// One IntersectionObserver for every `[data-reveal]` inside the root. It sets
// `data-in` once and stops watching, so a reveal never replays. (An attribute,
// not a class: React rewrites `className` on re-render and would drop it.) Without an
// observer (or with reduced motion) nothing is ever hidden: the CSS only hides
// reveal targets while the root carries data-motion="on".
export const useRevealObserver = (rootRef, enabled) => {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-in', '');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
    root.querySelectorAll('[data-reveal]').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [rootRef, enabled]);
};

// True while the element is on screen (and the tab visible). Used to pause
// looping micro-animations and pointer work.
export const useInView = (ref, { rootMargin = '0px', threshold = 0 } = {}) => {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    let visible = false;
    let tabVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const sync = () => setInView(visible && tabVisible);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }, { rootMargin, threshold });
    const onVisibility = () => {
      tabVisible = document.visibilityState !== 'hidden';
      sync();
    };
    observer.observe(node);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ref, rootMargin, threshold]);
  return inView;
};

// Writes the pointer position over `ref` into --px/--py (-1..1) and --mx/--my
// (pixels) on that element, once per frame. Children read them for parallax,
// tilt, and the spotlight border.
export const usePointerField = (ref, enabled) => {
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return undefined;
    let frame = 0;
    let last = null;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const rect = node.getBoundingClientRect();
      const x = last.clientX - rect.left;
      const y = last.clientY - rect.top;
      node.style.setProperty('--mx', `${x}px`);
      node.style.setProperty('--my', `${y}px`);
      node.style.setProperty('--px', ((x / rect.width) * 2 - 1).toFixed(3));
      node.style.setProperty('--py', ((y / rect.height) * 2 - 1).toFixed(3));
    };
    const onMove = (event) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      last = null;
      node.style.setProperty('--px', '0');
      node.style.setProperty('--py', '0');
    };
    node.addEventListener('pointermove', onMove, { passive: true });
    node.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      node.style.removeProperty('--px');
      node.style.removeProperty('--py');
    };
  }, [ref, enabled]);
};

// A button that leans a few pixels toward the cursor and settles back on leave.
export const useMagnetic = (enabled, strength = 0.28) => {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return undefined;
    let frame = 0;
    const onMove = (event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) * strength;
        const dy = (event.clientY - (rect.top + rect.height / 2)) * strength;
        node.style.setProperty('--mag-x', `${Math.max(-10, Math.min(10, dx)).toFixed(1)}px`);
        node.style.setProperty('--mag-y', `${Math.max(-8, Math.min(8, dy)).toFixed(1)}px`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      node.style.setProperty('--mag-x', '0px');
      node.style.setProperty('--mag-y', '0px');
    };
    node.addEventListener('pointermove', onMove, { passive: true });
    node.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
    };
  }, [enabled, strength]);
  return ref;
};

// Counts from 0 to `value` once the element is in view. The final number is the
// server-rendered and reduced-motion value, so the fact is never hidden.
export const useCountUp = (value, { run, duration = 1100 } = {}) => {
  const [display, setDisplay] = useState(value);
  const doneRef = useRef(false);
  useEffect(() => {
    if (!run || doneRef.current) return undefined;
    doneRef.current = true;
    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 4;
      setDisplay(Math.round(eased * value));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, value, duration]);
  return display;
};

// Scroll progress (0..1) of an element through the viewport, written to a CSS
// custom property on that element. Only listens while the element is on screen.
export const useScrollProgress = (ref, { enabled, property = '--progress' } = {}) => {
  const inView = useInView(ref, { rootMargin: '10% 0px 10% 0px' });
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || !inView) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const travelled = viewport * 0.5 - rect.top;
      const progress = Math.max(0, Math.min(1, travelled / Math.max(1, rect.height)));
      node.style.setProperty(property, progress.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref, enabled, inView, property]);
  return inView;
};
