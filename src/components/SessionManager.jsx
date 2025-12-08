import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { sessionPersistence } from '../services/SessionPersistence';

const SessionManager = ({ children }) => {
  const navigate = useNavigate();

  useEffect(() => {
    // BULLETPROOF: KEEP SESSION ALIVE FOREVER
    // Force stayLoggedIn to be true
    localStorage.setItem('stayLoggedIn', 'true');
    
    const refreshToken = async () => {
      try {
        await sessionPersistence.refreshToken();
      } catch (err) {
        console.warn('Session refresh failed (ignored):', err.message);
      }
    };

    // Ensure the persistence service is actively refreshing
    sessionPersistence.startAutoRefresh();
    refreshToken();

    return () => {
      // SessionPersistence manages its own timers; nothing to clean up here
    };
  }, [navigate]);

  return children;
};

export default SessionManager;
