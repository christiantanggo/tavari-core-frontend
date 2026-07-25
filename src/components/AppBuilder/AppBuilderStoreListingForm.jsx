// Step 96: Create AppBuilderStoreListingForm component
// Form for App Store/Play Store listing
import React, { useState } from 'react';
import { Save, AlertCircle } from 'lucide-react';
import { validateStoreListing } from '../../utils/appBuilderValidators';
import toast from 'react-hot-toast';

const AppBuilderStoreListingForm = ({ platform, listing, onUpdate, canEdit }) => {
  const [formData, setFormData] = useState({
    title: listing?.title || '',
    subtitle: listing?.subtitle || '',
    description: listing?.description || '',
    keywords: listing?.keywords || [],
    screenshots: listing?.screenshots || [],
    promo_text: listing?.promo_text || '',
    support_url: listing?.support_url || '',
    privacy_url: listing?.privacy_url || '',
    category: listing?.category || '',
    age_rating: listing?.age_rating || ''
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  React.useEffect(() => {
    if (listing) {
      setFormData({
        title: listing.title || '',
        subtitle: listing.subtitle || '',
        description: listing.description || '',
        keywords: listing.keywords || [],
        screenshots: listing.screenshots || [],
        promo_text: listing.promo_text || '',
        support_url: listing.support_url || '',
        privacy_url: listing.privacy_url || '',
        category: listing.category || '',
        age_rating: listing.age_rating || ''
      });
    }
  }, [listing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors([]);

    const validation = validateStoreListing(formData, platform);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    try {
      setSaving(true);
      await onUpdate(formData);
      toast.success('Store listing updated successfully');
    } catch (error) {
      console.error('Error updating listing:', error);
      toast.error('Failed to update listing');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Title *
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          disabled={!canEdit || saving}
          maxLength={50}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <p className="text-xs text-gray-500 mt-1">{formData.title.length}/50 characters</p>
      </div>

      {/* Subtitle (iOS only) */}
      {platform === 'ios' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Subtitle
          </label>
          <input
            type="text"
            value={formData.subtitle}
            onChange={(e) => setFormData(prev => ({ ...prev, subtitle: e.target.value }))}
            disabled={!canEdit || saving}
            maxLength={30}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <p className="text-xs text-gray-500 mt-1">{formData.subtitle.length}/30 characters</p>
        </div>
      )}

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Description *
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          disabled={!canEdit || saving}
          rows={6}
          maxLength={4000}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <p className="text-xs text-gray-500 mt-1">{formData.description.length}/4000 characters</p>
      </div>

      {/* Keywords */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Keywords (comma-separated)
        </label>
        <input
          type="text"
          value={formData.keywords.join(', ')}
          onChange={(e) => {
            const keywords = e.target.value.split(',').map(k => k.trim()).filter(k => k);
            setFormData(prev => ({ ...prev, keywords }));
          }}
          disabled={!canEdit || saving}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-red-900 mb-1">Validation Errors</h4>
              <ul className="text-sm text-red-700 list-disc list-inside">
                {errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Submit Button */}
      {canEdit && (
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Saving...
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              Save Listing
            </>
          )}
        </button>
      )}
    </form>
  );
};

export default AppBuilderStoreListingForm;




