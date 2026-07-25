import React from 'react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import TavariTabSystemComponent from '../UI/TavariTabSystemComponent';

const POSInventoryManagementTabs = () => {
  const auth = usePOSAuth({
    requiredRoles: null,
    requireBusiness: true,
    componentName: 'POSInventoryManagementTabs'
  });

  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges
  } = usePermissions();

  const canViewInventory = hasAnyPermission([
    'pos.inventory.view',
    'pos.inventory.create',
    'pos.inventory.edit'
  ]) || hasElevatedPrivileges() || (
    auth.isReady &&
    auth.userRole &&
    ['employee', 'manager', 'owner'].includes(auth.userRole)
  );

  const canViewCategories = hasAnyPermission([
    'pos.categories.view',
    'pos.categories.edit',
    'pos.categories.create',
    'pos.categories.update',
    'pos.categories.delete',
    'pos.categories.reorder',
    'pos.categories.manage',
    'pos.inventory.view'
  ]) || hasElevatedPrivileges();

  const canViewModifiers = hasAnyPermission([
    'pos.modifiers.view',
    'pos.modifiers.create',
    'pos.modifiers.edit',
    'pos.modifiers.update',
    'pos.modifiers.delete',
    'pos.modifiers.manage_items'
  ]) || hasElevatedPrivileges() || hasPermission('pos.modifiers.manage_items');

  const tabs = [
    { id: 'inventory', label: 'Inventory', path: '/dashboard/pos/inventory', visible: canViewInventory },
    { id: 'bundles', label: 'Bundles', path: '/dashboard/pos/bundles', visible: canViewInventory },
    { id: 'categories', label: 'Categories', path: '/dashboard/pos/categories', visible: canViewCategories },
    { id: 'modifiers', label: 'Modifiers', path: '/dashboard/pos/modifiers', visible: canViewModifiers }
  ].filter((tab) => tab.visible);

  if (tabs.length <= 1) {
    return null;
  }

  return (
    <TavariTabSystemComponent
      tabs={tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        to: tab.path,
        visible: tab.visible
      }))}
      mode="route"
      ariaLabel="POS inventory management"
      fullWidth={true}
    />
  );
};

export default POSInventoryManagementTabs;
