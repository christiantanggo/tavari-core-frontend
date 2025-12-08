// components/TavariAdminComp/TOSASidebarNav.jsx
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  FiHome, FiUsers, FiShield, FiHeadphones, FiTrendingUp, 
  FiSettings, FiBarChart, FiEdit, FiChevronDown, FiChevronRight,
  FiMonitor, FiDatabase, FiAlertTriangle, FiPackage
} from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const TOSASidebarNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [businessExpanded, setBusinessExpanded] = useState(false);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [systemExpanded, setSystemExpanded] = useState(false);

  const isActive = (path) => location.pathname === path;
  const isParentActive = (paths) => paths.some(path => location.pathname.includes(path));

  const menuItems = [
    {
      title: 'Dashboard',
      icon: <FiHome />,
      path: '/tosa/dashboard',
      active: isActive('/tosa/dashboard')
    },
    {
      title: 'Business Management',
      icon: <FiUsers />,
      expandable: true,
      expanded: businessExpanded,
      setExpanded: setBusinessExpanded,
      active: isParentActive(['business']),
      children: [
        { title: 'Business Editor', path: '/tosa/business-editor' },
        { title: 'Business Insights', path: '/tosa/business-insights' }
      ]
    },
    {
      title: 'Security & Monitoring',
      icon: <FiShield />,
      expandable: true,
      expanded: securityExpanded,
      setExpanded: setSecurityExpanded,
      active: isParentActive(['security']),
      children: [
        { title: 'Security Monitoring', path: '/tosa/security-monitoring' },
        { title: 'Threat Analysis', path: '/tosa/security-monitoring?tab=threats' }
      ]
    },
    {
      title: 'Customer Support',
      icon: <FiHeadphones />,
      path: '/tosa/customer-support',
      active: isActive('/tosa/customer-support')
    },
    {
      title: 'System Management',
      icon: <FiMonitor />,
      expandable: true,
      expanded: systemExpanded,
      setExpanded: setSystemExpanded,
      active: isParentActive(['system']),
      children: [
        { title: 'System Health', path: '/tosa/system-health' },
        { title: 'Database Status', path: '/tosa/system-health?tab=database' },
        { title: 'Performance Metrics', path: '/tosa/system-health?tab=performance' }
      ]
    },
    {
      title: 'Module Management',
      icon: <FiPackage />,
      path: '/tosa/module-management',
      active: isActive('/tosa/module-management')
    }
  ];

  const styles = {
    sidebar: {
      width: '250px',
      backgroundColor: TavariStyles.colors.gray800,
      minHeight: '100vh',
      paddingTop: '80px', // Account for header
      borderRight: `1px solid ${TavariStyles.colors.gray700}`,
      position: 'fixed',
      left: 0,
      top: 0,
      zIndex: 10,
      overflowY: 'auto'
    },
    
    menuItem: {
      display: 'flex',
      alignItems: 'center',
      padding: TavariStyles.spacing.md,
      margin: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.md,
      cursor: 'pointer',
      transition: TavariStyles.transitions.normal,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray300
    },
    
    menuItemActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    
    menuItemHover: {
      backgroundColor: TavariStyles.colors.gray700,
      color: TavariStyles.colors.white
    },
    
    menuIcon: {
      fontSize: '18px',
      marginRight: TavariStyles.spacing.md,
      width: '20px',
      textAlign: 'center'
    },
    
    menuText: {
      flex: 1
    },
    
    expandIcon: {
      fontSize: '14px',
      transition: TavariStyles.transitions.normal
    },
    
    submenu: {
      marginLeft: TavariStyles.spacing.lg,
      marginTop: TavariStyles.spacing.xs
    },
    
    submenuItem: {
      display: 'flex',
      alignItems: 'center',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      margin: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      cursor: 'pointer',
      transition: TavariStyles.transitions.normal,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray400,
      borderLeft: `2px solid ${TavariStyles.colors.gray600}`,
      marginLeft: TavariStyles.spacing.xl
    },
    
    submenuItemActive: {
      backgroundColor: TavariStyles.colors.gray700,
      color: TavariStyles.colors.white,
      borderLeftColor: TavariStyles.colors.primary
    },
    
    brandSection: {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '250px',
      height: '80px',
      backgroundColor: TavariStyles.colors.gray900,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderBottom: `1px solid ${TavariStyles.colors.gray700}`,
      zIndex: 11
    },
    
    brandText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.white
    },
    
    brandSubtext: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.primary,
      marginTop: '2px'
    }
  };

  const handleMenuClick = (item) => {
    if (item.expandable) {
      item.setExpanded(!item.expanded);
    } else if (item.path) {
      navigate(item.path);
    }
  };

  const handleSubmenuClick = (path) => {
    navigate(path);
  };

  return (
    <>
      {/* Brand Section */}
      <div style={styles.brandSection}>
        <div>
          <div style={styles.brandText}>TOSA</div>
          <div style={styles.brandSubtext}>Tavari OS Admin</div>
        </div>
      </div>
      
      {/* Sidebar Navigation */}
      <div style={styles.sidebar}>
        {menuItems.map((item, index) => (
          <div key={index}>
            {/* Main Menu Item */}
            <div
              style={{
                ...styles.menuItem,
                ...(item.active ? styles.menuItemActive : {})
              }}
              onClick={() => handleMenuClick(item)}
              onMouseEnter={(e) => {
                if (!item.active) {
                  Object.assign(e.currentTarget.style, styles.menuItemHover);
                }
              }}
              onMouseLeave={(e) => {
                if (!item.active) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = TavariStyles.colors.gray300;
                }
              }}
            >
              <div style={styles.menuIcon}>{item.icon}</div>
              <div style={styles.menuText}>{item.title}</div>
              {item.expandable && (
                <div style={styles.expandIcon}>
                  {item.expanded ? <FiChevronDown /> : <FiChevronRight />}
                </div>
              )}
            </div>

            {/* Submenu Items */}
            {item.expandable && item.expanded && item.children && (
              <div style={styles.submenu}>
                {item.children.map((child, childIndex) => (
                  <div
                    key={childIndex}
                    style={{
                      ...styles.submenuItem,
                      ...(isActive(child.path) ? styles.submenuItemActive : {})
                    }}
                    onClick={() => handleSubmenuClick(child.path)}
                    onMouseEnter={(e) => {
                      if (!isActive(child.path)) {
                        e.currentTarget.style.backgroundColor = TavariStyles.colors.gray700;
                        e.currentTarget.style.color = TavariStyles.colors.white;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive(child.path)) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = TavariStyles.colors.gray400;
                      }
                    }}
                  >
                    • {child.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default TOSASidebarNav;