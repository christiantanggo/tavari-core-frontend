// src/hooks/useDigitalSignage.js
import { useState, useEffect, useCallback } from 'react';
import { useBusiness } from '../contexts/BusinessContext';
import digitalSignageService from '../services/DigitalSignageService';

/**
 * Hook for managing digital signage data
 * Pattern: Matches useAdManager structure
 */
export const useDigitalSignage = () => {
  const { business } = useBusiness();
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializedBusinessId, setInitializedBusinessId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Data state
  const [screens, setScreens] = useState([]);
  const [content, setContent] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [screenGroups, setScreenGroups] = useState([]);
  const [zones, setZones] = useState([]);
  const [ads, setAds] = useState([]);
  const [templates, setTemplates] = useState([]);

  // Initialize service when business changes
  useEffect(() => {
    if (business?.id && initializedBusinessId !== business.id) {
      try {
        digitalSignageService.initialize(business.id);
        setScreens([]);
        setContent([]);
        setSchedules([]);
        setScreenGroups([]);
        setZones([]);
        setAds([]);
        setTemplates([]);
        setInitializedBusinessId(business.id);
        setIsInitialized(true);
      } catch (err) {
        console.error('Error initializing digital signage service:', err);
        setError(err.message);
      }
    } else if (!business?.id) {
      setIsInitialized(false);
      setScreens([]);
      setContent([]);
      setSchedules([]);
      setScreenGroups([]);
      setZones([]);
      setAds([]);
      setTemplates([]);
      setInitializedBusinessId(null);
    }
  }, [business?.id, initializedBusinessId]);

  /**
   * Load screens
   */
  const loadScreens = useCallback(async () => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await digitalSignageService.loadScreens();
      setScreens(data);
    } catch (err) {
      console.error('Error loading screens:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load content
   */
  const loadContent = useCallback(async (filters = {}) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await digitalSignageService.loadContent(filters);
      setContent(data);
    } catch (err) {
      console.error('Error loading content:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load schedules
   */
  const loadSchedules = useCallback(async (filters = {}) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await digitalSignageService.loadSchedules(filters);
      setSchedules(data);
    } catch (err) {
      console.error('Error loading schedules:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load screen groups
   */
  const loadScreenGroups = useCallback(async () => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await digitalSignageService.loadScreenGroups();
      setScreenGroups(data);
    } catch (err) {
      console.error('Error loading screen groups:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load zones
   */
  const loadZones = useCallback(async (filters = {}) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await digitalSignageService.loadZones(filters);
      setZones(data);
    } catch (err) {
      console.error('Error loading zones:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Update zone
   */
  const updateZone = useCallback(async (zoneId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await digitalSignageService.updateZone(zoneId, updates);
      await loadZones(); // Reload zones
      return updated;
    } catch (err) {
      console.error('Error updating zone:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadZones]);

  /**
   * Delete zone
   */
  const deleteZone = useCallback(async (zoneId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await digitalSignageService.deleteZone(zoneId);
      await loadZones(); // Reload zones
    } catch (err) {
      console.error('Error deleting zone:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadZones]);

  /**
   * Load ads
   */
  const loadAds = useCallback(async (filters = {}) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await digitalSignageService.loadAds(filters);
      setAds(data);
    } catch (err) {
      console.error('Error loading ads:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Update ad
   */
  const updateAd = useCallback(async (adId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await digitalSignageService.updateAd(adId, updates);
      await loadAds(); // Reload ads
      return updated;
    } catch (err) {
      console.error('Error updating ad:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadAds]);

  /**
   * Delete ad
   */
  const deleteAd = useCallback(async (adId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await digitalSignageService.deleteAd(adId);
      await loadAds(); // Reload ads
    } catch (err) {
      console.error('Error deleting ad:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadAds]);

  /**
   * Load templates
   */
  const loadTemplates = useCallback(async (filters = {}) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await digitalSignageService.loadTemplates(filters);
      setTemplates(data);
    } catch (err) {
      console.error('Error loading templates:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Create screen
   */
  const createScreen = useCallback(async (screenData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newScreen = await digitalSignageService.createScreen(screenData);
      await loadScreens(); // Reload screens
      return newScreen;
    } catch (err) {
      console.error('Error creating screen:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadScreens]);

  /**
   * Update screen
   */
  const updateScreen = useCallback(async (screenId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await digitalSignageService.updateScreen(screenId, updates);
      await loadScreens(); // Reload screens
      return updated;
    } catch (err) {
      console.error('Error updating screen:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadScreens]);

  /**
   * Delete screen
   */
  const deleteScreen = useCallback(async (screenId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await digitalSignageService.deleteScreen(screenId);
      await loadScreens(); // Reload screens
    } catch (err) {
      console.error('Error deleting screen:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadScreens]);

  /**
   * Upload content
   */
  const uploadContent = useCallback(async (file, metadata = {}, onProgress = null) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newContent = await digitalSignageService.uploadContent(file, metadata, onProgress);
      await loadContent(); // Reload content
      return newContent;
    } catch (err) {
      console.error('Error uploading content:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadContent]);

  /**
   * Create schedule
   */
  const createSchedule = useCallback(async (scheduleData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newSchedule = await digitalSignageService.createSchedule(scheduleData);
      await loadSchedules(); // Reload schedules
      return newSchedule;
    } catch (err) {
      console.error('Error creating schedule:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadSchedules]);

  /**
   * Update schedule
   */
  const updateSchedule = useCallback(async (scheduleId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await digitalSignageService.updateSchedule(scheduleId, updates);
      await loadSchedules(); // Reload schedules
      return updated;
    } catch (err) {
      console.error('Error updating schedule:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadSchedules]);

  /**
   * Delete schedule
   */
  const deleteSchedule = useCallback(async (scheduleId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await digitalSignageService.deleteSchedule(scheduleId);
      await loadSchedules(); // Reload schedules
    } catch (err) {
      console.error('Error deleting schedule:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadSchedules]);

  /**
   * Create screen group
   */
  const createScreenGroup = useCallback(async (groupData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newGroup = await digitalSignageService.createScreenGroup(groupData);
      await loadScreenGroups(); // Reload groups
      return newGroup;
    } catch (err) {
      console.error('Error creating screen group:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadScreenGroups]);

  /**
   * Create zone
   */
  const createZone = useCallback(async (zoneData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newZone = await digitalSignageService.createZone(zoneData);
      await loadZones(); // Reload zones
      return newZone;
    } catch (err) {
      console.error('Error creating zone:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadZones]);

  /**
   * Create ad
   */
  const createAd = useCallback(async (adData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newAd = await digitalSignageService.createAd(adData);
      await loadAds(); // Reload ads
      return newAd;
    } catch (err) {
      console.error('Error creating ad:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadAds]);

  /**
   * Delete content
   */
  const deleteContent = useCallback(async (contentId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await digitalSignageService.deleteContent(contentId);
      await loadContent(); // Reload content
    } catch (err) {
      console.error('Error deleting content:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadContent]);

  /**
   * Update content
   */
  const updateContent = useCallback(async (contentId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await digitalSignageService.updateContent(contentId, updates);
      await loadContent(); // Reload content
      return updated;
    } catch (err) {
      console.error('Error updating content:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadContent]);

  /**
   * Check schedule conflicts
   */
  const checkScheduleConflicts = useCallback(async (params) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      return await digitalSignageService.checkScheduleConflicts(params);
    } catch (err) {
      console.error('Error checking conflicts:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized]);

  /**
   * Load playlist items for a schedule
   */
  const loadScheduleItems = useCallback(async (scheduleId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      return await digitalSignageService.loadScheduleItems(scheduleId);
    } catch (err) {
      console.error('Error loading schedule items:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized]);

  /**
   * Replace playlist items for a schedule
   */
  const replaceScheduleItems = useCallback(async (scheduleId, items, options = {}) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await digitalSignageService.replaceScheduleItems(scheduleId, items, options);
      await loadSchedules();
    } catch (err) {
      console.error('Error saving schedule items:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadSchedules]);

  return {
    // State
    isInitialized,
    loading,
    error,
    screens,
    content,
    schedules,
    screenGroups,
    zones,
    ads,
    templates,

    // Actions
    loadScreens,
    loadContent,
    loadSchedules,
    loadScreenGroups,
    loadZones,
    loadAds,
    loadTemplates,
    createScreen,
    updateScreen,
    deleteScreen,
    uploadContent,
    deleteContent,
    updateContent,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    loadScheduleItems,
    replaceScheduleItems,
    createScreenGroup,
    createZone,
    updateZone,
    deleteZone,
    createAd,
    updateAd,
    deleteAd,
    checkScheduleConflicts,

    // Refresh all
    refresh: async () => {
      await Promise.all([
        loadScreens(),
        loadContent(),
        loadSchedules(),
        loadScreenGroups(),
        loadZones(),
        loadAds(),
        loadTemplates()
      ]);
    }
  };
};

export default useDigitalSignage;

