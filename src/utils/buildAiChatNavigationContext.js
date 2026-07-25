import catalog from '../constants/aiNavigationCatalog.json';

const PRIVILEGED_ROLES = new Set(['owner', 'admin', 'manager']);

/**
 * Mirror SidebarNav canViewPage — owners/managers/admins see all permission-gated pages.
 */
export function canViewPageForRole(permissionKey, userRole, hasPermission) {
  if (!permissionKey) return false;
  if (PRIVILEGED_ROLES.has(userRole)) return true;
  return hasPermission(permissionKey);
}

export function isCatalogEntryVisible(entry, ctx) {
  const {
    enabledModules = {},
    userRole,
    hasPermission,
    hasAnyPermission,
    permissionsLoading,
    modulesLoading,
  } = ctx;

  if (permissionsLoading || modulesLoading) return false;

  if (entry.requiresModule && !enabledModules[entry.requiresModule]) return false;

  if (entry.hideForRoles?.includes(userRole)) return false;

  if (entry.permissions?.length) {
    const visible = entry.permissions.some((perm) =>
      canViewPageForRole(perm, userRole, hasPermission)
    );
    if (!visible) return false;
  }

  if (entry.module && entry.module !== 'core' && entry.module !== 'reports') {
    const moduleKey = entry.requiresModule || entry.module;
    if (moduleKey && moduleKey !== 'core' && moduleKey !== 'reports' && !enabledModules[moduleKey]) {
      return false;
    }
  }

  if (userRole === 'employee' && entry.module === 'accounting') return false;

  return true;
}

export function getVisibleCatalogEntries(ctx) {
  return catalog.filter((entry) => isCatalogEntryVisible(entry, ctx));
}

/** Compact tree for the AI system prompt — grouped like sidebar sections. */
export function buildVisibleNavTree(visibleEntries) {
  const groups = new Map();

  visibleEntries.forEach((entry) => {
    const groupKey = entry.navGroup || entry.module || 'Other';
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { label: groupKey, children: [] });
    }
    groups.get(groupKey).children.push({
      id: entry.id,
      label: entry.label,
      path: entry.path,
      menuPath: entry.menuPath,
    });
  });

  return Array.from(groups.values()).filter((g) => g.children.length > 0);
}

export function buildNavigationContext({
  pathname = '',
  enabledModules = {},
  userRole = null,
  hasPermission = () => false,
  hasAnyPermission = () => false,
  permissionsLoading = false,
  modulesLoading = false,
}) {
  const ctx = {
    enabledModules,
    userRole,
    hasPermission,
    hasAnyPermission,
    permissionsLoading,
    modulesLoading,
  };

  const visibleEntries = getVisibleCatalogEntries(ctx);
  const visibleNav = buildVisibleNavTree(visibleEntries);
  const enabledModuleKeys = Object.entries(enabledModules)
    .filter(([, on]) => !!on)
    .map(([key]) => key);

  const path = pathname.replace(/^\/dashboard\/?/, '').replace(/^\//, '') || '';
  const parts = path.split('/').filter(Boolean);
  const screenContext = {
    pathname,
    module: parts[0] || '',
    screen: parts.slice(1).join('/') || parts[0] || '',
  };

  return {
    ...screenContext,
    enabledModules: enabledModuleKeys,
    visibleNav,
    visibleFeatures: visibleEntries.map((e) => ({
      id: e.id,
      label: e.label,
      path: e.path,
      menuPath: e.menuPath,
      description: e.description,
    })),
  };
}

export { catalog as AI_NAVIGATION_CATALOG };
