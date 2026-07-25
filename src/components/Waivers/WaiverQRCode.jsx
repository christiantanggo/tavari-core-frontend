// Step 100: Create WaiverQRCode.jsx
// QR code display and scanner for waivers
import React, { useState, useEffect, useRef } from 'react';
import { FiMaximize2, FiDownload, FiCopy } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const WaiverQRCode = ({ waiverId, businessId, signatureToken, onScan }) => {
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (showQR && waiverId && businessId) {
      generateQRCode();
    }
  }, [showQR, waiverId, businessId]);

  const generateQRCode = () => {
    // Generate QR code format: WV-{business_id}-{waiver_id}-{hash}
    const qrData = `WV-${businessId.substring(0, 8)}-${waiverId.substring(0, 8)}-${signatureToken || 'TOKEN'}`;
    
    // Use a QR code library (like qrcode.react or similar)
    // For now, create a simple text representation
    // In production, use a proper QR code library
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Simple placeholder - would use QR code library
      ctx.fillStyle = '#000';
      ctx.font = '12px monospace';
      ctx.fillText(qrData, 10, 20);
    }

    // Store QR code data URL
    if (canvas) {
      setQrCodeUrl(canvas.toDataURL('image/png'));
    }
  };

  const handleCopy = () => {
    const qrData = `WV-${businessId.substring(0, 8)}-${waiverId.substring(0, 8)}-${signatureToken || 'TOKEN'}`;
    navigator.clipboard.writeText(qrData);
    toast.success('QR code data copied to clipboard');
  };

  const handleDownload = () => {
    if (qrCodeUrl) {
      const link = document.createElement('a');
      link.href = qrCodeUrl;
      link.download = `waiver-${waiverId}-qr.png`;
      link.click();
      toast.success('QR code downloaded');
    }
  };

  return (
    <div style={styles.container}>
      <button
        onClick={() => setShowQR(!showQR)}
        style={styles.toggleButton}
      >
        <FiMaximize2 /> {showQR ? 'Hide' : 'Show'} QR Code
      </button>

      {showQR && (
        <div style={styles.qrContainer}>
          <canvas
            ref={canvasRef}
            width={200}
            height={200}
            style={styles.qrCanvas}
          />
          <div style={styles.qrActions}>
            <button onClick={handleCopy} style={styles.actionButton}>
              <FiCopy /> Copy
            </button>
            <button onClick={handleDownload} style={styles.actionButton}>
              <FiDownload /> Download
            </button>
          </div>
          <p style={styles.qrHint}>
            Scan this QR code to quickly access the waiver
          </p>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    marginBottom: TavariStyles.spacing.md
  },
  toggleButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  qrContainer: {
    marginTop: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    textAlign: 'center'
  },
  qrCanvas: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    marginBottom: TavariStyles.spacing.md
  },
  qrActions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    justifyContent: 'center',
    marginBottom: TavariStyles.spacing.sm
  },
  actionButton: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    backgroundColor: TavariStyles.colors.gray100,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  qrHint: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    margin: 0,
    fontStyle: 'italic'
  }
};

export default WaiverQRCode;

