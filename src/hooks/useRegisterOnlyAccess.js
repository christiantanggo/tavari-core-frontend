// hooks/useRegisterOnlyAccess.js
// Helper hook to detect if user has register-only access (unlocked with PIN but not full app access)
// This allows screens to show "Return to Register" button instead of "Return to Dashboard"

import { useMemo } from 'react';

export const useRegisterOnlyAccess = () => {
  const hasRegisterOnlyAccess = useMemo(() => {
    try {
      const posActiveUserRaw = localStorage.getItem('posActiveUser');
      if (!posActiveUserRaw) return false;
      
      const posActiveUser = JSON.parse(posActiveUserRaw);
      // If posActiveUser exists and was set by register unlock, user has register-only access
      // The source is set to 'register_pin' when the register is unlocked via PIN
      return posActiveUser?.source === 'register_pin' || posActiveUser?.source === 'register';
    } catch {
      return false;
    }
  }, []);

  return {
    hasRegisterOnlyAccess
  };
};

