import { useEffect, useCallback } from 'react';

const STYLE_ID = 'waiver-tablet-keyboard-inset-styles';

const FOCUS_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]';

function ensureGlobalStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    html.waiver-kb-vv-active {
      height: 100%;
    }
    body.waiver-kb-vv-active {
      min-height: 100%;
      padding-bottom: var(--waiver-kb-inset, 0px);
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(el);
}

/**
 * Tablets / phones with on-screen keyboards shrink the visual viewport; fixed-height layouts
 * leave inputs hidden unless the user scrolls. This hook:
 * - Sets --waiver-kb-inset from VisualViewport so body gains bottom padding while the keyboard is open.
 * - Scrolls focused fields into view after the keyboard animates.
 *
 * Mount only on customer-facing waiver routes (PublicWaiverFlow, BookingWaiverFlow).
 */
export function useWaiverTabletKeyboardInset(enabled = true) {
  const recalc = useCallback(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) {
      document.documentElement.style.setProperty('--waiver-kb-inset', '0px');
      document.documentElement.style.scrollPaddingBottom = '';
      return;
    }
    const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const px = `${overlap}px`;
    document.documentElement.style.setProperty('--waiver-kb-inset', px);
    document.documentElement.style.scrollPaddingBottom = overlap > 0 ? px : '';
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    ensureGlobalStyles();
    document.documentElement.classList.add('waiver-kb-vv-active');
    document.body.classList.add('waiver-kb-vv-active');

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', recalc);
      vv.addEventListener('scroll', recalc);
    }
    window.addEventListener('resize', recalc);
    recalc();

    const onFocusIn = (e) => {
      const t = e.target;
      if (!t || typeof t.matches !== 'function' || !t.matches(FOCUS_SELECTOR)) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            t.scrollIntoView({
              block: 'center',
              inline: 'nearest',
              behavior: 'smooth',
            });
          } catch {
            /* noop */
          }
        });
      });
    };
    document.addEventListener('focusin', onFocusIn, true);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', recalc);
        vv.removeEventListener('scroll', recalc);
      }
      window.removeEventListener('resize', recalc);
      document.removeEventListener('focusin', onFocusIn, true);
      document.documentElement.classList.remove('waiver-kb-vv-active');
      document.body.classList.remove('waiver-kb-vv-active');
      document.documentElement.style.removeProperty('--waiver-kb-inset');
      document.documentElement.style.scrollPaddingBottom = '';
    };
  }, [enabled, recalc]);
}
