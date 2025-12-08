import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [managerLocked, setManagerLocked] = useState(false);
  const [lockReason, setLockReason] = useState('');

  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase.auth.getSession();
      const session = data?.session;


      setSession(session || null);

      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from('users')
          .select('id, email, roles, full_name')
          .eq('id', session.user.id)
          .maybeSingle();

        setUserProfile(profile);
      }

      setLoading(false);
    };

    init();
  }, []);

  const lockApp = (reason = 'Manager has locked the application') => {
    setManagerLocked(true);
    setLockReason(reason);
  };

  const unlockApp = () => {
    setManagerLocked(false);
    setLockReason('');
  };

  return (
    <UserContext.Provider value={{ 
      session, 
      userProfile, 
      loading, 
      managerLocked, 
      lockReason, 
      lockApp, 
      unlockApp 
    }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
