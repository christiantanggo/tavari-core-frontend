// src/components/Settings/PermissionMatrix.jsx - FIXED with TavariCheckbox
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { X, AlertTriangle } from 'lucide-react';
import { PERMISSION_REGISTRY } from '../../utils/permissionRegistry';
import TavariCheckbox from '../UI/TavariCheckbox';
import { useModuleCatalog } from '../../hooks/useModuleCatalog';

/**
 * Maps PERMISSION_REGISTRY top-level keys to `app_modules` / `business_module_usage` module_key values.
 * A registry section is shown if ANY listed catalog module is enabled for the business.
 * Keys not listed fall back to [registryKey] (same name as catalog).
 * `settings` is always shown (core dashboard access, not tied to optional modules).
 */
const REGISTRY_TO_CATALOG_KEYS = {
  pos: ['pos'],
  inventory: ['pos'],
  hr: ['hr'],
  customers: ['pos'],
  dining: ['dining'],
  bookings: ['bookings'],
  waivers: ['waivers'],
  music: ['music'],
  mail: ['mail'],
  inbox: ['inbox'],
  reports: ['reports'],
  payments: ['payments', 'tavari_pay'],
  appbuilder: ['appbuilder'],
  reminders: ['reminders'],
};

function isRegistryModuleActive(registryKey, activatedCatalogKeys) {
  const key = String(registryKey || '').trim().toLowerCase();
  if (!key) return false;
  if (key === 'settings') return true;
  const mapped = Object.prototype.hasOwnProperty.call(REGISTRY_TO_CATALOG_KEYS, key)
    ? REGISTRY_TO_CATALOG_KEYS[key]
    : [key];
  return mapped.some((k) => activatedCatalogKeys.has(String(k).toLowerCase()));
}

