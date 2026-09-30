import { useEffect } from 'react';

/**
 * Body scroll lock for modal overlays.
 *
 * Ref-counted so stacked overlays (list dialog + nested form + global
 * confirm) don't fight: the lock is released only when the LAST overlay
 * unmounts, and body padding-right is compensated by the scrollbar width
 * to prevent layout shift while locked.
 */
let lockCount = 0;
let prevOverflow = '';
let prevPaddingRight = '';

const acquire = () => {
  if (lockCount++ > 0) return;
  prevOverflow = document.body.style.overflow;
  prevPaddingRight = document.body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
  document.body.style.overflow = 'hidden';
};

const release = () => {
  if (lockCount === 0) return;
  if (--lockCount > 0) return;
  document.body.style.overflow = prevOverflow;
  document.body.style.paddingRight = prevPaddingRight;
};

/** While `active` is true, the page behind the overlay cannot scroll. */
export const useBodyScrollLock = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
};
