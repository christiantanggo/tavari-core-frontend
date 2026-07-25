// src/services/MenuBoardService.js
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';

class MenuBoardService {
  constructor() {
    this.businessId = null;
    this.isInitialized = false;
    this.cache = new Map();
  }

  initialize(businessId) {
    this.businessId = businessId;
    this.isInitialized = true;
  }

  clearCache() {
    this.cache.clear();
  }

  /**
   * Execute query with retry logic
   */
  async executeWithRetry(queryFn, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await queryFn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  /**
   * Load all menu boards
   * @returns {Promise<Array>} Array of menu boards
   */
  async loadMenuBoards() {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.executeWithRetry(() =>
        supabase
          .from('digital_signage_menu_boards')
          .select(`
            *,
            screen:digital_signage_screens(screen_name),
            template:digital_signage_templates(template_name)
          `)
          .eq('business_id', this.businessId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
      );

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading menu boards:', error);
      toast.error('Failed to load menu boards');
      throw error;
    }
  }

  /**
   * Load menu board by ID
   * @param {string} boardId - Menu board ID
   * @returns {Promise<Object>} Menu board with items
   */
  async loadMenuBoard(boardId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: board, error: boardError } = await supabase
        .from('digital_signage_menu_boards')
        .select('*')
        .eq('id', boardId)
        .eq('business_id', this.businessId)
        .single();

      if (boardError) throw boardError;

      // Load items with POS product data
      const { data: items, error: itemsError } = await supabase
        .from('digital_signage_menu_board_items')
        .select('*')
        .eq('menu_board_id', boardId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (itemsError) throw itemsError;

      // Fetch POS product data for each item
      const itemsWithProducts = await Promise.all(
        (items || []).map(async (item) => {
          const { data: product } = await supabase
            .from('pos_products')
            .select('*')
            .eq('id', item.pos_product_id)
            .eq('business_id', this.businessId)
            .single();

          return {
            ...item,
            product: product || null,
            displayName: item.display_name || product?.name || 'Unknown',
            displayPrice: item.display_price !== null ? item.display_price : product?.price || 0,
            imageUrl: item.custom_image_url || null
          };
        })
      );

      return {
        ...board,
        items: itemsWithProducts
      };
    } catch (error) {
      console.error('Error loading menu board:', error);
      toast.error('Failed to load menu board');
      throw error;
    }
  }

  /**
   * Load available POS products for menu board
   * @param {Array} categoryIds - Optional category IDs to filter
   * @returns {Promise<Array>} Array of POS products
   */
  async loadAvailableProducts(categoryIds = []) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      let query = supabase
        .from('pos_products')
        .select(`
          *,
          category:pos_categories(name, color, emoji)
        `)
        .eq('business_id', this.businessId)
        .eq('is_active', true);

      if (categoryIds.length > 0) {
        query = query.in('category_id', categoryIds);
      }

      query = query.order('name', { ascending: true });

      const { data, error } = await this.executeWithRetry(() => query);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading products:', error);
      toast.error('Failed to load products');
      throw error;
    }
  }

  /**
   * Create menu board
   * @param {Object} boardData - Board data
   * @returns {Promise<Object>} Created board
   */
  async createMenuBoard(boardData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const boardKey = `menu_board_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        board_name: boardData.name,
        board_key: boardKey,
        screen_id: boardData.screenId || null,
        template_id: boardData.templateId || null,
        layout_type: boardData.layoutType || 'grid',
        theme_color: boardData.themeColor || '#3B82F6',
        background_color: boardData.backgroundColor || '#FFFFFF',
        background_image_url: boardData.backgroundImageUrl || null,
        font_family: boardData.fontFamily || 'Arial',
        header_text: boardData.headerText || null,
        header_image_url: boardData.headerImageUrl || null,
        show_prices: boardData.showPrices !== undefined ? boardData.showPrices : true,
        show_descriptions: boardData.showDescriptions || false,
        show_categories: boardData.showCategories !== undefined ? boardData.showCategories : true,
        items_per_row: boardData.itemsPerRow || 3,
        auto_refresh_interval_seconds: boardData.autoRefreshInterval || 60,
        category_ids: boardData.categoryIds || null,
        show_only_active: boardData.showOnlyActive !== undefined ? boardData.showOnlyActive : true,
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_menu_boards')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Menu board created successfully');
      return data;
    } catch (error) {
      console.error('Error creating menu board:', error);
      toast.error('Failed to create menu board');
      throw error;
    }
  }

  /**
   * Update menu board
   * @param {string} boardId - Board ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated board
   */
  async updateMenuBoard(boardId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_menu_boards')
        .update(updates)
        .eq('id', boardId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Menu board updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating menu board:', error);
      toast.error('Failed to update menu board');
      throw error;
    }
  }

  /**
   * Delete menu board (soft delete)
   * @param {string} boardId - Board ID
   * @returns {Promise<void>}
   */
  async deleteMenuBoard(boardId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_menu_boards')
        .update({ is_active: false })
        .eq('id', boardId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Menu board deleted successfully');
    } catch (error) {
      console.error('Error deleting menu board:', error);
      toast.error('Failed to delete menu board');
      throw error;
    }
  }

  /**
   * Add product to menu board
   * @param {string} boardId - Board ID
   * @param {Object} itemData - Item data
   * @returns {Promise<Object>} Created item
   */
  async addProductToBoard(boardId, itemData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        menu_board_id: boardId,
        pos_product_id: itemData.productId,
        display_name: itemData.displayName || null,
        display_price: itemData.displayPrice !== undefined ? itemData.displayPrice : null,
        custom_image_url: itemData.customImageUrl || null,
        description: itemData.description || null,
        display_order: itemData.displayOrder || 0,
        is_featured: itemData.isFeatured || false,
        highlight_color: itemData.highlightColor || null,
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_menu_board_items')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Product added to menu board');
      return data;
    } catch (error) {
      console.error('Error adding product to board:', error);
      toast.error('Failed to add product to menu board');
      throw error;
    }
  }

  /**
   * Update menu board item
   * @param {string} itemId - Item ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated item
   */
  async updateMenuItem(itemId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_menu_board_items')
        .update(updates)
        .eq('id', itemId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Menu item updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating menu item:', error);
      toast.error('Failed to update menu item');
      throw error;
    }
  }

  /**
   * Remove product from menu board
   * @param {string} itemId - Item ID
   * @returns {Promise<void>}
   */
  async removeProductFromBoard(itemId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_menu_board_items')
        .update({ is_visible: false })
        .eq('id', itemId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Product removed from menu board');
    } catch (error) {
      console.error('Error removing product from board:', error);
      toast.error('Failed to remove product from menu board');
      throw error;
    }
  }

  /**
   * Reorder menu board items
   * @param {string} boardId - Board ID
   * @param {Array} itemOrders - Array of {id, displayOrder}
   * @returns {Promise<void>}
   */
  async reorderMenuItems(boardId, itemOrders) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const updates = itemOrders.map(({ id, displayOrder }) =>
        supabase
          .from('digital_signage_menu_board_items')
          .update({ display_order: displayOrder })
          .eq('id', id)
          .eq('business_id', this.businessId)
      );

      await Promise.all(updates);

      this.clearCache();
      toast.success('Menu items reordered');
    } catch (error) {
      console.error('Error reordering menu items:', error);
      toast.error('Failed to reorder menu items');
      throw error;
    }
  }
}

export default new MenuBoardService();



