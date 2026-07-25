// Step 65: Create useAppBuilderPreview hook
// Hook for preview operations
import { useState, useEffect } from 'react';
import AppBuilderPreviewService from '../services/AppBuilder/AppBuilderPreviewService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderPreview = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      return;
    }

    AppBuilderPreviewService.setBusinessId(selectedBusinessId);
  }, [selectedBusinessId]);

  const createPreview = async (expiresInDays = 7) => {
    try {
      setLoading(true);
      setError(null);
      const preview = await AppBuilderPreviewService.createPreview(expiresInDays);
      setPreviewUrl(preview.preview_url);
      setQrCode(preview.qr_code_url);
      return preview;
    } catch (err) {
      console.error('Error creating preview:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const sharePreview = async (shareToken) => {
    try {
      setLoading(true);
      setError(null);
      const shareData = await AppBuilderPreviewService.sharePreview(shareToken);
      setPreviewUrl(shareData.url);
      setQrCode(shareData.qrCode);
      return shareData;
    } catch (err) {
      console.error('Error sharing preview:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    previewUrl,
    qrCode,
    loading,
    error,
    createPreview,
    sharePreview
  };
};




