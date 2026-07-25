// Step 114: Create AppBuilderOnboarding component
// Onboarding wizard for new users
import React, { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AppBuilderOnboarding = ({ onComplete, onSkip }) => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const steps = [
    {
      id: 1,
      title: 'Welcome to App Builder',
      description: 'Create a custom iOS and Android app with your branding',
      content: (
        <div className="text-center space-y-4">
          <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
            <span className="text-4xl">📱</span>
          </div>
          <p className="text-gray-600">
            Get started by configuring your app's branding and selecting which modules to include.
          </p>
        </div>
      )
    },
    {
      id: 2,
      title: 'Choose a Template (Optional)',
      description: 'Start with a pre-configured template or build from scratch',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['Restaurant', 'Retail', 'General'].map((template) => (
              <button
                key={template}
                onClick={() => setSelectedTemplate(template)}
                className={`p-4 border-2 rounded-lg text-left transition-all ${
                  selectedTemplate === template
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{template}</h3>
                  {selectedTemplate === template && (
                    <Check className="w-5 h-5 text-blue-500" />
                  )}
                </div>
                <p className="text-sm text-gray-600">
                  Pre-configured modules and settings for {template.toLowerCase()} businesses
                </p>
              </button>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 3,
      title: 'Configure Branding',
      description: 'Set up your app name, colors, and logo',
      content: (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              You'll be able to customize your app's branding after setup. This includes:
            </p>
            <ul className="mt-2 text-sm text-blue-700 list-disc list-inside space-y-1">
              <li>App name and colors</li>
              <li>Logo and favicon</li>
              <li>PWA settings</li>
              <li>Legal information</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 4,
      title: 'Select Modules',
      description: 'Choose which Tavari modules to include in your app',
      content: (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              You can enable or disable modules at any time. Start with the modules you need most,
              and add more later as your business grows.
            </p>
          </div>
        </div>
      )
    }
  ];

  const totalSteps = steps.length;
  const progress = (currentStep / totalSteps) * 100;

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    if (onComplete) {
      onComplete({ selectedTemplate });
    } else {
      navigate('/dashboard/appbuilder/branding');
    }
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    } else {
      navigate('/dashboard/appbuilder');
    }
  };

  const currentStepData = steps.find(s => s.id === currentStep);

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">App Builder Setup</h2>
            <p className="text-sm text-gray-600">Step {currentStep} of {totalSteps}</p>
          </div>
          <button
            onClick={handleSkip}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="h-2 bg-gray-200">
          <div
            className="h-2 bg-blue-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {currentStepData?.title}
            </h3>
            <p className="text-gray-600">{currentStepData?.description}</p>
          </div>

          <div className="min-h-[300px]">
            {currentStepData?.content}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t">
          <button
            onClick={handleSkip}
            className="text-gray-600 hover:text-gray-800 text-sm font-medium"
          >
            Skip Setup
          </button>
          <div className="flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
            >
              {currentStep === totalSteps ? 'Complete Setup' : 'Next'}
              {currentStep < totalSteps && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderOnboarding;




