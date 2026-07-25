import catalog from '../constants/aiNavigationCatalog.json';

/**
 * Parse a dashboard path from AI chat (may omit query string).
 * @returns {{ pathname: string, search: string, hash: string }}
 */
export function parseDashboardPath(rawPath) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed.startsWith('/dashboard')) {
    return { pathname: '/dashboard/home', search: '', hash: '' };
  }

  const hashIdx = trimmed.indexOf('#');
  const withoutHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  const hash = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';
  const qIdx = withoutHash.indexOf('?');
  const pathname = qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash;
  const search = qIdx >= 0 ? withoutHash.slice(qIdx + 1) : '';

  return { pathname, search, hash };
}

function findCatalogEntry(rawPath, linkLabel, messageContent = '') {
  const normalized = String(rawPath || '').trim();
  const byPath = catalog.find((e) => e.path === normalized);
  if (byPath) return byPath;

  const label = String(linkLabel || '').trim().toLowerCase();
  const haystack = `${normalized} ${label} ${messageContent}`.toLowerCase();

  if (label && label !== 'take me there' && label !== 'go there') {
    const byLabel = catalog.find((e) => {
      const entryLabel = e.label.toLowerCase();
      return entryLabel === label || label.includes(entryLabel) || entryLabel.includes(label);
    });
    if (byLabel) return byLabel;

    const byKeyword = catalog.find((e) =>
      (e.keywords || []).some((kw) => {
        const k = kw.toLowerCase();
        return label.includes(k) || k.includes(label);
      })
    );
    if (byKeyword) return byKeyword;
  }

  const { pathname, search } = parseDashboardPath(normalized);
  if (!search && haystack.trim()) {
    const pathnameMatches = catalog.filter((e) => parseDashboardPath(e.path).pathname === pathname);
    const keywordMatch = pathnameMatches.find((e) =>
      (e.keywords || []).some((kw) => haystack.includes(kw.toLowerCase()))
    );
    if (keywordMatch) return keywordMatch;

    if (pathnameMatches.length === 1) return pathnameMatches[0];
  }

  return null;
}

/**
 * Build a React Router navigate target with module-specific state fallbacks.
 */
export function resolveAiChatNavigationTarget(rawPath, linkLabel = '', messageContent = '') {
  const entry = findCatalogEntry(rawPath, linkLabel, messageContent);
  const sourcePath = entry?.path || rawPath;
  let { pathname, search, hash } = parseDashboardPath(sourcePath);
  const params = new URLSearchParams(search);
  const state = {};
  const contextText = `${rawPath} ${linkLabel} ${messageContent}`.toLowerCase();

  if (pathname === '/dashboard/bookings' || pathname.endsWith('/bookings')) {
    if (!params.get('tab') && /registration-forms|registration forms|camp registration|camper registration/.test(contextText)) {
      params.set('tab', 'registration-forms');
      search = params.toString();
    }

    const tab = params.get('tab');
    if (tab === 'registration-forms') {
      state.bookingsTab = 'registration-forms';
    }
    const settingsTab = params.get('settingsTab');
    if (settingsTab) {
      state.bookingsSettingsTab = settingsTab;
    }
    if (params.get('tab') === 'settings' && settingsTab) {
      state.bookingsTab = 'settings';
    }
  }

  const searchString = search ? `?${search}` : '';

  return {
    pathname,
    search: searchString,
    hash,
    href: `${pathname}${searchString}${hash || ''}`,
    state: Object.keys(state).length ? state : undefined,
  };
}

/** @param {import('react-router-dom').NavigateFunction} navigate */
export function navigateFromAiChat(navigate, rawPath, linkLabel = '', messageContent = '') {
  const target = resolveAiChatNavigationTarget(rawPath, linkLabel, messageContent);
  navigate(target.href, { state: target.state });
}

export { catalog as AI_NAVIGATION_CATALOG };
