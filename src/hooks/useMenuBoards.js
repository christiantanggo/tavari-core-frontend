// src/hooks/useMenuBoards.js
import { useState, useEffect, useCallback } from 'react';
import { useBusiness } from '../contexts/BusinessContext';
import menuBoardService from '../services/MenuBoardService';

/**
 * Hook for managing menu boards
 */
export const useMenuBoards = () => {
  const { business } = useBusiness();
  const [isInitialized, setIsInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Data state
  const [menuBoards, setMenuBoards] = useState([]);
  const [currentBoard, setCurrentBoard] = useState(null);
  const [availableProducts, setAvailableProducts] = useState([]);

  // Initialize service when business changes
  useEffect(() => {
    if (business?.id && !isInitialized) {
      try {
        menuBoardService.initialize(business.id);
        setIsInitialized(true);
      } catch (err) {
        console.error('Error initializing menu board service:', err);
        setError(err.message);
      }
    } else if (!business?.id) {
      setIsInitialized(false);
      setMenuBoards([]);
      setCurrentBoard(null);
      setAvailableProducts([]);
    }
  }, [business?.id, isInitialized]);

  /**
   * Load menu boards
   */
  const loadMenuBoards = useCallback(async () => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await menuBoardService.loadMenuBoards();
      setMenuBoards(data);
    } catch (err) {
      console.error('Error loading menu boards:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load menu board by ID
   */
  const loadMenuBoard = useCallback(async (boardId) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await menuBoardService.loadMenuBoard(boardId);
      setCurrentBoard(data);
      return data;
    } catch (err) {
      console.error('Error loading menu board:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Load available products
   */
  const loadAvailableProducts = useCallback(async (categoryIds = []) => {
    if (!isInitialized) return;

    try {
      setLoading(true);
      setError(null);
      const data = await menuBoardService.loadAvailableProducts(categoryIds);
      setAvailableProducts(data);
    } catch (err) {
      console.error('Error loading products:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isInitialized]);

  /**
   * Create menu board
   */
  const createMenuBoard = useCallback(async (boardData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const newBoard = await menuBoardService.createMenuBoard(boardData);
      await loadMenuBoards();
      return newBoard;
    } catch (err) {
      console.error('Error creating menu board:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadMenuBoards]);

  /**
   * Update menu board
   */
  const updateMenuBoard = useCallback(async (boardId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await menuBoardService.updateMenuBoard(boardId, updates);
      await loadMenuBoards();
      if (currentBoard?.id === boardId) {
        await loadMenuBoard(boardId);
      }
      return updated;
    } catch (err) {
      console.error('Error updating menu board:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadMenuBoards, currentBoard, loadMenuBoard]);

  /**
   * Delete menu board
   */
  const deleteMenuBoard = useCallback(async (boardId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await menuBoardService.deleteMenuBoard(boardId);
      await loadMenuBoards();
      if (currentBoard?.id === boardId) {
        setCurrentBoard(null);
      }
    } catch (err) {
      console.error('Error deleting menu board:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, loadMenuBoards, currentBoard]);

  /**
   * Add product to board
   */
  const addProductToBoard = useCallback(async (boardId, itemData) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const item = await menuBoardService.addProductToBoard(boardId, itemData);
      if (currentBoard?.id === boardId) {
        await loadMenuBoard(boardId);
      }
      return item;
    } catch (err) {
      console.error('Error adding product to board:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentBoard, loadMenuBoard]);

  /**
   * Update menu item
   */
  const updateMenuItem = useCallback(async (itemId, updates) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      const updated = await menuBoardService.updateMenuItem(itemId, updates);
      if (currentBoard) {
        await loadMenuBoard(currentBoard.id);
      }
      return updated;
    } catch (err) {
      console.error('Error updating menu item:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentBoard, loadMenuBoard]);

  /**
   * Remove product from board
   */
  const removeProductFromBoard = useCallback(async (itemId) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await menuBoardService.removeProductFromBoard(itemId);
      if (currentBoard) {
        await loadMenuBoard(currentBoard.id);
      }
    } catch (err) {
      console.error('Error removing product from board:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentBoard, loadMenuBoard]);

  /**
   * Reorder menu items
   */
  const reorderMenuItems = useCallback(async (boardId, itemOrders) => {
    if (!isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      setError(null);
      await menuBoardService.reorderMenuItems(boardId, itemOrders);
      if (currentBoard?.id === boardId) {
        await loadMenuBoard(boardId);
      }
    } catch (err) {
      console.error('Error reordering menu items:', err);
      setError(err.message);
      throw err;
    }
  }, [isInitialized, currentBoard, loadMenuBoard]);

  return {
    // State
    isInitialized,
    loading,
    error,
    menuBoards,
    currentBoard,
    availableProducts,

    // Actions
    loadMenuBoards,
    loadMenuBoard,
    loadAvailableProducts,
    createMenuBoard,
    updateMenuBoard,
    deleteMenuBoard,
    addProductToBoard,
    updateMenuItem,
    removeProductFromBoard,
    reorderMenuItems,

    // Refresh
    refresh: async () => {
      await Promise.all([
        loadMenuBoards(),
        currentBoard && loadMenuBoard(currentBoard.id)
      ]);
    }
  };
};



