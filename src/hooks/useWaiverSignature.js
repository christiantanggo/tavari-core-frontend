// Step 59: Create useWaiverSignature hook
// Hook for waiver signature operations
import { useState, useEffect, useCallback } from 'react';
import WaiverSignatureService from '../services/Waivers/WaiverSignatureService';
import WaiversService from '../services/Waivers/WaiversService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useWaiverSignature = (waiverId) => {
  const { selectedBusinessId } = useBusinessContext();
  const [waiver, setWaiver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId || !waiverId) {
      setLoading(false);
      return;
    }

    WaiverSignatureService.setBusinessId(selectedBusinessId);
    WaiversService.setBusinessId(selectedBusinessId);
    loadWaiver();
  }, [selectedBusinessId, waiverId]);

  const loadWaiver = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await WaiversService.getWaiverById(waiverId);
      setWaiver(data);
      return data;
    } catch (err) {
      console.error('Error loading waiver:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const signWaiver = useCallback(async (signatureData) => {
    try {
      setError(null);
      const signed = await WaiverSignatureService.signWaiver(waiverId, signatureData);
      setWaiver(signed);
      return signed;
    } catch (err) {
      console.error('Error signing waiver:', err);
      setError(err.message);
      throw err;
    }
  }, [waiverId]);

  const authorizeDigitalSignature = useCallback(async (authorizationAcknowledged) => {
    try {
      setError(null);
      const result = await WaiverSignatureService.authorizeDigitalSignature(waiverId, authorizationAcknowledged);
      await loadWaiver();
      return result;
    } catch (err) {
      console.error('Error authorizing digital signature:', err);
      setError(err.message);
      throw err;
    }
  }, [waiverId]);

  const getPDF = useCallback(async () => {
    try {
      setError(null);
      const pdfUrl = await WaiverSignatureService.getWaiverPDFUrl(waiverId);
      return pdfUrl;
    } catch (err) {
      console.error('Error getting PDF:', err);
      setError(err.message);
      throw err;
    }
  }, [waiverId]);

  return {
    waiver,
    loading,
    error,
    signWaiver,
    authorizeDigitalSignature,
    getPDF,
    refresh: loadWaiver
  };
};

