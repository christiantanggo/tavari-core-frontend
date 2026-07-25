// Step 117: Create AppBuilderImportConfig component
// Import app configuration from JSON
import React, { useState } from 'react';
import { Upload, FileJson, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { useAppBuilderBranding } from '../../hooks/useAppBuilderBranding';
import { useAppBuilderModules } from '../../hooks/useAppBuilderModules';
import toast from 'react-hot-toast';

const AppBuilderImportConfig = () => {
  const { selectedBusinessId } = useBusinessContext();
  const { updateBranding } = useAppBuilderBranding();
  const { toggleModule } = useAppBuilderModules();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.json')) {
      setError('Please select a JSON file');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setPreview(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const config = JSON.parse(event.target.result);
        setPreview(config);
      } catch (err) {
        setError('Invalid JSON file: ' + err.message);
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    if (!preview || !selectedBusinessId) return;

    try {
      setImporting(true);
      setError(null);

      // Import branding
      if (preview.branding) {
        await updateBranding(preview.branding);
      }

      // Import enabled modules
      if (preview.enabled_modules && Array.isArray(preview.enabled_modules)) {
        for (const module of preview.enabled_modules) {
          if (module.module_key && module.enabled) {
            try {
              await toggleModule(module.module_key, true);
            } catch (err) {
              console.warn(`Failed to enable module ${module.module_key}:`, err);
            }
          }
        }
      }

      toast.success('Configuration imported successfully');
      setPreview(null);
      setFile(null);
      if (file) {
        // Reset file input
        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) fileInput.value = '';
      }
    } catch (err) {
      console.error('Error importing config:', err);
      setError(err.message || 'Failed to import configuration');
      toast.error('Failed to import configuration');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Import Configuration</h3>
            <p className="text-sm text-gray-600 mt-1">
              Import app configuration from a previously exported JSON file
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Configuration File
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
                id="config-file-input"
              />
              <label
                htmlFor="config-file-input"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="w-8 h-8 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {file ? file.name : 'Click to select JSON file'}
                </span>
              </label>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <h4 className="font-semibold text-gray-900">Configuration Preview</h4>
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                {preview.branding && (
                  <p>✓ Branding: {preview.branding.app_name || 'Configured'}</p>
                )}
                {preview.enabled_modules && (
                  <p>✓ Modules: {preview.enabled_modules.length} enabled</p>
                )}
                {preview.store_listings && (
                  <p>✓ Store Listings: {preview.store_listings.length} configured</p>
                )}
                {preview.exported_at && (
                  <p className="text-xs text-gray-500">
                    Exported: {new Date(preview.exported_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Import Button */}
          {preview && (
            <button
              onClick={handleImport}
              disabled={importing || !selectedBusinessId}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {importing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Import Configuration
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppBuilderImportConfig;




