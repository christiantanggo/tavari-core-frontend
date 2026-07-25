// src/screens/DigitalSignage/MenuBoardDesignScreen.jsx
import React, { useState, useEffect } from 'react';
import { FiGrid, FiList, FiPlus, FiEdit, FiTrash2, FiImage, FiDollarSign } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import { useMenuBoards } from '../../hooks/useMenuBoards';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import MenuBoardDesignModal from '../../components/DigitalSignage/MenuBoardDesignModal';

const MenuBoardDesignScreen = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'MenuBoardDesignScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    menuBoards,
    loading,
    error,
    loadMenuBoards,
    createMenuBoard,
    updateMenuBoard,
    deleteMenuBoard
  } = useMenuBoards();

  const {
    screens,
    loadScreens
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadMenuBoards();
      loadScreens();
    }
  }, [auth.selectedBusinessId]);

  const canCreate = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();
  const canEdit = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();
  const canDelete = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();

  const mapBoardFormToDb = (boardData) => ({
    board_name: boardData.name,
    screen_id: boardData.screenId || null,
    layout_type: boardData.layoutType,
    theme_color: boardData.themeColor,
    background_color: boardData.backgroundColor,
    background_image_url: boardData.backgroundImageUrl || null,
    font_family: boardData.fontFamily,
    header_text: boardData.headerText || null,
    header_image_url: boardData.headerImageUrl || null,
    show_prices: boardData.showPrices,
    show_descriptions: boardData.showDescriptions,
    show_categories: boardData.showCategories,
    items_per_row: boardData.itemsPerRow,
    auto_refresh_interval_seconds: boardData.autoRefreshInterval,
    category_ids: boardData.categoryIds || null,
    show_only_active: boardData.showOnlyActive
  });

  const handleCreate = async (boardData) => {
    try {
      if (selectedBoard?.id) {
        await updateMenuBoard(selectedBoard.id, mapBoardFormToDb(boardData));
      } else {
        await createMenuBoard(boardData);
      }
      setShowCreateModal(false);
      setSelectedBoard(null);
    } catch (err) {
      toast.error(`Failed to save menu board: ${err.message}`);
    }
  };

  const handleDelete = async (boardId) => {
    if (!window.confirm('Are you sure you want to delete this menu board?')) {
      return;
    }

    try {
      await deleteMenuBoard(boardId);
      toast.success('Menu board deleted successfully');
    } catch (err) {
      toast.error(`Failed to delete menu board: ${err.message}`);
    }
  };

  const getLayoutIcon = (layoutType) => {
    switch (layoutType) {
      case 'grid':
        return <FiGrid />;
      case 'list':
        return <FiList />;
      default:
        return <FiGrid />;
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layouts.container,
      padding: TavariStyles.spacing.xl
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      ...TavariStyles.typography.heading.h1
    },
    button: {
      ...TavariStyles.components.button.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    card: {
      ...TavariStyles.components.card,
      padding: TavariStyles.spacing.lg,
      cursor: 'pointer',
      transition: 'transform 0.2s, box-shadow 0.2s'
    },
    cardHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'start',
      marginBottom: TavariStyles.spacing.md
    },
    cardTitle: {
      ...TavariStyles.typography.heading.h3,
      marginBottom: TavariStyles.spacing.xs
    },
    cardMeta: {
      ...TavariStyles.typography.body,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    statusBadge: {
      display: 'inline-flex',
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      backgroundColor: `${TavariStyles.colors.success}20`,
      color: TavariStyles.colors.success
    },
    cardActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md
    },
    actionButton: {
      ...TavariStyles.components.button.secondary,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray600
    }
  };

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.content.view">
          <div style={styles.container}>
            <div style={styles.header}>
              <h1 style={styles.title}>
                <FiGrid style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
                Menu Boards
              </h1>
              {canCreate && (
                <button
                  style={styles.button}
                  onClick={() => setShowCreateModal(true)}
                >
                  <FiPlus /> Create Menu Board
                </button>
              )}
            </div>

            {loading && <div>Loading menu boards...</div>}
            {error && <div style={{ color: TavariStyles.colors.danger }}>Error: {error}</div>}

            {!loading && menuBoards.length === 0 && (
              <div style={styles.emptyState}>
                <FiGrid size={64} style={{ marginBottom: TavariStyles.spacing.lg, opacity: 0.3 }} />
                <h3>No menu boards created</h3>
                <p>Create your first menu board to display POS products</p>
                {canCreate && (
                  <button
                    style={{ ...styles.button, marginTop: TavariStyles.spacing.lg }}
                    onClick={() => setShowCreateModal(true)}
                  >
                    <FiPlus /> Create Menu Board
                  </button>
                )}
              </div>
            )}

            {!loading && menuBoards.length > 0 && (
              <div style={styles.grid}>
                {menuBoards.map((board) => (
                  <div key={board.id} style={styles.card}>
                    <div style={styles.cardHeader}>
                      <div>
                        <h3 style={styles.cardTitle}>{board.board_name}</h3>
                        {board.is_published && (
                          <span style={styles.statusBadge}>Published</span>
                        )}
                      </div>
                    </div>

                    <div style={styles.cardMeta}>
                      {getLayoutIcon(board.layout_type)}
                      {board.layout_type} layout
                    </div>
                    {board.screen && (
                      <div style={styles.cardMeta}>
                        Screen: {board.screen.screen_name}
                      </div>
                    )}
                    <div style={styles.cardMeta}>
                      <FiDollarSign />
                      {board.show_prices ? 'Prices shown' : 'Prices hidden'}
                    </div>

                    {(canEdit || canDelete) && (
                      <div style={styles.cardActions}>
                        {canEdit && (
                          <button
                            style={styles.actionButton}
                            onClick={() => {
                              setSelectedBoard(board);
                              setShowCreateModal(true);
                            }}
                          >
                            <FiEdit /> Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            style={{ ...styles.actionButton, color: TavariStyles.colors.danger }}
                            onClick={() => handleDelete(board.id)}
                          >
                            <FiTrash2 /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {showCreateModal && (
              <MenuBoardDesignModal
                onClose={() => {
                  setShowCreateModal(false);
                  setSelectedBoard(null);
                }}
                onSubmit={handleCreate}
                board={selectedBoard}
                screens={screens}
              />
            )}
          </div>
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default MenuBoardDesignScreen;

