/**
 * Opens the customer display in a browser popup (same origin → shared localStorage with POS).
 * Browsers always show chrome staff can close; for production use the Tavari Customer Display .exe.
 */
import toast from 'react-hot-toast';

const WINDOW_NAME = 'tavari-customer-display';
const DESKTOP_TIP_KEY = 'tavari_cd_desktop_tip_shown';

function buildCustomerDisplayUrl() {
  const origin = window.location.origin;
  return `${origin}/customer-display`;
}

/**
 * @param {{ tryFullscreen?: boolean, suppressDesktopTip?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string, window?: globalThis.Window | null }>}
 */
export async function openCustomerDisplayWindow(options = {}) {
  const { tryFullscreen = false, suppressDesktopTip = false } = options;
  const url = buildCustomerDisplayUrl();

  let left = 0;
  let top = 0;
  let width = window.screen.availWidth;
  let height = window.screen.availHeight;

  try {
    if (typeof window.getScreenDetails === 'function') {
      const details = await window.getScreenDetails();
      const screens = details?.screens || [];
      const secondary = screens.find((s) => s.isPrimary === false);
      const target = secondary || screens[0];
      if (target) {
        left = target.availLeft ?? target.left ?? 0;
        top = target.availTop ?? target.top ?? 0;
        width = target.availWidth ?? target.width ?? width;
        height = target.availHeight ?? target.height ?? height;
      }
    }
  } catch {
    /* Permission denied or unsupported — fall back to primary metrics */
  }

  const features = [
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    `width=${Math.round(width)}`,
    `height=${Math.round(height)}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'scrollbars=no',
    'resizable=yes'
  ].join(',');

  const w = window.open(url, WINDOW_NAME, features);
  if (!w) {
    return { ok: false, reason: 'popup_blocked' };
  }

  try {
    w.focus();
  } catch {
    /* ignore */
  }

  if (!suppressDesktopTip) {
    try {
      if (!sessionStorage.getItem(DESKTOP_TIP_KEY)) {
        sessionStorage.setItem(DESKTOP_TIP_KEY, '1');
        toast(
          'For the customer monitor, use the Tavari Customer Display desktop app (npm run build-customer-display)—fullscreen, no browser bar or close button.',
          { duration: 8000 }
        );
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }

  if (tryFullscreen) {
    const attempt = () => {
      try {
        const doc = w.document?.documentElement;
        if (doc?.requestFullscreen) doc.requestFullscreen();
      } catch {
        /* ignore */
      }
    };
    try {
      w.addEventListener('load', () => setTimeout(attempt, 400));
    } catch {
      /* ignore */
    }
    setTimeout(attempt, 600);
    setTimeout(() => {
      try {
        if (w.moveTo) w.moveTo(0, 0);
        if (w.resizeTo) w.resizeTo(window.screen.width, window.screen.height);
      } catch {
        /* ignore */
      }
    }, 200);
  }

  return { ok: true, window: w };
}
