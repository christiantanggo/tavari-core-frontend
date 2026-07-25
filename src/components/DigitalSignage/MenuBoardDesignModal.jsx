// src/components/DigitalSignage/MenuBoardDesignModal.jsx
import React, { useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

const MenuBoardDesignModal = ({ onClose, onSubmit, board = null, screens = [] }) => {
  const [formData, setFormData] = useState({
    name: board?.board_name || '',
    screenId: board?.screen_id || '',
    layoutType: board?.layout_type || 'grid',
    themeColor: board?.theme_color || '#3B82F6',
    backgroundColor: board?.background_color || '#FFFFFF',
    backgroundImageUrl: board?.background_image_url || '',
    fontFamily: board?.font_family || 'Arial',
    headerText: board?.header_text || '',
    headerImageUrl: board?.header_image_url || '',
    showPrices: board?.show_prices !== undefined ? board.show_prices : true,
    showDescriptions: board?.show_descriptions || false,
    showCategories: board?.show_categories !== undefined ? board.show_categories : true,
    itemsPerRow: board?.items_per_row || 3,
    autoRefreshInterval: board?.auto_refresh_interval_seconds || 60,
    categoryIds: board?.category_ids || [],
    showOnlyActive: board?.show_only_active !== undefined ? board.show_only_active : true
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await onSubmit({
        name: formData.name,
        screenId: formData.screenId || null,
        layoutType: formData.layoutType,
        themeColor: formData.themeColor,
        backgroundColor: formData.backgroundColor,
        backgroundImageUrl: formData.backgroundImageUrl || null,
        fontFamily: formData.fontFamily,
        headerText: formData.headerText || null,
        headerImageUrl: formData.headerImageUrl || null,
        showPrices: formData.showPrices,
        showDescriptions: formData.showDescriptions,
        showCategories: formData.showCategories,
        itemsPerRow: parseInt(formData.itemsPerRow),
        autoRefreshInterval: parseInt(formData.autoRefreshInterval),
        categoryIds: formData.categoryIds,
        showOnlyActive: formData.showOnlyActive
      });
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      setLoading(false);
    }
  };

  const styles = getDigitalSignageModalStyles({ maxWidth: '800px' });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 style={styles.title}>{board ? 'Edit Menu Board' : 'Create Menu Board'}</h2>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div style={styles.body}>
          <form style={styles.form} onSubmit={handleSubmit}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Menu Board Name *</label>
              <input
                style={styles.input}
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Main Menu Board"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Screen</label>
              <select
                style={styles.select}
                value={formData.screenId}
                onChange={(e) => setFormData({ ...formData, screenId: e.target.value })}
              >
                <option value="">No Screen (Template Only)</option>
                {screens.map(screen => (
                  <option key={screen.id} value={screen.id}>
                    {screen.screen_name}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Layout Type</label>
              <select
                style={styles.select}
                value={formData.layoutType}
                onChange={(e) => setFormData({ ...formData, layoutType: e.target.value })}
              >
                <option value="grid">Grid</option>
                <option value="list">List</option>
                <option value="carousel">Carousel</option>
                <option value="featured">Featured</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Theme Color</label>
                <input
                  style={styles.input}
                  type="color"
                  value={formData.themeColor}
                  onChange={(e) => setFormData({ ...formData, themeColor: e.target.value })}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Background Color</label>
                <input
                  style={styles.input}
                  type="color"
                  value={formData.backgroundColor}
                  onChange={(e) => setFormData({ ...formData, backgroundColor: e.target.value })}
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Header Text</label>
              <input
                style={styles.input}
                type="text"
                value={formData.headerText}
                onChange={(e) => setFormData({ ...formData, headerText: e.target.value })}
                placeholder="Welcome to Our Menu"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Items Per Row</label>
                <input
                  style={styles.input}
                  type="number"
                  min="1"
                  max="6"
                  value={formData.itemsPerRow}
                  onChange={(e) => setFormData({ ...formData, itemsPerRow: e.target.value })}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Auto-Refresh (seconds)</label>
                <input
                  style={styles.input}
                  type="number"
                  min="10"
                  value={formData.autoRefreshInterval}
                  onChange={(e) => setFormData({ ...formData, autoRefreshInterval: e.target.value })}
                />
              </div>
            </div>

            <div style={{ ...styles.formGroup, gap: TavariStyles.spacing.md }}>
              <TavariCheckbox
                id="menu-board-show-prices"
                checked={formData.showPrices}
                onChange={(checked) => setFormData({ ...formData, showPrices: checked })}
                label="Show Prices"
              />
              <TavariCheckbox
                id="menu-board-show-descriptions"
                checked={formData.showDescriptions}
                onChange={(checked) => setFormData({ ...formData, showDescriptions: checked })}
                label="Show Descriptions"
              />
              <TavariCheckbox
                id="menu-board-show-categories"
                checked={formData.showCategories}
                onChange={(checked) => setFormData({ ...formData, showCategories: checked })}
                label="Show Categories"
              />
              <TavariCheckbox
                id="menu-board-show-only-active"
                checked={formData.showOnlyActive}
                onChange={(checked) => setFormData({ ...formData, showOnlyActive: checked })}
                label="Show Only Active Products"
              />
            </div>

            <div style={styles.actions}>
              <button
                type="button"
                style={styles.buttonSecondary}
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={styles.buttonPrimary}
                disabled={loading}
              >
                {loading ? 'Saving...' : (board ? 'Update' : 'Create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default MenuBoardDesignModal;
