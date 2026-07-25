import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { usePermissions } from './usePermissions';
import { useModulesEnabled } from './useModuleEnabled';
import { buildNavigationContext } from '../utils/buildAiChatNavigationContext';

const MODULE_KEYS = [
  'pos', 'music', 'mail', 'hr', 'recipe_builder', 'scheduling', 'loyalty', 'digital_signage',
  'dining', 'bookings', 'liquor', 'vending', 'power_bank', 'inbox', 'appbuilder', 'waivers',
  'social_media', 'voice_agent', 'custom_voice_agent', 'accounting', 'file_storage',
  'reputation', 'tasks', 'forms', 'reminders', 'tavari_apis', 'invoices', 'funding',
];

/** Builds per-user navigation context for Tavari AI Help (visible nav + enabled modules). */
export function useAiChatNavigationContext() {
  const location = useLocation();
  const {
    hasPermission,
    hasAnyPermission,
    userRole,
    loading: permissionsLoading,
  } = usePermissions();
  const { modules: enabledModules, loading: modulesLoading } = useModulesEnabled(MODULE_KEYS);

  return useMemo(
    () =>
      buildNavigationContext({
        pathname: location.pathname,
        enabledModules: enabledModules || {},
        userRole,
        hasPermission,
        hasAnyPermission,
        permissionsLoading,
        modulesLoading,
      }),
    [
      location.pathname,
      enabledModules,
      userRole,
      hasPermission,
      hasAnyPermission,
      permissionsLoading,
      modulesLoading,
    ]
  );
}
