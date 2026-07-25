// Step 70: Create useAppBuilderPermissions hook
// Hook for permission checks
import { useMemo } from 'react';
import { usePOSAuth } from './usePOSAuth';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderPermissions = () => {
  const { userRole } = usePOSAuth({ requireBusiness: true });
  const { selectedBusinessId } = useBusinessContext();

  const permissions = useMemo(() => {
    if (!userRole || !selectedBusinessId) {
      return {
        canManageBranding: false,
        canToggleModules: false,
        canBuildApp: false,
        canDeployApp: false,
        canViewAnalytics: false
      };
    }

    const isOwner = userRole === 'owner';
    const isAdmin = userRole === 'admin';
    const isManager = userRole === 'manager';
    const isElevated = isOwner || isAdmin || isManager;

    return {
      canManageBranding: isElevated,
      canToggleModules: isElevated,
      canBuildApp: isElevated,
      canDeployApp: isElevated,
      canViewAnalytics: true, // All business members can view analytics
      canManageWebhooks: isOwner // Only owners can manage webhooks
    };
  }, [userRole, selectedBusinessId]);

  return permissions;
};




