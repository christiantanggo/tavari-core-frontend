const SELECTED_PROFILE_KEY = 'employeePortalSelectedProfile';
const AVAILABLE_PROFILES_KEY = 'employeePortalAvailableProfiles';

export const setEmployeePortalProfiles = (profiles = []) => {
  localStorage.setItem(AVAILABLE_PROFILES_KEY, JSON.stringify(profiles || []));
};

export const getEmployeePortalProfiles = () => {
  try {
    return JSON.parse(localStorage.getItem(AVAILABLE_PROFILES_KEY) || '[]');
  } catch {
    return [];
  }
};

export const setEmployeePortalSelectedProfile = (profile) => {
  if (!profile) return;
  localStorage.setItem(SELECTED_PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event('employee-profile-selection-changed'));
};

export const getEmployeePortalSelectedProfile = () => {
  try {
    return JSON.parse(localStorage.getItem(SELECTED_PROFILE_KEY) || 'null');
  } catch {
    return null;
  }
};

export const getEmployeePortalSelectedBusinessId = () => {
  return getEmployeePortalSelectedProfile()?.business_id || null;
};

export const clearEmployeePortalProfileSelection = () => {
  localStorage.removeItem(SELECTED_PROFILE_KEY);
  localStorage.removeItem(AVAILABLE_PROFILES_KEY);
  window.dispatchEvent(new Event('employee-profile-selection-changed'));
};

export const loadEmployeePortalBusinessProfiles = async (supabase, publicUserId) => {
  if (!publicUserId) return [];

  const { data, error } = await supabase
    .from('business_users')
    .select('business_id, role, businesses:business_id(id, name)')
    .eq('user_id', publicUserId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row) => ({
    employee_id: publicUserId,
    business_id: row.business_id,
    business_name: row.businesses?.name || 'Business',
    role: row.role || 'employee',
  }));
};

export const ensureEmployeePortalSelectedProfile = (profiles = []) => {
  const current = getEmployeePortalSelectedProfile();
  const match = profiles.find((profile) =>
    profile.business_id === current?.business_id &&
    profile.employee_id === current?.employee_id
  );

  if (match) return match;
  if (profiles.length > 0) {
    setEmployeePortalProfiles(profiles);
    setEmployeePortalSelectedProfile(profiles[0]);
    return profiles[0];
  }
  return null;
};
