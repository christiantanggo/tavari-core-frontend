import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { getPublicUserId } from '../utils/getPublicUserId';

export function useUserProfile() {
  const [profile, setProfile] = useState(null);
  const [roleInfo, setRoleInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user }, error: sessionError } = await supabase.auth.getUser();

      if (sessionError || !user) {
        setLoading(false);
        return;
      }

      const publicUserId = (await getPublicUserId(user.email)) || user.id;

      const { data: profileData } = await supabase
        .from('users')
        .select('*')
        .eq('id', publicUserId)
        .maybeSingle();

      setProfile(profileData || null);
      setRoleInfo(null);
      setLoading(false);
    };

    fetchProfile();
  }, []);

  return { profile, roleInfo, loading };
}
