// Step 60: Create useWaiverMatch hook
// Hook for waiver matching operations
import { useState, useCallback, useEffect } from 'react';
import WaiversService from '../services/Waivers/WaiversService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useWaiverMatch = (firstName, lastName, phone, email, dob) => {
  const { selectedBusinessId } = useBusinessContext();
  const [matchedWaivers, setMatchedWaivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId || !firstName || !lastName) {
      setMatchedWaivers([]);
      return;
    }

    // Debounce matching - only match if we have at least name
    const timeoutId = setTimeout(() => {
      matchWaiver();
    }, 300); // Wait 300ms after user stops typing

    return () => clearTimeout(timeoutId);
  }, [selectedBusinessId, firstName, lastName, phone, email, dob]);

  const matchWaiver = useCallback(async () => {
    if (!selectedBusinessId || !firstName || !lastName) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const matches = await WaiversService.matchWaiver(
        firstName,
        lastName,
        phone || null,
        email || null,
        dob || null
      );
      setMatchedWaivers(matches || []);
    } catch (err) {
      console.error('Error matching waiver:', err);
      setError(err.message);
      setMatchedWaivers([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, firstName, lastName, phone, email, dob]);

  return {
    matchedWaivers,
    loading,
    error,
    matchWaiver
  };
};




