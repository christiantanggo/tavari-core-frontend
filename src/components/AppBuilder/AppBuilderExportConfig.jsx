// Step 116: Create AppBuilderExportConfig component
// Export app configuration as JSON
import React, { useState } from 'react';
import { Download, FileJson, AlertCircle } from 'lucide-react';
import appBuilderExportService from '../../services/AppBuilder/appBuilderExportService';
import { useBusinessContext } from '../../contexts/BusinessContext';
import toast from 'react-hot-toast';

const AppBuilderExportConfig = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (selectedBusinessId) {
      appBuilderExportService.setBusinessId(selectedBusinessId);
    }
  }, [selectedBusinessId]);

  const handleExport = async () => {
    try {
      setExporting(true);
      setError(null);

      const config = await appBuilderExportService.exportAppConfig();
      const filename = `app-config-${selectedBusinessId}-${new Date().toISOString().split('T')[0]}.json`;

      appBuilderExportService.downloadFile(config, filename, 'application/json');
      toast.success('Configuration exported successfully');
    } catch (err) {
      console.error('Error exporting config:', err);
      setError(err.message || 'Failed to export configuration');
      toast.error('Failed to export configuration');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Export Configuration</h3>
            <p className="text-sm text-gray-600 mt-1">
              Download your app configuration as a JSON file for backup or migration
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md mb-4">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={handleExport}
            disabled={exporting || !selectedBusinessId}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export Configuration
              </>
            )}
          </button>
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <FileJson className="w-4 h-4" />
            <span>JSON Format</span>
          </div>
        </div>

        <div className="mt-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600">
            The exported file includes: branding settings, enabled modules, store listings, and build history.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderExportConfig;




