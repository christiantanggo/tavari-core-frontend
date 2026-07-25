// Step 108: Create AppBuilderAssetManager component
// Asset library (logos, icons, screenshots)
import React, { useState } from 'react';
import { Upload, Trash2, Eye, Filter, X } from 'lucide-react';
import { useAppBuilderAssets } from '../../hooks/useAppBuilderAssets';
import { ASSET_TYPES } from '../../constants/appBuilderConstants';

const AppBuilderAssetManager = () => {
  const { assets, loading, uploadAsset, deleteAsset, refresh } = useAppBuilderAssets();
  const [filterType, setFilterType] = useState('all');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [showUpload, setShowUpload] = useState(false);

  const filteredAssets = assets.filter(asset => 
    filterType === 'all' || asset.asset_type === filterType
  );

  const handleUpload = async (file, assetType) => {
    try {
      await uploadAsset(file, assetType);
      setShowUpload(false);
      await refresh();
    } catch (error) {
      console.error('Upload error:', error);
    }
  };

  const handleDelete = async (assetId) => {
    if (!confirm('Are you sure you want to delete this asset?')) return;
    try {
      await deleteAsset(assetId);
      await refresh();
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Asset Library</h3>
          <p className="text-sm text-gray-600 mt-1">Manage logos, icons, and screenshots</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          Upload Asset
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilterType('all')}
          className={`px-3 py-1 rounded-md text-sm ${
            filterType === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {Object.values(ASSET_TYPES).map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-3 py-1 rounded-md text-sm capitalize ${
              filterType === type
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Assets Grid */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center">
          <p className="text-gray-500">No assets found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredAssets.map((asset) => (
            <div key={asset.id} className="bg-white border rounded-lg overflow-hidden group">
              <div className="aspect-square bg-gray-100 relative">
                <img
                  src={asset.asset_url}
                  alt={asset.asset_type}
                  className="w-full h-full object-contain"
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => setSelectedAsset(asset)}
                    className="opacity-0 group-hover:opacity-100 p-2 bg-white rounded text-blue-600 hover:bg-blue-50"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(asset.id)}
                    className="opacity-0 group-hover:opacity-100 p-2 bg-white rounded text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs text-gray-600 capitalize">{asset.asset_type}</p>
                <p className="text-xs text-gray-500">
                  {(asset.file_size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Upload Asset</h3>
              <button
                onClick={() => setShowUpload(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Upload form would go here */}
            <p className="text-gray-600">Upload functionality to be implemented</p>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Asset Preview</h3>
              <button
                onClick={() => setSelectedAsset(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <img
              src={selectedAsset.asset_url}
              alt={selectedAsset.asset_type}
              className="max-w-full max-h-96 mx-auto"
            />
            <div className="mt-4 text-sm text-gray-600">
              <p>Type: {selectedAsset.asset_type}</p>
              <p>Size: {(selectedAsset.file_size / 1024).toFixed(1)} KB</p>
              {selectedAsset.dimensions && (
                <p>Dimensions: {selectedAsset.dimensions.width} × {selectedAsset.dimensions.height}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppBuilderAssetManager;




