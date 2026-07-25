import React, { useCallback, useEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const SCROLL_STEP = 220;
const SCROLL_HIDE_CLASS = 'tavari-tab-system-scroll';

const normalizePath = (value = '') => value.replace(/\/+$/, '') || value;

const renderIcon = (icon) => {
  if (!icon) return null;

  if (React.isValidElement(icon)) {
    return icon;
  }

  if (typeof icon === 'function') {
    const Icon = icon;
    return <Icon size={18} />;
  }

  if (typeof icon === 'object' && icon.$$typeof && icon.render) {
    return React.createElement(icon, { size: 18 });
  }

  return <span>{icon}</span>;
};

const TavariTabSystemComponent = ({
  tabs = [],
  mode = 'state',
  activeTab = null,
  onTabChange,
  ariaLabel = 'Tabs',
  variant = 'module',
  fullWidth,
  showScrollButtons = true,
  containerStyle = {},
  tabListStyle = {},
  tabButtonStyle = {},
  activeTabStyle = {},
  disabledTabStyle = {}
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = normalizePath(location.pathname);
  const tabListRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const visibleTabs = tabs.filter((tab) => tab && tab.visible !== false);

  const updateScrollState = useCallback(() => {
    const el = tabListRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < maxScrollLeft - 2);
  }, []);

  useEffect(() => {
    updateScrollState();

    const el = tabListRef.current;
    if (!el) return undefined;

    el.addEventListener('scroll', updateScrollState, { passive: true });
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollState)
      : null;
    resizeObserver?.observe(el);

    return () => {
      el.removeEventListener('scroll', updateScrollState);
      resizeObserver?.disconnect();
    };
  }, [visibleTabs.length, updateScrollState]);

  useEffect(() => {
    if (!showScrollButtons || mode !== 'state' || !activeTab || !tabListRef.current) return;

    const activeButton = tabListRef.current.querySelector('[role="tab"][aria-selected="true"]');
    activeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeTab, mode, showScrollButtons, visibleTabs.length]);

  if (visibleTabs.length <= 1) {
    return null;
  }

  const isRouteTabActive = (tab) => {
    const patterns = [];

    if (tab.matchPath) {
      patterns.push(tab.matchPath);
    }

    if (Array.isArray(tab.matchPaths)) {
      patterns.push(...tab.matchPaths);
    }

    if (tab.to) {
      patterns.push({ path: tab.to, end: tab.end ?? true });
    }

    return patterns.some((pattern) => {
      if (!pattern) return false;
      if (typeof pattern === 'string') {
        return !!matchPath({ path: pattern, end: tab.end ?? true }, currentPath);
      }
      return !!matchPath(pattern, currentPath);
    });
  };

  const isTabActive = (tab) => {
    if (typeof tab.isActive === 'function') {
      return !!tab.isActive({ activeTab, pathname: currentPath });
    }

    if (typeof tab.isActive === 'boolean') {
      return tab.isActive;
    }

    if (mode === 'route') {
      return isRouteTabActive(tab);
    }

    return activeTab === tab.id;
  };

  const handleTabClick = (tab) => {
    if (tab.disabled) return;

    if (mode === 'state' && onTabChange) {
      onTabChange(tab.id, tab);
    }

    if (tab.onClick) {
      tab.onClick(tab);
      return;
    }

    if (mode === 'route' && tab.to) {
      navigate(tab.to);
    }
  };

  const scrollTabs = (direction) => {
    tabListRef.current?.scrollBy({
      left: direction * SCROLL_STEP,
      behavior: 'smooth',
    });
  };

  const useFullWidth = typeof fullWidth === 'boolean'
    ? fullWidth
    : variant === 'default';
  const styles = getStyles(variant, useFullWidth);
  const showArrows = showScrollButtons && (canScrollLeft || canScrollRight);

  return (
    <div style={{ ...styles.container, ...containerStyle }}>
      {showArrows && (
        <button
          type="button"
          aria-label="Scroll tabs left"
          disabled={!canScrollLeft}
          onClick={() => scrollTabs(-1)}
          style={{
            ...styles.scrollButton,
            ...(canScrollLeft ? {} : styles.scrollButtonDisabled),
          }}
        >
          <FiChevronLeft size={18} />
        </button>
      )}

      <div
        ref={tabListRef}
        className={SCROLL_HIDE_CLASS}
        style={{ ...styles.tabList, ...tabListStyle }}
        role="tablist"
        aria-label={ariaLabel}
      >
        {visibleTabs.map((tab) => {
          const active = isTabActive(tab);

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={tab.disabled === true}
              onClick={() => handleTabClick(tab)}
              title={tab.title || tab.label}
              style={{
                ...styles.tabButton,
                ...(active ? styles.activeTabButton : {}),
                ...(tab.disabled ? styles.disabledTabButton : {}),
                ...tabButtonStyle,
                ...(active ? activeTabStyle : {}),
                ...(tab.disabled ? disabledTabStyle : {}),
              }}
            >
              {tab.icon && <span style={styles.icon}>{renderIcon(tab.icon)}</span>}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {showArrows && (
        <button
          type="button"
          aria-label="Scroll tabs right"
          disabled={!canScrollRight}
          onClick={() => scrollTabs(1)}
          style={{
            ...styles.scrollButton,
            ...(canScrollRight ? {} : styles.scrollButtonDisabled),
          }}
        >
          <FiChevronRight size={18} />
        </button>
      )}
    </div>
  );
};

const getStyles = (variant, fullWidth) => {
  const moduleVariant = {
    container: {
      display: 'flex',
      alignItems: 'stretch',
      gap: '4px',
      marginBottom: '12px',
    },
    tabList: {
      display: 'flex',
      gap: '2px',
      flex: 1,
      minWidth: 0,
      backgroundColor: '#e5e7eb',
      borderRadius: '8px',
      padding: '4px',
      overflowX: 'auto',
      flexWrap: 'nowrap',
      WebkitOverflowScrolling: 'touch',
    },
    tabButton: {
      flex: '1 0 auto',
      minWidth: 'fit-content',
      padding: '12px 20px',
      backgroundColor: 'transparent',
      color: '#6b7280',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: 'bold',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      whiteSpace: 'nowrap',
    },
    activeTabButton: {
      backgroundColor: '#ffffff',
      color: '#008080',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    },
    disabledTabButton: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    icon: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollButton: {
      flexShrink: 0,
      alignSelf: 'stretch',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      border: 'none',
      borderRadius: '6px',
      backgroundColor: '#e5e7eb',
      color: '#008080',
      cursor: 'pointer',
      transition: 'opacity 0.2s ease',
    },
    scrollButtonDisabled: {
      opacity: 0.35,
      cursor: 'default',
    },
  };

  if (variant === 'module') {
    return moduleVariant;
  }

  const base = {
    container: {
      marginBottom: TavariStyles.spacing.xl,
      display: 'flex',
      alignItems: 'stretch',
      gap: '4px',
    },
    tabList: {
      display: 'flex',
      gap: '2px',
      flex: 1,
      minWidth: 0,
      backgroundColor: TavariStyles.colors.gray200 || '#e5e7eb',
      borderRadius: TavariStyles.borderRadius.lg,
      padding: '4px',
      overflowX: 'auto',
      flexWrap: 'nowrap',
      WebkitOverflowScrolling: 'touch',
    },
    tabButton: {
      flex: fullWidth ? '1 0 auto' : '0 0 auto',
      minWidth: 'fit-content',
      padding: '12px 20px',
      backgroundColor: 'transparent',
      color: TavariStyles.colors.gray600,
      border: 'none',
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm,
      whiteSpace: 'nowrap',
    },
    activeTabButton: {
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
    },
    disabledTabButton: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    icon: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollButton: moduleVariant.scrollButton,
    scrollButtonDisabled: moduleVariant.scrollButtonDisabled,
  };

  if (variant === 'compact') {
    return {
      ...base,
      container: {
        ...base.container,
        marginBottom: TavariStyles.spacing.lg,
      },
      tabButton: {
        ...base.tabButton,
        padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
      },
    };
  }

  return base;
};

if (typeof document !== 'undefined' && !document.getElementById('tavari-tab-system-scroll-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'tavari-tab-system-scroll-styles';
  styleSheet.textContent = `
    .${SCROLL_HIDE_CLASS} {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .${SCROLL_HIDE_CLASS}::-webkit-scrollbar {
      display: none;
    }
  `;
  document.head.appendChild(styleSheet);
}

export default TavariTabSystemComponent;
