// Step 103: Create AppBuilderTrialBanner component
// Show trial expiry warnings for modules
import React from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import { useAppBuilderModules } from '../../hooks/useAppBuilderModules';

const AppBuilderTrialBanner = () => {
  const { enabledModules } = useAppBuilderModules();

  // Find modules with expiring trials
  const expiringTrials = enabledModules.filter(module => {
    if (!module.trial_enabled || !module.trial_expires_at) return false;
    const expiresAt = new Date(module.trial_expires_at);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  });

  if (expiringTrials.length === 0) return null;

  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-medium text-yellow-900 mb-1">
            Trial Expiring Soon
          </h3>
          <div className="text-sm text-yellow-700 space-y-1">
            {expiringTrials.map((module) => {
              const expiresAt = new Date(module.trial_expires_at);
              const daysUntilExpiry = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <p key={module.module_key}>
                  <strong>{module.module_name || module.catalog_name}</strong> trial expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
                  </p>
              );
            })}
          </div>
          <button className="mt-3 text-sm font-medium text-yellow-900 hover:text-yellow-800">
            Upgrade Now →
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderTrialBanner;




