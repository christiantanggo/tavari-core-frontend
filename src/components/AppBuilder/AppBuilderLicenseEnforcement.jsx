// Step 104: Create AppBuilderLicenseEnforcement component
// Show message when module is disabled
import React from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { useAppBuilderLicenseCheck } from '../../hooks/useAppBuilderLicenseCheck';
import { useNavigate } from 'react-router-dom';

const AppBuilderLicenseEnforcement = ({ moduleKey, children }) => {
  const { isEnabled, canAccess, loading, isTrial, expiresAt } = useAppBuilderLicenseCheck(moduleKey);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isEnabled || !canAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-yellow-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Module Not Available</h2>
          <p className="text-gray-600 mb-6">
            This module is not enabled for your business. Please contact your administrator to enable it.
          </p>
          {isTrial && expiresAt && new Date(expiresAt) < new Date() && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 text-yellow-800">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">
                  Trial expired on {new Date(expiresAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={() => navigate('/dashboard/appbuilder/modules')}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Manage Modules
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AppBuilderLicenseEnforcement;




