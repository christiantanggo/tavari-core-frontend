// Step 120: Create AppBuilderModuleLicenseGuard component
// Route guard that checks module license before rendering
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAppBuilderLicenseCheck } from '../../hooks/useAppBuilderLicenseCheck';
import { AlertCircle } from 'lucide-react';

const AppBuilderModuleLicenseGuard = ({ moduleKey, children, redirectTo = '/dashboard/appbuilder/modules' }) => {
  const { isEnabled, canAccess, loading, isTrial, expiresAt } = useAppBuilderLicenseCheck(moduleKey);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking module access...</p>
        </div>
      </div>
    );
  }

  if (!isEnabled || !canAccess) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <AlertCircle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Module Not Available</h2>
            <p className="text-gray-600 mb-6">
              This module is not enabled for your business. Please contact your administrator to enable it.
            </p>
            {isTrial && expiresAt && new Date(expiresAt) < new Date() && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-yellow-800">
                  Your trial has expired on {new Date(expiresAt).toLocaleDateString()}
                </p>
              </div>
            )}
            <button
              onClick={() => window.location.href = redirectTo}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Go to Module Management
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AppBuilderModuleLicenseGuard;




