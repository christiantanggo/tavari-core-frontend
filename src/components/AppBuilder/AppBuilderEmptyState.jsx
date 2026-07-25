// Step 118: Create AppBuilderEmptyState component
// Empty state when no apps configured
import React from 'react';
import { Smartphone, Plus, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AppBuilderEmptyState = ({ onCreateClick }) => {
  const navigate = useNavigate();

  const handleCreate = () => {
    if (onCreateClick) {
      onCreateClick();
    } else {
      navigate('/dashboard/appbuilder/branding');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-2xl text-center">
        <div className="mb-8">
          <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Smartphone className="w-12 h-12 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Create Your White-Label App
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            Build a custom iOS and Android app with your branding, modules, and features.
            Get started by configuring your app's branding and enabled modules.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🎨</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Custom Branding</h3>
            <p className="text-sm text-gray-600">
              Add your logo, colors, and branding to create a unique app experience
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🧩</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Module Selection</h3>
            <p className="text-sm text-gray-600">
              Choose which Tavari modules to include in your app
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📦</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Build & Deploy</h3>
            <p className="text-sm text-gray-600">
              Build your app and deploy to iOS App Store and Google Play
            </p>
          </div>
        </div>

        <div className="flex gap-4 justify-center">
          <button
            onClick={handleCreate}
            className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 font-medium"
          >
            <Plus className="w-5 h-5" />
            Get Started
          </button>
          <button
            onClick={() => navigate('/dashboard/appbuilder/modules')}
            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 flex items-center gap-2 font-medium"
          >
            View Modules
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderEmptyState;




