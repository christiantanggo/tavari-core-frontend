// Step 93: Create AppBuilderBuildTrigger component
// Trigger new build (platform selection, version input)
import React, { useState } from 'react';
import { Upload, AlertCircle } from 'lucide-react';
import { PLATFORM_OPTIONS } from '../../constants/appBuilderConstants';
import { formatVersion, validateSemVer } from '../../utils/appBuilderVersionUtils';
import toast from 'react-hot-toast';

const AppBuilderBuildTrigger = ({ onCreate, disabled = false }) => {
  const [platform, setPlatform] = useState('both');
  const [version, setVersion] = useState('1.0.0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Validate version
    if (!validateSemVer(version)) {
      setError('Invalid version format. Use semantic versioning (e.g., 1.0.0)');
      return;
    }

    try {
      setLoading(true);
      const formattedVersion = formatVersion(version);
      await onCreate({
        app_version: formattedVersion,
        platform: platform
      });
      toast.success('Build queued successfully');
      setVersion('1.0.0'); // Reset form
    } catch (err) {
      console.error('Error creating build:', err);
      setError(err.message || 'Failed to create build');
      toast.error('Failed to create build');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Platform Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Platform
        </label>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          disabled={disabled || loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        >
          {PLATFORM_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Version Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Version
        </label>
        <input
          type="text"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          disabled={disabled || loading}
          placeholder="1.0.0"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 font-mono"
        />
        <p className="text-xs text-gray-500 mt-1">
          Use semantic versioning (e.g., 1.0.0, 1.1.0, 2.0.0)
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={disabled || loading}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            Creating Build...
          </>
        ) : (
          <>
            <Upload className="w-5 h-5" />
            Create Build
          </>
        )}
      </button>
    </form>
  );
};

export default AppBuilderBuildTrigger;




