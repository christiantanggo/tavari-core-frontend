// Step 129: Create AppBuilderBusinessSelectorIntegration component
// Integrate with business selector (keyboard shortcut g b)
import React, { useEffect } from 'react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { useAppBuilderBranding } from '../../hooks/useAppBuilderBranding';

const AppBuilderBusinessSelectorIntegration = () => {
  const { selectedBusinessId } = useBusinessContext();
  const { refresh } = useAppBuilderBranding();

  // Load branding when business changes
  useEffect(() => {
    if (selectedBusinessId) {
      refresh();
    }
  }, [selectedBusinessId, refresh]);

  // Keyboard shortcut handler (g b for business selector)
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Check for g + b sequence
      if (e.key === 'g' || e.key === 'b') {
        // Focus business selector if available
        const businessSelector = document.querySelector('.selector');
        if (businessSelector && e.key === 'b' && e.ctrlKey) {
          e.preventDefault();
          businessSelector.focus();
          businessSelector.click();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, []);

  return null; // This is a utility component, no UI
};

export default AppBuilderBusinessSelectorIntegration;




