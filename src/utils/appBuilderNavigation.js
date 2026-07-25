// Step 126: Create AppBuilder navigation helper
// Centralized navigation for app builder
import { useNavigate } from 'react-router-dom';

/**
 * Navigate to branding configuration
 */
export const navigateToBranding = (navigate) => {
  navigate('/dashboard/appbuilder/branding');
};

/**
 * Navigate to module management
 */
export const navigateToModules = (navigate) => {
  navigate('/dashboard/appbuilder/modules');
};

/**
 * Navigate to builds
 */
export const navigateToBuilds = (navigate) => {
  navigate('/dashboard/appbuilder/builds');
};

/**
 * Navigate to deployments
 */
export const navigateToDeployments = (navigate) => {
  navigate('/dashboard/appbuilder/deployments');
};

/**
 * Navigate to analytics
 */
export const navigateToAnalytics = (navigate) => {
  navigate('/dashboard/appbuilder/analytics');
};

/**
 * Navigate to AppBuilder dashboard
 */
export const navigateToAppBuilder = (navigate) => {
  navigate('/dashboard/appbuilder');
};

/**
 * Hook version for React components
 */
export const useAppBuilderNavigation = () => {
  const navigate = useNavigate();

  return {
    toBranding: () => navigateToBranding(navigate),
    toModules: () => navigateToModules(navigate),
    toBuilds: () => navigateToBuilds(navigate),
    toDeployments: () => navigateToDeployments(navigate),
    toAnalytics: () => navigateToAnalytics(navigate),
    toDashboard: () => navigateToAppBuilder(navigate)
  };
};




