import toast from 'react-hot-toast';

/**
 * Open HTML in a new window (or hidden iframe fallback) and trigger the browser print dialog.
 * Avoid `noopener` on window.open — it prevents document.write and yields a blank tab.
 */
export function printHtmlInNewWindow(html) {
  if (!html?.trim()) {
    toast.error('Nothing to print — the form content was empty.');
    return false;
  }

  const printWindow = window.open('', '_blank', 'width=960,height=900');
  if (printWindow) {
    try {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      schedulePrint(printWindow);
      return true;
    } catch (error) {
      console.warn('[printHtmlInNewWindow] popup write failed, using iframe fallback', error);
      try {
        printWindow.close();
      } catch {
        /* ignore */
      }
    }
  }

  return printViaHiddenIframe(html);
}

function schedulePrint(targetWindow) {
  const triggerPrint = () => {
    try {
      targetWindow.focus();
      targetWindow.print();
    } catch {
      /* ignore */
    }
  };

  if (targetWindow.document?.readyState === 'complete') {
    setTimeout(triggerPrint, 300);
  } else {
    targetWindow.onload = () => setTimeout(triggerPrint, 300);
  }
}

function printViaHiddenIframe(html) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Camper registration print');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    width: '816px',
    height: '12000px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win?.document;
  if (!win || !doc) {
    cleanup();
    toast.error('Could not open print preview.');
    return false;
  }

  try {
    doc.open();
    doc.write(html);
    doc.close();
  } catch (error) {
    console.error('[printHtmlInNewWindow] iframe write failed', error);
    cleanup();
    toast.error('Could not load the form for printing.');
    return false;
  }

  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } finally {
      setTimeout(cleanup, 2000);
    }
  }, 350);

  return true;
}
