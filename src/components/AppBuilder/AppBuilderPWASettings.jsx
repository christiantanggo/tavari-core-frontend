// Step 90: Create AppBuilderPWASettings component
// PWA manifest configuration and preview
import React, { useState } from 'react';
import { Eye, Download, RefreshCw } from 'lucide-react';
import { generateManifest, validatePWAConfig } from '../../utils/appBuilderPWAGenerator';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles?.spacing?.xl || '20px'
  },
  formGroup: {
    marginBottom: TavariStyles?.spacing?.lg || '16px'
  },
  label: {
    display: 'block',
    fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
    color: TavariStyles?.colors?.gray700 || '#374151',
    marginBottom: TavariStyles?.spacing?.xs || '4px'
  },
  select: {
    width: '100%',
    padding: '12px 16px',
    border: `2px solid ${TavariStyles?.colors?.primary || '#008080'}`,
    borderRadius: TavariStyles?.borderRadius?.md || '6px',
    fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
    backgroundColor: TavariStyles?.colors?.white || '#ffffff',
    boxSizing: 'border-box',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease',
    outline: 'none'
  },
  selectDisabled: {
    backgroundColor: TavariStyles?.colors?.gray100 || '#f3f4f6',
    cursor: 'not-allowed',
    borderColor: TavariStyles?.colors?.gray300 || '#d1d5db'
  }
};

const AppBuilderPWASettings = ({ branding, onUpdate, canEdit, onGenerateManifest }) => {
  const [manifest, setManifest] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  React.useEffect(() => {
    if (branding?.pwa_settings) {
      setManifest(branding.pwa_settings);
    }
  }, [branding]);

  const handleGenerateManifest = async () => {
    try {
      if (onGenerateManifest) {
        const generated = await onGenerateManifest();
        setManifest(generated);
        toast.success('PWA manifest generated successfully');
      } else {
        const generated = generateManifest({
          name: branding?.app_name || 'Tavari App',
          shortName: branding?.app_name || 'Tavari',
          description: `${branding?.app_name || 'Tavari'} App`,
          backgroundColor: branding?.primary_color || '#ffffff',
          themeColor: branding?.primary_color || '#3B82F6',
          icons: branding?.logo_url ? [
            {
              src: branding.logo_url,
              sizes: '192x192',
              type: 'image/png'
            }
          ] : []
        });
        setManifest(generated);
        toast.success('PWA manifest generated');
      }
    } catch (error) {
      console.error('Error generating manifest:', error);
      toast.error('Failed to generate manifest');
    }
  };

  const handleDownloadManifest = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      if (!manifest) {
        toast.error('No manifest to download. Please generate a manifest first.');
        console.warn('Download attempted but manifest is null');
        return;
      }

      console.log('Downloading manifest:', manifest);
      
      const manifestJson = JSON.stringify(manifest, null, 2);
      const blob = new Blob([manifestJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = 'manifest.json';
      link.style.display = 'none'; // Hide the link
      link.setAttribute('download', 'manifest.json'); // Ensure download attribute is set
      
      // Add to DOM, click, then remove
      document.body.appendChild(link);
      
      // Trigger download
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      link.dispatchEvent(clickEvent);
      
      // Clean up after a short delay to ensure download starts
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
      }, 200);
      
      toast.success('Manifest downloaded');
      console.log('Manifest download initiated');
    } catch (error) {
      console.error('Error downloading manifest:', error);
      toast.error('Failed to download manifest: ' + (error.message || 'Unknown error'));
    }
  };

  const validation = manifest ? validatePWAConfig(manifest) : null;

  return (
    <div className="space-y-6">
      {/* Generate Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">PWA Manifest</h3>
          <p className="text-sm text-gray-600 mt-1">
            Generate a Progressive Web App manifest for your app
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleGenerateManifest}
            disabled={!canEdit}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Generate Manifest
          </button>
          {manifest && (
            <button
              type="button"
              onClick={handleDownloadManifest}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          )}
        </div>
      </div>

      {/* Validation Status */}
      {validation && (
        <div className={`p-3 rounded-md ${
          validation.valid ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'
        }`}>
          {validation.valid ? (
            <p className="text-sm">✓ Manifest is valid</p>
          ) : (
            <div>
              <p className="text-sm font-medium mb-1">Issues found:</p>
              <ul className="text-sm list-disc list-inside">
                {validation.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Manifest Preview */}
      {manifest && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-900">Manifest Preview</h4>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Eye className="w-4 h-4" />
              {showPreview ? 'Hide' : 'Show'} JSON
            </button>
          </div>
          {showPreview && (
            <pre className="p-4 bg-gray-900 text-gray-100 text-xs overflow-auto max-h-96">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* PWA Settings */}
      <div style={styles.container}>
        <div style={styles.formGroup}>
          <label style={styles.label}>
            Display Mode
          </label>
          <select
            value={manifest?.display || 'standalone'}
            onChange={(e) => {
              const updated = { ...manifest, display: e.target.value };
              setManifest(updated);
              onUpdate({ ...branding, pwa_settings: updated });
            }}
            disabled={!canEdit || !manifest}
            style={{
              ...styles.select,
              ...((!canEdit || !manifest) ? styles.selectDisabled : {})
            }}
          >
            <option value="standalone">Standalone</option>
            <option value="fullscreen">Fullscreen</option>
            <option value="minimal-ui">Minimal UI</option>
            <option value="browser">Browser</option>
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            Orientation
          </label>
          <select
            value={manifest?.orientation || 'portrait'}
            onChange={(e) => {
              const updated = { ...manifest, orientation: e.target.value };
              setManifest(updated);
              onUpdate({ ...branding, pwa_settings: updated });
            }}
            disabled={!canEdit || !manifest}
            style={{
              ...styles.select,
              ...((!canEdit || !manifest) ? styles.selectDisabled : {})
            }}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
            <option value="any">Any</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderPWASettings;

