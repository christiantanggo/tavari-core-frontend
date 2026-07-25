// src/components/UI/Breadcrumbs.jsx
// Standardized breadcrumb navigation component
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FiHome, FiChevronRight } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Breadcrumbs - Standardized breadcrumb navigation
 * 
 * @param {Array} items - Array of { label, path } objects
 * @param {boolean} showHome - Show home icon/link
 */
const Breadcrumbs = ({ items = [], showHome = true }) => {
  const navigate = useNavigate();

  const styles = {
    container: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles?.spacing?.xs || '4px',
      marginBottom: TavariStyles?.spacing?.lg || '16px',
      fontSize: TavariStyles?.typography?.fontSize?.sm || '14px',
      color: TavariStyles?.colors?.gray600 || '#4b5563'
    },
    link: {
      color: TavariStyles?.colors?.primary || '#008080',
      textDecoration: 'none',
      cursor: 'pointer',
      transition: 'color 0.2s ease',
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    },
    current: {
      color: TavariStyles?.colors?.gray900 || '#111827',
      fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500'
    },
    separator: {
      color: TavariStyles?.colors?.gray400 || '#9ca3af',
      margin: '0 4px'
    }
  };

  const handleClick = (path) => {
    if (path) {
      navigate(path);
    }
  };

  return (
    <nav style={styles.container} aria-label="Breadcrumb">
      {showHome && (
        <>
          <a
            href="/dashboard"
            onClick={(e) => {
              e.preventDefault();
              navigate('/dashboard');
            }}
            style={styles.link}
            aria-label="Home"
          >
            <FiHome size={16} />
          </a>
          {items.length > 0 && <FiChevronRight size={16} style={styles.separator} />}
        </>
      )}
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={index}>
            {item.path && !isLast ? (
              <a
                href={item.path}
                onClick={(e) => {
                  e.preventDefault();
                  handleClick(item.path);
                }}
                style={styles.link}
              >
                {item.label}
              </a>
            ) : (
              <span style={isLast ? styles.current : {}}>
                {item.label}
              </span>
            )}
            {!isLast && <FiChevronRight size={16} style={styles.separator} />}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default Breadcrumbs;



