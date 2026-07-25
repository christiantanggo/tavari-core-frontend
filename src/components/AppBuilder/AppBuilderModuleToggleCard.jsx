// Step 85: Create AppBuilderModuleToggleCard component
// Card displaying module info with enable/disable toggle
import React from 'react';
import { Package, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';

const AppBuilderModuleToggleCard = ({
  module,
  enabled,
  onToggle,
  usageStats,
  trialInfo,
  canToggle = true
}) => {
  const getModuleIcon = (moduleKey) => {
    // Icon mapping would go here
    return Package;
  };

  const Icon = getModuleIcon(module.module_key);

  return (
    <div className={`border rounded-lg p-4 transition-all ${
      enabled ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${
            enabled ? 'bg-green-100' : 'bg-gray-100'
          }`}>
            <Icon className={`w-5 h-5 ${
              enabled ? 'text-green-600' : 'text-gray-400'
            }`} />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{module.module_name}</h3>
            <p className="text-xs text-gray-500">{module.module_category}</p>
          </div>
        </div>
        {canToggle && (
          <TavariCheckbox
            checked={enabled}
            onChange={onToggle}
          />
        )}
      </div>

      {module.description && (
        <p className="text-sm text-gray-600 mb-3">{module.description}</p>
      )}

      {/* Usage Stats */}
      {enabled && usageStats && (
        <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
          {usageStats.usageCount !== undefined && (
            <div className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>Used {usageStats.usageCount} times</span>
            </div>
          )}
          {usageStats.lastUsed && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Last used {new Date(usageStats.lastUsed).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      )}

      {/* Trial Info */}
      {trialInfo?.isTrial && (
        <div className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 p-2 rounded mt-2">
          <AlertCircle className="w-3 h-3" />
          <span>
            Trial {trialInfo.expiresAt && new Date(trialInfo.expiresAt) > new Date()
              ? `expires ${new Date(trialInfo.expiresAt).toLocaleDateString()}`
              : 'expired'}
          </span>
        </div>
      )}

      {/* Status Badge */}
      <div className="mt-3 pt-3 border-t border-gray-200">
        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
          enabled
            ? 'bg-green-100 text-green-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
    </div>
  );
};

export default AppBuilderModuleToggleCard;




