// Step 66: Create waiverSignatureCapture.js
// Signature capture utilities using HTML5 canvas
import { supabase } from '../supabaseClient';

/**
 * Capture signature from canvas element
 */
export const captureSignature = (canvasRef) => {
  if (!canvasRef || !canvasRef.current) {
    throw new Error('Canvas reference is required');
  }

  const canvas = canvasRef.current;
  const dataURL = canvas.toDataURL('image/png');

  return {
    imageUrl: dataURL,
    imageData: dataURL,
    width: canvas.width,
    height: canvas.height
  };
};

/**
 * Save signature image to Supabase Storage
 */
export const saveSignatureImage = async (signatureData, businessId, waiverId) => {
  try {
    const response = await fetch(signatureData.imageUrl);
    const blob = await response.blob();

    const filePath = `signatures/${businessId}/${waiverId}-${Date.now()}.png`;

    const { data, error } = await supabase.storage.from('waivers').upload(filePath, blob, {
      contentType: 'image/png',
      upsert: false
    });

    if (error) {
      throw error;
    }

    const { data: urlData } = supabase.storage.from('waivers').getPublicUrl(filePath);

    return {
      filePath,
      publicUrl: urlData.publicUrl,
      signedUrl: null
    };
  } catch (error) {
    console.error('Error saving signature image:', error);
    throw error;
  }
};

/**
 * Validate signature (check if canvas has content)
 */
export const validateSignature = (canvasRef) => {
  if (!canvasRef || !canvasRef.current) {
    return { valid: false, error: 'Canvas not initialized' };
  }

  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let hasContent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      hasContent = true;
      break;
    }
  }

  if (!hasContent) {
    return { valid: false, error: 'Signature is required' };
  }

  return { valid: true };
};

/**
 * Clear signature canvas
 */
export const clearSignature = (canvasRef) => {
  if (!canvasRef || !canvasRef.current) {
    return;
  }

  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

/**
 * Initialize signature canvas: size buffer to match displayed area (full container width),
 * handle devicePixelRatio, and map pointer coordinates in CSS pixels.
 *
 * @param {React.RefObject<HTMLCanvasElement>} canvasRef
 * @param {React.RefObject<HTMLElement>|null} containerRef - element whose width drives the canvas (usually the bordered box)
 * @param {object} [options]
 * @param {number} [options.cssHeight=200] - CSS height in px
 * @returns {() => void} cleanup
 */
export const initializeSignatureCanvas = (canvasRef, containerRef, options = {}) => {
  if (!canvasRef || !canvasRef.current) {
    return () => {};
  }

  const canvas = canvasRef.current;
  const cssHeight = options.cssHeight ?? 200;
  const strokeColor = options.strokeColor || '#000000';
  const lineWidth = options.lineWidth || 2;

  let ctx = null;
  let cssW = 400;
  let cssH = cssHeight;
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let lastAppliedW = 0;
  let lastAppliedH = 0;

  const getWrap = () =>
    (containerRef && containerRef.current) || canvas.parentElement;

  const applySize = () => {
    const wrap = getWrap();
    const rawW = Math.floor(wrap?.clientWidth || canvas.getBoundingClientRect().width || 0);
    const w = Math.max(2, rawW > 0 ? rawW : 400);
    const h = cssHeight;
    if (w === lastAppliedW && h === lastAppliedH && ctx) {
      return;
    }
    lastAppliedW = w;
    lastAppliedH = h;
    cssW = w;
    cssH = h;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = '100%';
    canvas.style.height = `${h}px`;
    canvas.style.maxWidth = 'none';

    ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  /** Map viewport coords to CSS-pixel drawing coords (0..cssW, 0..cssH) */
  const displayToCanvas = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(cssW, clientX - rect.left));
    const y = Math.max(0, Math.min(cssH, clientY - rect.top));
    return { x, y };
  };

  const startDrawing = (e) => {
    if (!ctx) return;
    isDrawing = true;
    const { x, y } = displayToCanvas(e.clientX, e.clientY);
    lastX = x;
    lastY = y;
  };

  const draw = (e) => {
    if (!isDrawing || !ctx) return;
    const { x: currentX, y: currentY } = displayToCanvas(e.clientX, e.clientY);

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    lastX = currentX;
    lastY = currentY;
  };

  const stopDrawing = () => {
    isDrawing = false;
  };

  const startDrawingTouch = (e) => {
    e.preventDefault();
    if (!ctx) return;
    const touch = e.touches[0];
    if (!touch) return;
    const { x, y } = displayToCanvas(touch.clientX, touch.clientY);
    lastX = x;
    lastY = y;
    isDrawing = true;
  };

  const drawTouch = (e) => {
    e.preventDefault();
    if (!isDrawing || !ctx) return;
    const touch = e.touches[0];
    if (!touch) return;
    const { x: currentX, y: currentY } = displayToCanvas(touch.clientX, touch.clientY);

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    lastX = currentX;
    lastY = currentY;
  };

  const stopDrawingTouch = () => {
    isDrawing = false;
  };

  const attachListeners = () => {
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    canvas.addEventListener('touchstart', startDrawingTouch, { passive: false });
    canvas.addEventListener('touchmove', drawTouch, { passive: false });
    canvas.addEventListener('touchend', stopDrawingTouch);
  };

  const detachListeners = () => {
    canvas.removeEventListener('mousedown', startDrawing);
    canvas.removeEventListener('mousemove', draw);
    canvas.removeEventListener('mouseup', stopDrawing);
    canvas.removeEventListener('mouseout', stopDrawing);

    canvas.removeEventListener('touchstart', startDrawingTouch);
    canvas.removeEventListener('touchmove', drawTouch);
    canvas.removeEventListener('touchend', stopDrawingTouch);
  };

  let ro = null;
  let rafScheduled = false;

  const scheduleSync = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      applySize();
    });
  };

  applySize();
  attachListeners();

  const wrap = getWrap();
  if (wrap && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => scheduleSync());
    ro.observe(wrap);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', scheduleSync);
  }

  return () => {
    detachListeners();
    if (ro) ro.disconnect();
    if (typeof window !== 'undefined' && !ro) {
      window.removeEventListener('resize', scheduleSync);
    }
  };
};
