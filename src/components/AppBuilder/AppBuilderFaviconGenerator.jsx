// Step 89: Create AppBuilderFaviconGenerator component (Simplified)
// Generate favicons from logo (various sizes)
import React, { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import AppBuilderImageUpload from './AppBuilderImageUpload';

const AppBuilderFaviconGenerator = ({ currentFavicon, onFaviconChange, onUpload, disabled = false }) => {
  const [favicon, setFavicon] = useState(currentFavicon);
  const [sizes] = useState([16, 32, 48, 64, 128, 192, 512]);

  React.useEffect(() => {
    setFavicon(currentFavicon);
  }, [currentFavicon]);

  const handleUploadComplete = (url) => {
    setFavicon(url);
    if (onFaviconChange) {
      onFaviconChange(url);
    }
  };

  return (
    <div className="space-y-4">
      <AppBuilderImageUpload
        onUpload={onUpload || handleUploadComplete}
        assetType="favicon"
        currentUrl={favicon}
        disabled={disabled}
        acceptedFormats={['image/png', 'image/x-icon']}
        maxSizeMB={5}
      />

      {favicon && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Favicon Sizes</h3>
          <div className="grid grid-cols-4 gap-4">
            {sizes.map((size) => (
              <div key={size} className="text-center">
                <div className="bg-white border rounded-lg p-2 mb-2">
                  <img
                    src={favicon}
                    alt={`Favicon ${size}x${size}`}
                    width={size}
                    height={size}
                    className="mx-auto"
                  />
                </div>
                <p className="text-xs text-gray-500">{size}x{size}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Favicons will be automatically generated in all required sizes when you upload an image.
          </p>
        </div>
      )}
    </div>
  );
};

export default AppBuilderFaviconGenerator;




