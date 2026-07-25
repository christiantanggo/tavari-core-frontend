import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useUser } from './UserContext'; // Assuming you already have a UserContext
import { useBusinessContext } from './BusinessContext';

const RoleContext = createContext();

export const RoleProvider = ({ children }) => {
  const { session } = useUser();
  const [roleInfo, setRoleInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const { selectedBusinessId } = useBusinessContext();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    let isMounted = true;

    const fetchRole = async () => {
      if (!userId || !selectedBusinessId) {
        if (isMounted) {
          setRoleInfo(null);
          setLoading(false);
        }
        return;
      }

      if (isMounted) {
        setLoading(true);
      }

      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', userId)
          .eq('business_id', selectedBusinessId)
          .eq('active', true)
          .maybeSingle();

        if (!isMounted) return;

        if (error) {
          console.error('Error fetching role info:', error);
          setRoleInfo(null);
        } else {
          setRoleInfo(data);
        }
      } catch (err) {
        console.error('Unexpected error fetching role info:', err);
        if (isMounted) {
          setRoleInfo(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchRole();

    return () => {
      isMounted = false;
    };
  }, [userId, selectedBusinessId]);

  return (
    <RoleContext.Provider value={{ roleInfo, loading }}>
      {children}
    </RoleContext.Provider>
  );
};

export const useRole = () => useContext(RoleContext);
