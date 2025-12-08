import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useUser } from './UserContext'; // Assuming you already have a UserContext
import { useBusinessContext } from './BusinessContext';

const RoleContext = createContext();

export const RoleProvider = ({ children }) => {
  const { user } = useUser();
  const [roleInfo, setRoleInfo] = useState(null);
  const [loading, setLoading] = useState(true);
const { selectedBusinessId } = useBusinessContext();

  const fetchRole = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', user.id)
        .eq('business_id', selectedBusinessId)
        .eq('active', true)
        .maybeSingle();

      if (error) {
        console.error('Error fetching role info:', error);
        setRoleInfo(null);
      } else {
        setRoleInfo(data);
      }
    } catch (err) {
      console.error('Unexpected error fetching role info:', err);
      setRoleInfo(null);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchRole();
  }, [user, selectedBusinessId]);

  return (
    <RoleContext.Provider value={{ roleInfo, loading }}>
      {children}
    </RoleContext.Provider>
  );
};

export const useRole = () => useContext(RoleContext);