const PermissionMatrix = ({ businessId, role, onClose, onSave }) => {
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedModules, setExpandedModules] = useState({});
  const [expandedPosPages, setExpandedPosPages] = useState({}); // per-page expand for POS

  const { activatedModules, loading: catalogLoading } = useModuleCatalog();
  const activatedCatalogKeys = useMemo(() => {
    const s = new Set();
    (activatedModules || []).forEach((m) => {
      const k = (m.module_key || '').trim().toLowerCase();
      if (k) s.add(k);
    });
    return s;
  }, [activatedModules]);

  useEffect(() => {
    loadRolePermissions();
  }, [role]);

  const loadRolePermissions = async () => {
    try {
      setLoading(true);

      // Load existing permissions for this role
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permission_key, granted')
        .eq('business_id', businessId)
        .eq('role_key', role.role_key);

      if (error) throw error;

      // Convert to object for easier lookup
      const permMap = {};
      data.forEach(perm => {
        permMap[perm.permission_key] = perm.granted;
      });

      setPermissions(permMap);

      // Start with all modules collapsed for a lighter first view
      setExpandedModules({});

      // Initialize POS per-page expansions based on current state
      try {
        const pages = getPosPages();
        const init = {};
        // Default collapsed to reduce overwhelm on first open
        pages.forEach((p) => { init[p.id] = false; });
        setExpandedPosPages(init);
      } catch { /* noop */ }

    } catch (err) {
      console.error('Error loading permissions:', err);
      toast.error('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  };

  // ===== GENERIC PAGE HELPERS (page-first UI for any module) =====
  const getModulePages = (moduleKey) => {
    const module = PERMISSION_REGISTRY[moduleKey];
    if (!module) return [];
    const pagesCat = (module.categories || []).find(c => c.name === 'Pages');
    if (!pagesCat) return [];

    // Group by base id: module.page.{view|edit}
    const map = new Map();
    pagesCat.permissions.forEach(p => {
      const base = p.key.replace(/\.(view|edit)$/i, '');
      const curr = map.get(base) || { id: base, name: p.name.split(' - ')[0], viewKey: `${base}.view`, editKey: `${base}.edit` };
      map.set(base, curr);
    });

    // Friendly names by id (module-specific overrides)
    const nameOverrides = {
      // POS
      'pos.register': 'Register',
      'pos.daily_deposit': 'Daily Deposit',
      'pos.inventory': 'Inventory',
      'pos.categories': 'Categories',
      'pos.modifiers': 'Modifiers / Variants',
      'pos.stations': 'Station Management',
      'pos.kitchen_display': 'Kitchen Display',
      'pos.discounts': 'Discounts',
      'pos.receipts': 'Receipts',
      'pos.settings': 'Settings',
      'pos.loyalty': 'Loyalty Settings',
      'pos.customers': 'Customer Management',
      // Dining
      'dining.dashboard': 'Dining Dashboard',
      'dining.table_map': 'Table Map',
      'dining.floor_editor': 'Floor Editor',
      'dining.reservations': 'Reservations',
      'dining.table_order': 'Table Orders',
      // Music
      'music.dashboard': 'Music Dashboard',
      'music.upload': 'Music Upload',
      'music.library': 'Music Library',
      'music.playlists': 'Playlists',
      'music.schedules': 'Schedules',
      'music.system_monitor': 'System Monitor',
      'music.ads': 'Ad Management',
      'music.settings': 'Music Settings',
      // Mail (Email Marketing)
      'mail.dashboard': 'Mail Dashboard',
      'mail.campaigns': 'Campaigns',
      'mail.contacts': 'Contacts',
      'mail.builder': 'Campaign Builder',
      'mail.templates': 'Templates',
      'mail.compliance': 'Compliance',
      'mail.billing': 'Billing',
      'mail.settings': 'Mail Settings',
      // Inbox
      'inbox.dashboard': 'Inbox Dashboard',
      'inbox.domains': 'Domain Management',
      'inbox.mailboxes': 'Mailboxes',
      'inbox.settings': 'Inbox Settings',
      // Inventory
      'inventory.stock': 'Stock Management',
      'inventory.purchasing': 'Purchasing',
      'inventory.suppliers': 'Suppliers',
      'inventory.reports': 'Reports',
      // HR
      'hr.employees': 'Employee Management',
      'hr.payroll': 'Payroll',
      'hr.documents': 'Documents',
      'hr.scheduling': 'Scheduling',
      'hr.time_off': 'Time Off'
    };

    const unique = Array.from(map.values()).map(p => ({
      ...p,
      name: nameOverrides[p.id] || p.name
    }));

    // Final dedupe safeguard by id
    const seen = new Set();
    return unique.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  };

  // Legacy helper for backward compatibility
  const getPosPages = () => getModulePages('pos');

  const getPageState = (page) => {
    const v = !!permissions[page.viewKey];
    const e = !!permissions[page.editKey];
    if (!v && !e) return 'none';        // Not Visible
    if (e || v) return 'edit';          // Single combined option: View & Edit
    return 'none';
  };

  const setPageState = (page, state, moduleKey) => {
    const isEdit = state === 'edit';
    setPermissions(prev => ({
      ...prev,
      [page.viewKey]: isEdit,
      [page.editKey]: isEdit
    }));
    // expand when not none
    setExpandedPosPages(prev => ({
      ...prev,
      [page.id]: state !== 'none'
    }));
  };

  // Legacy helpers for backward compatibility
  const getPosPageState = (page) => getPageState(page);
  const setPosPageState = (page, state) => setPageState(page, state, 'pos');

  // Granular helpers: each granular item has two states "view" and "edit"
  const getGranularState = (baseKey) => {
    const v = !!permissions[`${baseKey}.view`];
    const e = !!permissions[`${baseKey}.edit`];
    if (!v && !e) return 'none';
    if (v && !e) return 'view';
    if (e) return 'edit'; // edit implies view
    return 'none';
  };

  const setGranularState = (baseKey, state) => {
    setPermissions(prev => ({
      ...prev,
      [`${baseKey}.view`]: state === 'view' || state === 'edit',
      [`${baseKey}.edit`]: state === 'edit'
    }));
  };

  const togglePosPageExpand = (pageId) => {
    setExpandedPosPages(prev => ({
      ...prev,
      [pageId]: !prev[pageId]
    }));
  };

  const getGranularForPage = (moduleKey, pageId) => {
    const module = PERMISSION_REGISTRY[moduleKey];
    if (!module) return [];
    // Category names follow "Granular - Register" / "Granular - Stock Management"
    const suffix = pageId.split('.').slice(-1)[0]; // register, stock, etc.
    
    // Module-specific page name mappings
    const pageNameMap = {
      'pos': {
        'register': 'Register',
        'daily_deposit': 'Daily Deposit',
        'inventory': 'Inventory',
        'categories': 'Categories',
        'modifiers': 'Modifiers',
        'stations': 'Stations',
        'kitchen_display': 'Kitchen display',
        'discounts': 'Discounts',
        'receipts': 'Receipts',
        'settings': 'Settings',
        'loyalty': 'Loyalty'
      },
      'inventory': {
        'stock': 'Stock Management',
        'purchasing': 'Purchasing',
        'suppliers': 'Suppliers',
        'reports': 'Reports'
      },
        'hr': {
          'employees': 'Employee Management',
          'payroll': 'Payroll',
          'documents': 'Documents',
          'scheduling': 'Scheduling',
          'time_off': 'Time Off'
        },
        'customers': {
          'customers': 'Customer Management'
        },
        'dining': {
          'dashboard': 'Dining Dashboard',
          'table_map': 'Table Map',
          'floor_editor': 'Floor Editor',
          'reservations': 'Reservations',
          'table_order': 'Table Orders'
        },
        'music': {
          'dashboard': 'Music Dashboard',
          'upload': 'Music Upload',
          'library': 'Music Library',
          'playlists': 'Playlists',
          'schedules': 'Schedules',
          'system_monitor': 'System Monitor',
          'ads': 'Ad Management',
          'settings': 'Music Settings'
        },
        'mail': {
          'dashboard': 'Mail Dashboard',
          'campaigns': 'Campaigns',
          'contacts': 'Contacts',
          'builder': 'Campaign Builder',
          'templates': 'Templates',
          'compliance': 'Compliance',
          'billing': 'Billing',
          'settings': 'Mail Settings'
        },
        'inbox': {
          'dashboard': 'Inbox Dashboard',
          'domains': 'Domain Management',
          'mailboxes': 'Mailboxes',
          'settings': 'Inbox Settings'
        },
        'reports': {
          'dashboard': 'Reports Dashboard',
          'pos': 'POS Reports',
          'hr': 'HR Reports',
          'music': 'Music Reports',
          'mail': 'Mail Reports',
          'overview': 'Business Overview',
          'automation': 'Report Automation'
        },
        'settings': {
          'basic_info': 'Basic Info',
          'operating_hours': 'Operating Hours',
          'holiday_hours': 'Holiday Hours',
          'roles': 'Role Management',
          'branding': 'Branding & Colors',
          'scheduling': 'Scheduling Settings',
          'payments': 'Tavari Pay',
          'taxes': 'Tax Settings',
          'security': 'Security Settings'
        },
        'payments': {
          'processing': 'Payment Processing',
          'onboarding': 'Merchant Onboarding',
          'settlements': 'Settlements & Payouts',
          'refunds': 'Refunds & Disputes',
          'settings': 'Payment Settings'
        }
      };
    
    const pageName = pageNameMap[moduleKey]?.[suffix] || suffix.charAt(0).toUpperCase() + suffix.slice(1).replace(/_/g, ' ');
    const expectName = `Granular - ${pageName}`;
    const cat = (module.categories || []).find(c => c.name === expectName);
    return cat ? (cat.permissions || []) : [];
  };

  // Legacy helper for backward compatibility
  const getGranularForPosPage = (pageId) => getGranularForPage('pos', pageId);

  const togglePermission = (permissionKey) => {
    setPermissions(prev => ({
      ...prev,
      [permissionKey]: !prev[permissionKey]
    }));
  };

  const toggleModule = (moduleName) => {
    setExpandedModules(prev => ({
      ...prev,
      [moduleName]: !prev[moduleName]
    }));
  };

  const toggleAllInCategory = (moduleName, categoryName, value) => {
    const category = PERMISSION_REGISTRY[moduleName].categories
      .find(cat => cat.name === categoryName);
    
    if (!category) return;

    const newPermissions = { ...permissions };
    category.permissions.forEach(perm => {
      newPermissions[perm.key] = value;
    });
    setPermissions(newPermissions);
  };

  // Set all granular permissions within a module to View & Edit (i.e., .view and .edit true)
  const setAllGranularViewEditForModule = (moduleName) => {
    const module = PERMISSION_REGISTRY[moduleName];
    if (!module) return;
    const newPermissions = { ...permissions };

    // Check if module has page-first structure
    const pages = getModulePages(moduleName);
    if (pages.length > 0) {
      // For modules with pages (POS, Inventory, etc.), enable all pages and granular
      pages.forEach((page) => {
        // Force enable page-level access (view/edit)
        newPermissions[page.viewKey] = true;
        newPermissions[page.editKey] = true;

        const granular = getGranularForPage(moduleName, page.id);
        granular.forEach((perm) => {
          const baseKey = perm.key; // stored as base; UI saves as base.view/base.edit
          newPermissions[`${baseKey}.view`] = true;
          newPermissions[`${baseKey}.edit`] = true;
        });
      });
    } else {
      // For modules without pages, best-effort: set any known .view/.edit pairs true
      module.categories.forEach(category => {
        (category.permissions || []).forEach(perm => {
          // Treat key as base if it lacks suffix; create .view/.edit variants
          if (!perm.key.endsWith('.view') && !perm.key.endsWith('.edit')) {
            newPermissions[`${perm.key}.view`] = true;
            newPermissions[`${perm.key}.edit`] = true;
          } else {
            const base = perm.key.replace(/\.(view|edit)$/i, '');
            newPermissions[`${base}.view`] = true;
            newPermissions[`${base}.edit`] = true;
          }
        });
      });
    }

    setPermissions(newPermissions);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      // Delete existing permissions for this role
      await supabase
        .from('role_permissions')
        .delete()
        .eq('business_id', businessId)
        .eq('role_key', role.role_key);

      // Insert new permissions
      const permissionsToInsert = Object.entries(permissions)
        .map(([key, granted]) => ({
          business_id: businessId,
          role_key: role.role_key,
          permission_key: key,
          granted: granted || false
        }));

      if (permissionsToInsert.length > 0) {
        const { error } = await supabase
          .from('role_permissions')
          .insert(permissionsToInsert);

        if (error) throw error;
      }

      toast.success('Permissions saved successfully');
      onSave();
    } catch (err) {
      console.error('Error saving permissions:', err);
      toast.error('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const countPermissions = (moduleName) => {
    const module = PERMISSION_REGISTRY[moduleName];
    let total = 0;
    let granted = 0;

    module.categories.forEach(category => {
      category.permissions.forEach(perm => {
        total++;
        if (permissions[perm.key]) granted++;
      });
    });

    return { granted, total };
  };

  const countAllPermissions = () => {
    let total = 0;
    let granted = 0;

    Object.entries(PERMISSION_REGISTRY).forEach(([moduleName, module]) => {
      if (!isRegistryModuleActive(moduleName, activatedCatalogKeys)) return;
      module.categories.forEach(category => {
        category.permissions.forEach(perm => {
          total++;
          if (permissions[perm.key]) granted++;
        });
      });
    });

    return { granted, total };
  };

  const toggleAllPermissions = (value) => {
    const newPermissions = {};
    
    Object.entries(PERMISSION_REGISTRY).forEach(([moduleName, module]) => {
      if (!isRegistryModuleActive(moduleName, activatedCatalogKeys)) return;
      module.categories.forEach(category => {
        category.permissions.forEach(perm => {
          newPermissions[perm.key] = value;
        });
      });
    });
    
    setPermissions(newPermissions);
  };

  if (loading || catalogLoading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.loading}>Loading permissions...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>
              Manage Permissions: {role.role_name}
            </h3>
            <p style={styles.subtitle}>
              Select which features this role can access. Only modules enabled for this business are listed;
              System Settings always appears for core access control.
            </p>
          </div>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={20} />
          </button>
        </div>

        <div style={styles.content}>
          {/* POS page-first section */}
          {PERMISSION_REGISTRY.pos && isRegistryModuleActive('pos', activatedCatalogKeys) && (
            <div style={styles.moduleCard}>
              <div style={styles.moduleHeader} onClick={() => toggleModule('pos')}>
                <div style={styles.moduleInfo}>
                  <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.pos.icon}</span>
                  <div>
                    <h4 style={styles.moduleName}>Point of Sale (POS)</h4>
                    <p style={styles.moduleDescription}>Page access and granular actions</p>
                  </div>
                </div>
                <div style={styles.moduleStats}>
                  <span style={styles.expandIcon}>{expandedModules['pos'] ? '▼' : '▶'}</span>
                </div>
              </div>

              {expandedModules['pos'] && (
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setAllGranularViewEditForModule('pos')}
                      style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                      title="Set all granular permissions to View & Edit"
                    >
                      View & Edit all granular
                    </button>
                  </div>
                  {/* Page rows */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                    <div>Page</div>
                    <div style={{ textAlign: 'center' }}>Not Visible</div>
                    <div style={{ textAlign: 'center' }}>View / Edit</div>
                  </div>
                  {getPosPages().map((page) => {
                    const state = getPosPageState(page);
                    const expanded = !!expandedPosPages[page.id];
                    const granular = getGranularForPosPage(page.id);
                    const hasGranular = granular.length > 0;
                    return (
                      <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {hasGranular && (
                              <button
                                type="button"
                                onClick={() => togglePosPageExpand(page.id)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                title="Expand granular options"
                              >
                                {expanded ? '▼' : '▶'}
                              </button>
                            )}
                            <span>{page.name}</span>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <TavariCheckbox
                              checked={state === 'none'}
                              onChange={(checked) => checked && setPosPageState(page, 'none')}
                              label=""
                              size="md"
                              id={`pos-${page.id}-none`}
                            />
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <TavariCheckbox
                              checked={state === 'edit'}
                              onChange={(checked) => checked && setPosPageState(page, 'edit')}
                              label=""
                              size="md"
                              id={`pos-${page.id}-edit`}
                            />
                          </div>
                        </div>
                        {hasGranular && expanded && state !== 'none' && (
                          <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                            <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {granular.map((perm) => (
                                <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                  <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <TavariCheckbox
                                      checked={getGranularState(perm.key) === 'none'}
                                      onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                      label="Not Visible"
                                      size="sm"
                                      id={`perm-${perm.key}-none`}
                                    />
                                    <TavariCheckbox
                                      checked={getGranularState(perm.key) === 'view'}
                                      onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                      label="Visible"
                                      size="sm"
                                      id={`perm-${perm.key}-view`}
                                    />
                                    <TavariCheckbox
                                      checked={getGranularState(perm.key) === 'edit'}
                                      onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                      label="View & Edit"
                                      size="sm"
                                      id={`perm-${perm.key}-edit`}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Inventory page-first section */}
          {PERMISSION_REGISTRY.inventory && isRegistryModuleActive('inventory', activatedCatalogKeys) && (() => {
            const pages = getModulePages('inventory');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('inventory')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.inventory.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.inventory.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['inventory'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['inventory'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('inventory')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('inventory', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'inventory')}
                                label=""
                                size="md"
                                id={`inventory-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'inventory')}
                                label=""
                                size="md"
                                id={`inventory-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* HR page-first section */}
          {PERMISSION_REGISTRY.hr && isRegistryModuleActive('hr', activatedCatalogKeys) && (() => {
            const pages = getModulePages('hr');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('hr')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.hr.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.hr.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['hr'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['hr'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('hr')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('hr', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'hr')}
                                label=""
                                size="md"
                                id={`hr-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'hr')}
                                label=""
                                size="md"
                                id={`hr-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Customers page-first section */}
          {PERMISSION_REGISTRY.customers && isRegistryModuleActive('customers', activatedCatalogKeys) && (() => {
            const pages = getModulePages('customers');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('customers')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.customers.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.customers.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['customers'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['customers'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('customers')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('customers', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'customers')}
                                label=""
                                size="md"
                                id={`customers-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'customers')}
                                label=""
                                size="md"
                                id={`customers-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Dining page-first section */}
          {PERMISSION_REGISTRY.dining && isRegistryModuleActive('dining', activatedCatalogKeys) && (() => {
            const pages = getModulePages('dining');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('dining')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.dining.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.dining.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['dining'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['dining'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('dining')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('dining', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'dining')}
                                label=""
                                size="md"
                                id={`dining-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'dining')}
                                label=""
                                size="md"
                                id={`dining-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Music page-first section */}
          {PERMISSION_REGISTRY.music && isRegistryModuleActive('music', activatedCatalogKeys) && (() => {
            const pages = getModulePages('music');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('music')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.music.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.music.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['music'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['music'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('music')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('music', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'music')}
                                label=""
                                size="md"
                                id={`music-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'music')}
                                label=""
                                size="md"
                                id={`music-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Mail (Email Marketing) page-first section */}
          {PERMISSION_REGISTRY.mail && isRegistryModuleActive('mail', activatedCatalogKeys) && (() => {
            const pages = getModulePages('mail');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('mail')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.mail.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.mail.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['mail'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['mail'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('mail')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('mail', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'mail')}
                                label=""
                                size="md"
                                id={`mail-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'mail')}
                                label=""
                                size="md"
                                id={`mail-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Inbox page-first section */}
          {PERMISSION_REGISTRY.inbox && isRegistryModuleActive('inbox', activatedCatalogKeys) && (() => {
            const pages = getModulePages('inbox');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('inbox')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.inbox.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.inbox.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['inbox'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['inbox'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('inbox')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('inbox', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'inbox')}
                                label=""
                                size="md"
                                id={`inbox-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'inbox')}
                                label=""
                                size="md"
                                id={`inbox-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Reports page-first section */}
          {PERMISSION_REGISTRY.reports && isRegistryModuleActive('reports', activatedCatalogKeys) && (() => {
            const pages = getModulePages('reports');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('reports')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.reports.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.reports.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['reports'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['reports'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('reports')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('reports', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'reports')}
                                label=""
                                size="md"
                                id={`reports-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'reports')}
                                label=""
                                size="md"
                                id={`reports-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Settings page-first section */}
          {PERMISSION_REGISTRY.settings && isRegistryModuleActive('settings', activatedCatalogKeys) && (() => {
            const pages = getModulePages('settings');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('settings')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.settings.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.settings.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['settings'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['settings'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('settings')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('settings', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'settings')}
                                label=""
                                size="md"
                                id={`settings-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'settings')}
                                label=""
                                size="md"
                                id={`settings-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Payments page-first section */}
          {PERMISSION_REGISTRY.payments && isRegistryModuleActive('payments', activatedCatalogKeys) && (() => {
            const pages = getModulePages('payments');
            if (pages.length === 0) return null; // No pages, skip
            return (
              <div style={styles.moduleCard}>
                <div style={styles.moduleHeader} onClick={() => toggleModule('payments')}>
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{PERMISSION_REGISTRY.payments.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{PERMISSION_REGISTRY.payments.name}</h4>
                      <p style={styles.moduleDescription}>Page access and granular actions</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.expandIcon}>{expandedModules['payments'] ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedModules['payments'] && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule('payments')}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title="Set all granular permissions to View & Edit"
                      >
                        View & Edit all granular
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', padding: '8px 0', fontWeight: 600, color: '#374151' }}>
                      <div>Page</div>
                      <div style={{ textAlign: 'center' }}>Not Visible</div>
                      <div style={{ textAlign: 'center' }}>View / Edit</div>
                    </div>
                    {pages.map((page) => {
                      const state = getPageState(page);
                      const expanded = !!expandedPosPages[page.id];
                      const granular = getGranularForPage('payments', page.id);
                      const hasGranular = granular.length > 0;
                      return (
                        <div key={page.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px', gap: '8px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {hasGranular && (
                                <button
                                  type="button"
                                  onClick={() => togglePosPageExpand(page.id)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                  title="Expand granular options"
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span>{page.name}</span>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'none'}
                                onChange={(checked) => checked && setPageState(page, 'none', 'payments')}
                                label=""
                                size="md"
                                id={`payments-${page.id}-none`}
                              />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <TavariCheckbox
                                checked={state === 'edit'}
                                onChange={(checked) => checked && setPageState(page, 'edit', 'payments')}
                                label=""
                                size="md"
                                id={`payments-${page.id}-edit`}
                              />
                            </div>
                          </div>
                          {hasGranular && expanded && state !== 'none' && (
                            <div style={{ marginTop: '8px', marginLeft: '24px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Granular options</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {granular.map((perm) => (
                                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{perm.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'none'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'none')}
                                        label="Not Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-none`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'view'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'view')}
                                        label="Visible"
                                        size="sm"
                                        id={`perm-${perm.key}-view`}
                                      />
                                      <TavariCheckbox
                                        checked={getGranularState(perm.key) === 'edit'}
                                        onChange={(checked) => checked && setGranularState(perm.key, 'edit')}
                                        label="View & Edit"
                                        size="sm"
                                        id={`perm-${perm.key}-edit`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Existing modules (non-POS, non-Inventory, non-HR, non-Customers, non-Dining, non-Music, non-Mail, non-Inbox, non-Reports, non-Settings, non-Payments) */}
          {Object.entries(PERMISSION_REGISTRY).map(([moduleName, module]) => {
            if (moduleName === 'pos' || moduleName === 'inventory' || moduleName === 'hr' || moduleName === 'customers' || moduleName === 'dining' || moduleName === 'music' || moduleName === 'mail' || moduleName === 'inbox' || moduleName === 'reports' || moduleName === 'settings' || moduleName === 'payments') return null; // handled above
            if (!isRegistryModuleActive(moduleName, activatedCatalogKeys)) return null;
            const { granted, total } = countPermissions(moduleName);
            const isExpanded = expandedModules[moduleName];

            return (
              <div key={moduleName} style={styles.moduleCard}>
                <div
                  style={styles.moduleHeader}
                  onClick={() => toggleModule(moduleName)}
                >
                  <div style={styles.moduleInfo}>
                    <span style={styles.moduleIcon}>{module.icon}</span>
                    <div>
                      <h4 style={styles.moduleName}>{module.name}</h4>
                      <p style={styles.moduleDescription}>{module.description}</p>
                    </div>
                  </div>
                  <div style={styles.moduleStats}>
                    <span style={styles.permissionCount}>
                      {granted} / {total}
                    </span>
                    <span style={styles.expandIcon}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={styles.categoriesContainer}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAllGranularViewEditForModule(moduleName)}
                        style={{ padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#10b981', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                        title={`Enable all page & granular permissions for ${module.name}`}
                      >
                        View & Edit all
                      </button>
                    </div>
                    {module.categories.map((category) => {
                      const categoryGranted = category.permissions.filter(
                        p => permissions[p.key]
                      ).length;
                      const allGranted = categoryGranted === category.permissions.length;

                      return (
                        <div key={category.name} style={styles.category}>
                          <div style={styles.categoryHeader}>
                            <h5 style={styles.categoryName}>{category.name}</h5>
                            <button
                              onClick={() => toggleAllInCategory(
                                moduleName,
                                category.name,
                                !allGranted
                              )}
                              style={styles.toggleAllButton}
                            >
                              {allGranted ? 'Deselect All' : 'Select All'}
                            </button>
                          </div>

                          <div style={styles.permissionsList}>
                            {category.permissions.map((permission) => (
                              <div
                                key={permission.key}
                                style={styles.permissionItem}
                              >
                                <TavariCheckbox
                                  checked={permissions[permission.key] || false}
                                  onChange={() => togglePermission(permission.key)}
                                  size="md"
                                  id={`perm-${permission.key}`}
                                />
                                <div style={styles.permissionInfo}>
                                  <div style={styles.permissionName}>
                                    {permission.name}
                                    {permission.isDangerous && (
                                      <AlertTriangle
                                        size={14}
                                        color="#dc2626"
                                        style={{ marginLeft: '6px' }}
                                        title="Potentially dangerous permission"
                                      />
                                    )}
                                  </div>
                                  <div style={styles.permissionDescription}>
                                    {permission.description}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={styles.footer}>
          <button
            onClick={onClose}
            style={styles.cancelButton}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={styles.saveButton}
          >
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '900px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '24px',
    borderBottom: '1px solid #e5e7eb'
  },
  title: {
    margin: '0 0 4px 0',
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  subtitle: {
    margin: 0,
    fontSize: '14px',
    color: '#6b7280'
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '4px'
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px'
  },
  moduleCard: {
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    marginBottom: '16px',
    overflow: 'hidden'
  },
  moduleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  moduleInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  moduleIcon: {
    fontSize: '24px'
  },
  moduleName: {
    margin: '0 0 4px 0',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  moduleDescription: {
    margin: 0,
    fontSize: '13px',
    color: '#6b7280'
  },
  moduleStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  permissionCount: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#008080'
  },
  expandIcon: {
    fontSize: '13px',
    color: '#6b7280'
  },
  categoriesContainer: {
    padding: '0 16px 16px'
  },
  category: {
    backgroundColor: 'white',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '12px'
  },
  categoryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  categoryName: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151'
  },
  toggleAllButton: {
    padding: '4px 12px',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer'
  },
  permissionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  permissionItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '10px',
    borderRadius: '4px',
    transition: 'background-color 0.2s'
  },
  permissionInfo: {
    flex: 1
  },
  permissionName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#1f2937',
    marginBottom: '2px',
    display: 'flex',
    alignItems: 'center'
  },
  permissionDescription: {
    fontSize: '13px',
    color: '#6b7280',
    lineHeight: '1.4'
  },
  footer: {
    display: 'flex',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '1px solid #e5e7eb'
  },
  cancelButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#6b7280'
  }
};

export default PermissionMatrix;