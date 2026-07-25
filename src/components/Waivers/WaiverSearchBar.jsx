// Step 95: Create WaiverSearchBar.jsx
// Search bar component for waivers
import React, { useState, useEffect } from 'react';
import { FiSearch, FiX, FiFilter } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const WaiverSearchBar = ({ onSearch, onFilterChange, defaultSearchType = 'phone' }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState(defaultSearchType);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    dateRange: { start: '', end: '' },
    template: ''
  });

  useEffect(() => {
    // Debounce search
    const timeoutId = setTimeout(() => {
      if (searchTerm || Object.values(filters).some(v => v !== '' && (typeof v !== 'object' || Object.values(v).some(x => x !== '')))) {
        onSearch?.(searchTerm, searchType, filters);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, searchType, filters]);

  const handleClear = () => {
    setSearchTerm('');
    setFilters({
      status: '',
      dateRange: { start: '', end: '' },
      template: ''
    });
    onSearch?.('', searchType, {});
  };

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange?.(newFilters);
  };

  return (
    <div style={styles.container}>
      <div style={styles.searchContainer}>
        <div style={styles.searchTypeSelector}>
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            style={styles.select}
          >
            <option value="phone">Phone</option>
            <option value="name">Name</option>
            <option value="email">Email</option>
            <option value="qr">QR Code</option>
            <option value="waiverId">Waiver ID</option>
          </select>
        </div>
        
        <div style={styles.inputContainer}>
          <FiSearch style={styles.searchIcon} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={getPlaceholder(searchType)}
            style={styles.input}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={handleClear}
              style={styles.clearButton}
            >
              <FiX />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          style={{
            ...styles.filterButton,
            ...(showFilters ? styles.filterButtonActive : {})
          }}
        >
          <FiFilter />
        </button>
      </div>

      {showFilters && (
        <div style={styles.filtersContainer}>
          <div style={styles.filterRow}>
            <label style={styles.filterLabel}>Status:</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              style={styles.filterSelect}
            >
              <option value="">All</option>
              <option value="valid">Valid</option>
              <option value="expired">Expired</option>
              <option value="expiring_soon">Expiring Soon</option>
              <option value="invalid">Invalid</option>
            </select>
          </div>

          <div style={styles.filterRow}>
            <label style={styles.filterLabel}>Date Range:</label>
            <input
              type="date"
              value={filters.dateRange.start}
              onChange={(e) => handleFilterChange('dateRange', { ...filters.dateRange, start: e.target.value })}
              style={styles.filterInput}
              placeholder="Start"
            />
            <span style={styles.filterSeparator}>to</span>
            <input
              type="date"
              value={filters.dateRange.end}
              onChange={(e) => handleFilterChange('dateRange', { ...filters.dateRange, end: e.target.value })}
              style={styles.filterInput}
              placeholder="End"
            />
          </div>
        </div>
      )}
    </div>
  );
};

const getPlaceholder = (searchType) => {
  switch (searchType) {
    case 'phone':
      return 'Search by phone number...';
    case 'name':
      return 'Search by first or last name...';
    case 'email':
      return 'Search by email...';
    case 'qr':
      return 'Scan or enter QR code...';
    case 'waiverId':
      return 'Enter waiver ID...';
    default:
      return 'Search...';
  }
};

const styles = {
  container: {
    marginBottom: TavariStyles.spacing.lg
  },
  searchContainer: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    alignItems: 'center'
  },
  searchTypeSelector: {
    flexShrink: 0
  },
  select: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.sm,
    backgroundColor: TavariStyles.colors.white
  },
  inputContainer: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  },
  searchIcon: {
    position: 'absolute',
    left: TavariStyles.spacing.md,
    color: TavariStyles.colors.gray400,
    pointerEvents: 'none'
  },
  input: {
    width: '100%',
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md} ${TavariStyles.spacing.sm} 40px`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.base,
    paddingRight: '40px'
  },
  clearButton: {
    position: 'absolute',
    right: TavariStyles.spacing.sm,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles.colors.gray400,
    display: 'flex',
    alignItems: 'center',
    padding: TavariStyles.spacing.xs
  },
  filterButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    color: TavariStyles.colors.gray600
  },
  filterButtonActive: {
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    borderColor: TavariStyles.colors.primary
  },
  filtersContainer: {
    marginTop: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  filterLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    minWidth: '100px'
  },
  filterSelect: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  filterInput: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  filterSeparator: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600
  }
};

export default WaiverSearchBar;




