// Step 102: Create AppBuilderUsageStats component
// Display module usage statistics
import React from 'react';
import { BarChart3, TrendingUp, Clock } from 'lucide-react';
import { useAppBuilderModules } from '../../hooks/useAppBuilderModules';

const AppBuilderUsageStats = () => {
  const { enabledModules } = useAppBuilderModules();

  const totalUsage = enabledModules.reduce((sum, module) => sum + (module.usage_count || 0), 0);
  const mostUsed = enabledModules.reduce((max, module) => 
    (module.usage_count || 0) > (max.usage_count || 0) ? module : max
  , enabledModules[0] || null);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Module Usage Statistics</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Usage</p>
              <p className="text-2xl font-bold text-gray-900">{totalUsage}</p>
            </div>
            <BarChart3 className="w-8 h-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-green-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Enabled Modules</p>
              <p className="text-2xl font-bold text-gray-900">{enabledModules.length}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-500" />
          </div>
        </div>

        <div className="bg-purple-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Most Used</p>
              <p className="text-lg font-semibold text-gray-900 truncate">
                {mostUsed?.module_name || 'N/A'}
              </p>
            </div>
            <Clock className="w-8 h-8 text-purple-500" />
          </div>
        </div>
      </div>

      {/* Usage by Module */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">Usage by Module</h4>
        <div className="space-y-2">
          {enabledModules
            .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
            .slice(0, 5)
            .map((module) => (
              <div key={module.module_key} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{module.module_name || module.catalog_name}</span>
                <div className="flex items-center gap-3">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{
                        width: `${totalUsage > 0 ? ((module.usage_count || 0) / totalUsage) * 100 : 0}%`
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-900 w-12 text-right">
                    {module.usage_count || 0}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default AppBuilderUsageStats;




