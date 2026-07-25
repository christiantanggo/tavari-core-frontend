import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { sessionPersistence } from '../services/SessionPersistence';
import { isBrowserStaffSession } from '../utils/staffSessionContext';

const SessionManager = ({ children }) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isBrowserStaffSession()) {
      return undefined;
    }

    let cancelled = false;

    const refreshToken = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled || !session?.refresh_token) {
          return;
        }
        localStorage.setItem('stayLoggedIn', 'true');
        sessionPersistence.startAutoRefresh();
        await sessionPersistence.refreshToken();
      } catch (err) {
        console.warn('Session refresh failed (ignored):', err.message);
      }
    };

    refreshToken();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return children;
};

export default SessionManager;
