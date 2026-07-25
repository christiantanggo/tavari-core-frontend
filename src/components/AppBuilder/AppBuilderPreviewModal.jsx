// Step 99: Create AppBuilderPreviewModal component
// Modal with app preview and QR code
import React from 'react';
import { X, Copy, Share2, QrCode } from 'lucide-react';
import toast from 'react-hot-toast';

const AppBuilderPreviewModal = ({ isOpen, onClose, previewUrl, qrCode }) => {
  if (!isOpen) return null;

  const handleCopy = () => {
    if (previewUrl) {
      navigator.clipboard.writeText(previewUrl);
      toast.success('Link copied to clipboard');
    }
  };

  const handleShare = async () => {
    if (navigator.share && previewUrl) {
      try {
        await navigator.share({
          title: 'App Preview',
          text: 'Check out this app preview',
          url: previewUrl
        });
      } catch (error) {
        // User cancelled or error
        handleCopy();
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">App Preview</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Preview URL */}
          {previewUrl && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Preview URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={previewUrl}
                  readOnly
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
                <button
                  onClick={handleShare}
                  className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              </div>
            </div>
          )}

          {/* QR Code */}
          {qrCode && (
            <div className="text-center">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                QR Code
              </label>
              <div className="inline-block p-4 bg-white border rounded-lg">
                <img
                  src={qrCode}
                  alt="QR Code"
                  className="w-48 h-48"
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Scan with your phone to preview the app
              </p>
            </div>
          )}

          {/* Device Mockup Placeholder */}
          <div className="border rounded-lg p-6 bg-gray-50 text-center">
            <p className="text-sm text-gray-600 mb-4">Device Preview</p>
            <div className="inline-block bg-white rounded-lg shadow-lg p-4">
              <div className="w-64 h-96 bg-gray-200 rounded border-4 border-gray-800 flex items-center justify-center">
                <p className="text-gray-500 text-sm">App Preview</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderPreviewModal;




