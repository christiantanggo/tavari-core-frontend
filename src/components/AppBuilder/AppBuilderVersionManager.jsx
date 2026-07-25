// Step 98: Create AppBuilderVersionManager component
// Version management (increment, history, rollback)
import React, { useState } from 'react';
import { Plus, Minus, History } from 'lucide-react';
import { incrementVersion, parseVersion, formatVersion } from '../../utils/appBuilderVersionUtils';

const AppBuilderVersionManager = ({ currentVersion, onVersionChange, disabled = false }) => {
  const [version, setVersion] = useState(currentVersion || '1.0.0');

  React.useEffect(() => {
    setVersion(currentVersion || '1.0.0');
  }, [currentVersion]);

  const handleIncrement = (type) => {
    const newVersion = incrementVersion(version, type);
    setVersion(newVersion);
    if (onVersionChange) {
      onVersionChange(newVersion);
    }
  };

  const handleVersionChange = (e) => {
    const value = e.target.value;
    setVersion(value);
    if (onVersionChange) {
      onVersionChange(value);
    }
  };

  const parsed = parseVersion(version);

  return (
    <div className="space-y-4">
      {/* Version Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Version
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={version}
            onChange={handleVersionChange}
            disabled={disabled}
            placeholder="1.0.0"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 font-mono"
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Use semantic versioning (Major.Minor.Patch)
        </p>
      </div>

      {/* Increment Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleIncrement('major')}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Major
        </button>
        <button
          onClick={() => handleIncrement('minor')}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Minor
        </button>
        <button
          onClick={() => handleIncrement('patch')}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Patch
        </button>
      </div>

      {/* Version Breakdown */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between text-sm">
          <div>
            <span className="text-gray-600">Major:</span>
            <span className="ml-2 font-semibold text-gray-900">{parsed.major}</span>
          </div>
          <div>
            <span className="text-gray-600">Minor:</span>
            <span className="ml-2 font-semibold text-gray-900">{parsed.minor}</span>
          </div>
          <div>
            <span className="text-gray-600">Patch:</span>
            <span className="ml-2 font-semibold text-gray-900">{parsed.patch}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderVersionManager;




