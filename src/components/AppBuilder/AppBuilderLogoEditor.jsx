// Step 88: Create AppBuilderLogoEditor component (Simplified)
// Logo upload and positioning with crop/resize
import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import AppBuilderImageUpload from './AppBuilderImageUpload';

const AppBuilderLogoEditor = ({ currentLogo, onLogoChange, onUpload, disabled = false }) => {
  const [logo, setLogo] = useState(currentLogo);

  React.useEffect(() => {
    setLogo(currentLogo);
  }, [currentLogo]);

  const handleUploadComplete = (url) => {
    setLogo(url);
    if (onLogoChange) {
      onLogoChange(url);
    }
  };

  return (
    <div className="space-y-4">
      <AppBuilderImageUpload
        onUpload={onUpload || handleUploadComplete}
        assetType="logo"
        currentUrl={logo}
        disabled={disabled}
        acceptedFormats={['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml']}
      />
      
      {logo && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Logo Preview</h3>
          <div className="flex gap-4">
            <div className="text-center">
              <div className="bg-white border rounded-lg p-4 mb-2">
                <img src={logo} alt="Logo" className="max-w-xs h-16 object-contain mx-auto" />
              </div>
              <p className="text-xs text-gray-500">Standard</p>
            </div>
            <div className="text-center">
              <div className="bg-gray-900 border rounded-lg p-4 mb-2">
                <img src={logo} alt="Logo" className="max-w-xs h-16 object-contain mx-auto" />
              </div>
              <p className="text-xs text-gray-500">Dark Background</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppBuilderLogoEditor;




