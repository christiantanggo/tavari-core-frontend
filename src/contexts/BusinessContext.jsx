import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const BusinessContext = createContext();

export const BusinessProvider = ({ children }) => {
  const [selectedBusinessId, setSelectedBusinessId] = useState(null);
  const [selectedBusiness, setSelectedBusiness] = useState(null);

  // Load previously selected business from localStorage (if any)
  useEffect(() => {
    const stored =
      localStorage.getItem('tavariPinnedBusinessId') ||
      localStorage.getItem('selectedBusinessId') ||
      localStorage.getItem('currentBusinessId');
    if (stored) {
      setSelectedBusinessId(stored);
    }
  }, []);

  // Update localStorage when business changes
  useEffect(() => {
    if (selectedBusinessId) {
      localStorage.setItem('tavariPinnedBusinessId', selectedBusinessId);
      localStorage.setItem('selectedBusinessId', selectedBusinessId);
      localStorage.setItem('currentBusinessId', selectedBusinessId);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    let isMounted = true;

    const loadBusiness = async () => {
      if (!selectedBusinessId) {
        if (isMounted) {
          setSelectedBusiness(null);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('id, name, timezone')
          .eq('id', selectedBusinessId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (isMounted) {
          setSelectedBusiness(data || { id: selectedBusinessId, timezone: 'America/Toronto' });
        }
      } catch (error) {
        console.warn('Failed to load selected business context:', error);
        if (isMounted) {
          setSelectedBusiness({ id: selectedBusinessId, timezone: 'America/Toronto' });
        }
      }
    };

    loadBusiness();

    return () => {
      isMounted = false;
    };
  }, [selectedBusinessId]);

  return (
    <BusinessContext.Provider value={{ selectedBusinessId, setSelectedBusinessId, selectedBusiness }}>
      {children}
    </BusinessContext.Provider>
  );
};

export const useBusiness = () => {
  const { selectedBusinessId, setSelectedBusinessId, selectedBusiness } = useContext(BusinessContext);
  return {
    business: selectedBusiness || { id: selectedBusinessId, timezone: 'America/Toronto' },
    setBusiness: setSelectedBusinessId,
  };
};

export const useBusinessContext = () => useContext(BusinessContext);