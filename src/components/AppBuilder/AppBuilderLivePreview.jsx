// Step 105: Create AppBuilderLivePreview component
// Live preview of app with device frames
import React, { useState } from 'react';
import { Smartphone, Tablet, Monitor } from 'lucide-react';
import { useAppBuilderBranding } from '../../hooks/useAppBuilderBranding';

const AppBuilderLivePreview = () => {
  const { branding } = useAppBuilderBranding();
  const [deviceType, setDeviceType] = useState('iphone');

  const deviceFrames = {
    iphone: {
      width: '375px',
      height: '812px',
      frame: 'iphone-frame'
    },
    android: {
      width: '360px',
      height: '800px',
      frame: 'android-frame'
    },
    tablet: {
      width: '768px',
      height: '1024px',
      frame: 'tablet-frame'
    }
  };

  const currentFrame = deviceFrames[deviceType];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Live Preview</h3>
          <p className="text-sm text-gray-600 mt-1">
            Preview how your app will look on different devices
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setDeviceType('iphone')}
            className={`p-2 rounded-md ${
              deviceType === 'iphone'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Smartphone className="w-5 h-5" />
          </button>
          <button
            onClick={() => setDeviceType('android')}
            className={`p-2 rounded-md ${
              deviceType === 'android'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Smartphone className="w-5 h-5" />
          </button>
          <button
            onClick={() => setDeviceType('tablet')}
            className={`p-2 rounded-md ${
              deviceType === 'tablet'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Tablet className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Device Preview */}
      <div className="bg-gray-100 rounded-lg p-8 flex items-center justify-center min-h-[600px]">
        <div
          className="bg-white rounded-lg shadow-2xl overflow-hidden"
          style={{
            width: currentFrame.width,
            height: currentFrame.height,
            maxWidth: '100%'
          }}
        >
          {/* Device Frame */}
          <div
            className="w-full h-full relative"
            style={{
              backgroundColor: branding?.primary_color || '#3B82F6',
              backgroundImage: branding?.logo_url ? `url(${branding.logo_url})` : 'none',
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat'
            }}
          >
            {/* App Content Preview */}
            <div className="p-6 text-white">
              {branding?.logo_url && (
                <img
                  src={branding.logo_url}
                  alt="App Logo"
                  className="w-20 h-20 mx-auto mb-4"
                />
              )}
              <h2 className="text-2xl font-bold text-center mb-2">
                {branding?.app_name || 'My App'}
              </h2>
              <p className="text-center opacity-90">
                Welcome to your custom app
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Color Preview */}
      <div className="grid grid-cols-3 gap-4">
        {branding?.primary_color && (
          <div>
            <div
              className="w-full h-20 rounded-lg mb-2"
              style={{ backgroundColor: branding.primary_color }}
            />
            <p className="text-xs text-gray-600">Primary</p>
          </div>
        )}
        {branding?.secondary_color && (
          <div>
            <div
              className="w-full h-20 rounded-lg mb-2"
              style={{ backgroundColor: branding.secondary_color }}
            />
            <p className="text-xs text-gray-600">Secondary</p>
          </div>
        )}
        {branding?.accent_color && (
          <div>
            <div
              className="w-full h-20 rounded-lg mb-2"
              style={{ backgroundColor: branding.accent_color }}
            />
            <p className="text-xs text-gray-600">Accent</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppBuilderLivePreview;




