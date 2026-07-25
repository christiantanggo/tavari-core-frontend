// Step 92: Create WaiverSignatureCapture.jsx
// Signature capture component using HTML5 canvas
import React, { useRef, useLayoutEffect, useState, useEffect } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { initializeSignatureCanvas, captureSignature, clearSignature, validateSignature } from '../../utils/waiverSignatureCapture';
import TavariCheckbox from '../UI/TavariCheckbox';

const WaiverSignatureCapture = ({
  onSignatureCaptured,
  onClear,
  required = true,
  label = 'Signature',
  onSignatureStateChange,
  showAuthorizationPrompt = false,
  onDismissAuthorizationPrompt
}) => {
  const canvasRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const authorizationRef = useRef(null);
  const lastEmittedImageUrlRef = useRef(undefined);
  const [hasSignature, setHasSignature] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useLayoutEffect(() => {
    if (!canvasRef.current || !canvasContainerRef.current) return undefined;
    return initializeSignatureCanvas(canvasRef, canvasContainerRef, {
      cssHeight: 200,
      strokeColor: '#000000',
      lineWidth: 2
    });
  }, []);

  const handleClear = () => {
    if (canvasRef.current) {
      clearSignature(canvasRef);
      setHasSignature(false);
      lastEmittedImageUrlRef.current = undefined;
      if (onSignatureCaptured) onSignatureCaptured(null);
      if (onClear) onClear();
    }
  };

  const handleCanvasMouseUp = () => {
    // Check if canvas has content
    if (canvasRef.current) {
      const validation = validateSignature(canvasRef);
      setHasSignature(validation.valid);
    }
  };

  useEffect(() => {
    if (!onSignatureCaptured || !canvasRef.current) return;

    let payload = null;

    if (hasSignature && (!required || authorized)) {
      const validation = validateSignature(canvasRef);
      if (validation.valid) {
        payload = captureSignature(canvasRef);
      }
    }

    const nextImageUrl = payload?.imageUrl ?? null;
    if (lastEmittedImageUrlRef.current === nextImageUrl) return;

    lastEmittedImageUrlRef.current = nextImageUrl;
    onSignatureCaptured(payload);
  }, [authorized, hasSignature, onSignatureCaptured, required]);

  useEffect(() => {
    if (typeof onSignatureStateChange === 'function') {
      onSignatureStateChange({
        hasSignature,
        authorized,
        ready: hasSignature && (!required || authorized)
      });
    }
  }, [authorized, hasSignature, onSignatureStateChange, required]);

  useEffect(() => {
    if (showAuthorizationPrompt && authorizationRef.current) {
      authorizationRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [showAuthorizationPrompt]);

  return (
    <div style={styles.container}>
      <label style={styles.label}>
        {label}
        {required && <span style={styles.required}>*</span>}
      </label>
      
      <div style={styles.canvasContainer}>
        <div ref={canvasContainerRef} style={styles.canvasInner}>
          <canvas
            ref={canvasRef}
            style={styles.canvas}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onTouchEnd={handleCanvasMouseUp}
            onTouchCancel={handleCanvasMouseUp}
          />
        </div>
      </div>

      {required && (
        <div
          ref={authorizationRef}
          style={{
            ...styles.authorization,
            ...(showAuthorizationPrompt ? styles.authorizationHighlighted : {})
          }}
        >
          {showAuthorizationPrompt && (
            <div style={styles.authorizationPrompt} role="alert">
              <div style={styles.authorizationPromptArrow} />
              <div>Please check this box to authorize your electronic signature before continuing.</div>
            </div>
          )}
          <TavariCheckbox
            checked={authorized}
            onChange={(checked) => {
              setAuthorized(checked);
              if (checked && typeof onDismissAuthorizationPrompt === 'function') {
                onDismissAuthorizationPrompt();
              }
            }}
            label="I acknowledge that this is my digital signature and has the same legal effect as a handwritten signature"
            size="md"
          />
        </div>
      )}

      <div style={styles.controls}>
        <button
          type="button"
          onClick={handleClear}
          style={styles.clearButton}
        >
          <FiX /> Clear
        </button>
      </div>

      {!hasSignature && required && (
        <p style={styles.hint}>Please sign above</p>
      )}
    </div>
  );
};

const styles = {
  container: {
    marginBottom: TavariStyles.spacing.lg
  },
  label: {
    display: 'block',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.sm
  },
  required: {
    color: TavariStyles.colors.error,
    marginLeft: '4px'
  },
  canvasContainer: {
    width: '100%',
    boxSizing: 'border-box',
    border: `2px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.white,
    marginBottom: TavariStyles.spacing.sm
  },
  canvasInner: {
    width: '100%',
    minWidth: 0
  },
  canvas: {
    width: '100%',
    height: '200px',
    cursor: 'crosshair',
    display: 'block',
    touchAction: 'none',
    verticalAlign: 'top'
  },
  controls: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.sm
  },
  clearButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.gray200,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  authorization: {
    marginBottom: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.sm,
    position: 'relative',
    scrollMarginTop: '120px'
  },
  authorizationHighlighted: {
    border: `2px solid ${TavariStyles.colors.primary}`,
    boxShadow: '0 0 0 4px rgba(0, 128, 128, 0.12)'
  },
  authorizationPrompt: {
    position: 'relative',
    marginBottom: TavariStyles.spacing.sm,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.sm,
    color: TavariStyles.colors.text,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    boxShadow: '0 6px 18px rgba(17, 24, 39, 0.08)'
  },
  authorizationPromptArrow: {
    position: 'absolute',
    left: '24px',
    bottom: '-8px',
    width: '14px',
    height: '14px',
    backgroundColor: TavariStyles.colors.white,
    borderLeft: `1px solid ${TavariStyles.colors.primary}`,
    borderBottom: `1px solid ${TavariStyles.colors.primary}`,
    transform: 'rotate(-45deg)'
  },
  hint: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs,
    fontStyle: 'italic'
  }
};

export default WaiverSignatureCapture;




