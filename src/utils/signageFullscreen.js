/** Browser fullscreen helpers for the public signage player. */

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  );
}

export function isSignageFullscreen() {
  return Boolean(getFullscreenElement());
}

export async function requestSignageFullscreen() {
  if (isSignageFullscreen()) return true;

  const el = document.documentElement;
  const request =
    el.requestFullscreen?.bind(el) ||
    el.webkitRequestFullscreen?.bind(el) ||
    el.mozRequestFullScreen?.bind(el) ||
    el.msRequestFullscreen?.bind(el);

  if (!request) return false;

  try {
    await request();
    return isSignageFullscreen();
  } catch {
    return false;
  }
}

export async function exitSignageFullscreen() {
  if (!isSignageFullscreen()) return;

  const exit =
    document.exitFullscreen?.bind(document) ||
    document.webkitExitFullscreen?.bind(document) ||
    document.mozCancelFullScreen?.bind(document) ||
    document.msExitFullscreen?.bind(document);

  if (!exit) return;

  try {
    await exit();
  } catch {
    /* ignore */
  }
}
