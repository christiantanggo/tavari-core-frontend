// Step 58: Create useWaiverTemplates hook
// Hook for waiver template operations
import { useState, useEffect, useCallback } from 'react';
import WaiverTemplateService from '../services/Waivers/WaiverTemplateService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useWaiverTemplates = (filters = {}) => {
  const { selectedBusinessId } = useBusinessContext();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    WaiverTemplateService.setBusinessId(selectedBusinessId);
    loadTemplates();
  }, [selectedBusinessId, JSON.stringify(filters)]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await WaiverTemplateService.getTemplates(filters);
      setTemplates(data || []);
    } catch (err) {
      console.error('Error loading templates:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createTemplate = useCallback(async (templateData) => {
    try {
      setError(null);
      const newTemplate = await WaiverTemplateService.createTemplate(templateData);
      await loadTemplates();
      return newTemplate;
    } catch (err) {
      console.error('Error creating template:', err);
      setError(err.message);
      throw err;
    }
  }, []);

  const updateTemplate = useCallback(async (templateId, templateData) => {
    try {
      setError(null);
      const updated = await WaiverTemplateService.updateTemplate(templateId, templateData);
      await loadTemplates();
      return updated;
    } catch (err) {
      console.error('Error updating template:', err);
      setError(err.message);
      throw err;
    }
  }, []);

  const createTemplateVersion = useCallback(async (templateId, templateData) => {
    try {
      setError(null);
      const created = await WaiverTemplateService.createTemplateVersion(templateId, templateData);
      await loadTemplates();
      return created;
    } catch (err) {
      console.error('Error creating waiver template version:', err);
      setError(err.message);
      throw err;
    }
  }, []);

  const deleteTemplate = useCallback(async (templateId) => {
    try {
      setError(null);
      await WaiverTemplateService.deleteTemplate(templateId);
      await loadTemplates();
      return true;
    } catch (err) {
      console.error('Error deleting template:', err);
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    templates,
    loading,
    error,
    createTemplate,
    updateTemplate,
    createTemplateVersion,
    deleteTemplate,
    refresh: loadTemplates
  };
};




