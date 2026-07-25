// Step 79: Create appBuilderLicenseCheck.js
// License enforcement utilities

import AppBuilderModuleService from '../services/AppBuilder/AppBuilderModuleService';

/**
 * Check module access
 * @param {string} businessId - Business ID
 * @param {string} moduleKey - Module key
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - True if user has access
 */
export const checkModuleAccess = async (businessId, moduleKey, userId) => {
  try {
    AppBuilderModuleService.setBusinessId(businessId);
    return await AppBuilderModuleService.checkModuleAccess(moduleKey);
  } catch (error) {
    console.error('Error checking module access:', error);
    return false;
  }
};

/**
 * Enforce module license (hide routes/features if module disabled)
 * @param {string} businessId - Business ID
 * @param {string} moduleKey - Module key
 * @returns {Promise<boolean>} - True if module is enabled and accessible
 */
export const enforceModuleLicense = async (businessId, moduleKey) => {
  try {
    AppBuilderModuleService.setBusinessId(businessId);
    
    // Get enabled modules
    const enabledModules = await AppBuilderModuleService.getEnabledModules();
    const module = enabledModules.find(m => m.module_key === moduleKey);
    
    return module?.enabled === true;
  } catch (error) {
    console.error('Error enforcing module license:', error);
    return false;
  }
};

/**
 * Hide module routes if module is disabled
 * @param {string} businessId - Business ID
 * @param {string} moduleKey - Module key
 * @returns {Promise<boolean>} - True if module should be hidden
 */
export const hideModuleRoutes = async (businessId, moduleKey) => {
  const isEnabled = await enforceModuleLicense(businessId, moduleKey);
  return !isEnabled;
};




