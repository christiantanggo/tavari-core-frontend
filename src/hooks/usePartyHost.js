// src/hooks/usePartyHost.js
import { useState, useEffect, useCallback } from 'react';
import { useBusiness } from '../contexts/BusinessContext';
import partyHostService from '../services/PartyHostService';

/**
 * Hook for managing party hosts
 */
export const usePartyHost = () => {
  const { business } = useBusiness();
  const [isInitialized, setIsInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Data state
  const [partyHosts, setPartyHosts] = useState([]);
  const [currentHost, setCurrentHost] = useState(null);
  const [availableEvents, setAvailableEvents] = useState([]);

  // Initialize service when business changes
  useEffect(() => {
    if (business?.id && !isInitialized) {
      try {
        partyHostService.initialize(business.id);
        setIsInitialized(true);
      } catch (err) {
        console.error('Error initializing party host service:', err);
        setError(err.message);
      }
    } else if (!business?.id) {
      setIsInitialized(false);
      setPartyHosts([]);
      setCurrentHost(null);
      setAvailableEvents([]);
    }
  }, [business?.id, isInitialized]);

  /**
   * Load party hosts
   */
  const loadPartyHosts = useCallback(async () => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await partyHostService.loadPartyHosts();
      setPartyHosts(data);
    } catch (err) {
      console.error('Error loading party hosts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load party host by ID
   */
  const loadPartyHost = useCallback(async (hostId) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await partyHostService.loadPartyHost(hostId);
      setCurrentHost(data);
      return data;
    } catch (err) {
      console.error('Error loading party host:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load available events
   */
  const loadAvailableEvents = useCallback(async () => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await partyHostService.loadAvailableEvents();
      setAvailableEvents(data);
    } catch (err) {
      console.error('Error loading events:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Create party host
   */
  const createPartyHost = useCallback(async (hostData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newHost = await partyHostService.createPartyHost(hostData);
      await loadPartyHosts();
      return newHost;
    } catch (err) {
      console.error('Error creating party host:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadPartyHosts]);

  /**
   * Update party host
   */
  const updatePartyHost = useCallback(async (hostId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await partyHostService.updatePartyHost(hostId, updates);
      await loadPartyHosts();
      if (currentHost?.id === hostId) {
        await loadPartyHost(hostId);
      }
      return updated;
    } catch (err) {
      console.error('Error updating party host:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadPartyHosts, currentHost, loadPartyHost]);

  /**
   * Delete party host
   */
  const deletePartyHost = useCallback(async (hostId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await partyHostService.deletePartyHost(hostId);
      await loadPartyHosts();
      if (currentHost?.id === hostId) {
        setCurrentHost(null);
      }
    } catch (err) {
      console.error('Error deleting party host:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadPartyHosts, currentHost]);

  /**
   * Add sequence
   */
  const addSequence = useCallback(async (hostId, sequenceData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const sequence = await partyHostService.addSequence(hostId, sequenceData);
      if (currentHost?.id === hostId) {
        await loadPartyHost(hostId);
      }
      return sequence;
    } catch (err) {
      console.error('Error adding sequence:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentHost, loadPartyHost]);

  /**
   * Update sequence
   */
  const updateSequence = useCallback(async (sequenceId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await partyHostService.updateSequence(sequenceId, updates);
      if (currentHost) {
        await loadPartyHost(currentHost.id);
      }
      return updated;
    } catch (err) {
      console.error('Error updating sequence:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentHost, loadPartyHost]);

  /**
   * Delete sequence
   */
  const deleteSequence = useCallback(async (sequenceId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await partyHostService.deleteSequence(sequenceId);
      if (currentHost) {
        await loadPartyHost(currentHost.id);
      }
    } catch (err) {
      console.error('Error deleting sequence:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentHost, loadPartyHost]);

  /**
   * Upload photo
   */
  const uploadPhoto = useCallback(async (hostId, file, metadata, onProgress) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const photo = await partyHostService.uploadPhoto(hostId, file, metadata, onProgress);
      if (currentHost?.id === hostId) {
        await loadPartyHost(hostId);
      }
      return photo;
    } catch (err) {
      console.error('Error uploading photo:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentHost, loadPartyHost]);

  /**
   * Delete photo
   */
  const deletePhoto = useCallback(async (photoId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await partyHostService.deletePhoto(photoId);
      if (currentHost) {
        await loadPartyHost(currentHost.id);
      }
    } catch (err) {
      console.error('Error deleting photo:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentHost, loadPartyHost]);

  /**
   * Auto-schedule from booking
   */
  const autoScheduleFromBooking = useCallback(async (eventId, screenId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const host = await partyHostService.autoScheduleFromBooking(eventId, screenId);
      await loadPartyHosts();
      return host;
    } catch (err) {
      console.error('Error auto-scheduling party host:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadPartyHosts]);

  return {
    // State
    isInitialized,
    loading,
    error,
    partyHosts,
    currentHost,
    availableEvents,

    // Actions
    loadPartyHosts,
    loadPartyHost,
    loadAvailableEvents,
    createPartyHost,
    updatePartyHost,
    deletePartyHost,
    addSequence,
    updateSequence,
    deleteSequence,
    uploadPhoto,
    deletePhoto,
    autoScheduleFromBooking,

    // Refresh
    refresh: async () => {
      await Promise.all([
        loadPartyHosts(),
        currentHost && loadPartyHost(currentHost.id)
      ]);
    }
  };
};



