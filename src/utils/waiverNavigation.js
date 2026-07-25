// Step 64: Create waiverNavigation.js
// Centralized navigation helpers for Waivers module
import { useNavigate } from 'react-router-dom';

/**
 * Navigate to waivers dashboard
 */
export const navigateToWaivers = (navigate) => {
  navigate('/dashboard/waivers');
};

/**
 * Navigate to waiver detail page
 */
export const navigateToWaiverDetail = (navigate, waiverId) => {
  navigate(`/dashboard/waivers/${waiverId}`);
};

/**
 * Navigate to waiver sign page (public)
 */
export const navigateToWaiverSign = (navigate, signatureToken) => {
  navigate(`/waivers/sign/${signatureToken}`);
};

/**
 * Navigate to waiver templates
 */
export const navigateToWaiverTemplates = (navigate) => {
  navigate('/dashboard/waivers/templates');
};

/**
 * Navigate to waiver search
 */
export const navigateToWaiverSearch = (navigate) => {
  navigate('/dashboard/waivers/search');
};

/**
 * Navigate to waiver upload
 */
export const navigateToWaiverUpload = (navigate) => {
  navigate('/dashboard/waivers/upload');
};

/**
 * Navigate to waiver settings
 */
export const navigateToWaiverSettings = (navigate) => {
  navigate('/dashboard/waivers/settings');
};

/**
 * Navigate to waiver kiosk
 */
export const navigateToWaiverKiosk = (navigate) => {
  navigate('/dashboard/waivers/kiosk');
};

/**
 * Navigate to customer waiver dashboard
 */
export const navigateToCustomerWaivers = (navigate) => {
  navigate('/waivers');
};

/**
 * Hook version for use in components
 */
export const useWaiverNavigation = () => {
  const navigate = useNavigate();

  return {
    toWaivers: () => navigateToWaivers(navigate),
    toWaiverDetail: (waiverId) => navigateToWaiverDetail(navigate, waiverId),
    toWaiverSign: (signatureToken) => navigateToWaiverSign(navigate, signatureToken),
    toWaiverTemplates: () => navigateToWaiverTemplates(navigate),
    toWaiverSearch: () => navigateToWaiverSearch(navigate),
    toWaiverUpload: () => navigateToWaiverUpload(navigate),
    toWaiverSettings: () => navigateToWaiverSettings(navigate),
    toWaiverKiosk: () => navigateToWaiverKiosk(navigate),
    toCustomerWaivers: () => navigateToCustomerWaivers(navigate)
  };
};




