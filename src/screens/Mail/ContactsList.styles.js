// screens/Mail/ContactsList.styles.js - Enhanced styles for ContactsList with new features

export const styles = {
  container: {
    padding: '50px 20px 20px 20px',
    maxWidth: '1800px', // Increased for more columns
    margin: '0 auto',
    backgroundColor: '#f8f8f8',
    minHeight: '100vh',
    position: 'relative',
  },
  loading: {
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: '18px',
    color: '#666',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  loadingIcon: {
    fontSize: '48px',
    color: 'teal',
  },
  loadingOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(248, 248, 248, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    pointerEvents: 'all',
  },
  loadingOverlayCard: {
    backgroundColor: 'white',
    padding: '30px 40px',
    borderRadius: '16px',
    boxShadow: '0 12px 24px rgba(0, 0, 0, 0.12)',
    border: '1px solid rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    pointerEvents: 'auto',
  },
  loadingOverlayIcon: {
    fontSize: '48px',
    color: 'teal',
  },
  loadingOverlayText: {
    fontSize: '16px',
    color: '#333',
    fontWeight: '600',
  },
  loadNotice: {
    backgroundColor: 'white',
    border: '1px dashed #94a3b8',
    borderRadius: '8px',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    color: '#475569',
    marginBottom: '20px',
  },
  loadNoticeIcon: {
    fontSize: '20px',
    color: 'teal',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '20px',
    backgroundColor: 'white',
    padding: '30px',
    borderRadius: '12px',
    border: '1px solid #ddd',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: 0,
    lineHeight: '1.5',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  primaryButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  secondaryButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  buttonIcon: {
    fontSize: '16px',
  },
  
  // Enhanced Stats Grid
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '20px',
  },
  statCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '12px',
    border: '1px solid #ddd',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    transition: 'transform 0.2s ease',
  },
  statIcon: {
    fontSize: '28px',
    width: '50px',
    textAlign: 'center',
    color: 'teal',
  },
  statNumber: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    lineHeight: '1',
  },
  statLabel: {
    fontSize: '14px',
    color: '#666',
    marginTop: '4px',
    lineHeight: '1.2',
  },
  
  // Enhanced Tools Bar
  toolsBar: {
    display: 'flex',
    gap: '12px',
    marginBottom: '20px',
    flexWrap: 'wrap',
    backgroundColor: 'white',
    padding: '15px 20px',
    borderRadius: '8px',
    border: '1px solid #ddd',
  },
  toolButton: {
    backgroundColor: 'white',
    border: '2px solid #ddd',
    borderRadius: '8px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  
  // Enhanced Filter Bar
  filterBar: {
    display: 'flex',
    gap: '20px',
    marginBottom: '20px',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    flexWrap: 'wrap',
  },
  searchContainer: {
    position: 'relative',
    flex: 1,
    maxWidth: '400px',
    minWidth: '250px',
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#666',
    fontSize: '16px',
  },
  searchInput: {
    width: '100%',
    padding: '12px 12px 12px 40px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
  },
  filterContainer: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  filterSelect: {
    padding: '12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    backgroundColor: 'white',
    minWidth: '150px',
    cursor: 'pointer',
  },
  
  // Enhanced Bulk Actions
  bulkActions: {
    backgroundColor: 'white',
    padding: '15px 20px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    marginBottom: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '15px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  bulkText: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  bulkButtons: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  bulkButton: {
    backgroundColor: 'white',
    border: '2px solid teal',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'teal',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
  },
  deleteButton: {
    borderColor: '#f44336',
    color: '#f44336',
  },
  
  // Duplicates Panel
  duplicatesPanel: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    marginBottom: '20px',
    padding: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  duplicatesTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
  },
  duplicateGroup: {
    border: '1px solid #f0f0f0',
    borderRadius: '6px',
    marginBottom: '15px',
    padding: '15px',
    backgroundColor: '#fafafa',
  },
  duplicateHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  duplicateType: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
  },
  mergeButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  duplicateContacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  duplicateContact: {
    display: 'flex',
    gap: '15px',
    alignItems: 'center',
    padding: '8px',
    backgroundColor: '#f8f8f8',
    borderRadius: '4px',
  },
  contactName: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  contactEmail: {
    fontSize: '13px',
    color: '#666',
  },
  contactDate: {
    fontSize: '12px',
    color: '#999',
  },
  
  // Enhanced Table Styles
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    overflow: 'hidden',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  tableHeader: {
    backgroundColor: '#f8f8f8',
  },
  tableHeaderCell: {
    padding: '15px 12px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'left',
    borderBottom: '1px solid #ddd',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background-color 0.2s ease',
  },
  checkboxColumn: {
    width: '40px',
    padding: '15px 12px',
    textAlign: 'center',
  },
  tableRow: {
    borderBottom: '1px solid #f0f0f0',
    transition: 'background-color 0.2s ease',
  },
  
  // Enhanced Contact Column
  contactColumn: {
    padding: '15px 12px',
    minWidth: '200px',
  },
  contactInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  contactName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  householdIcon: {
    fontSize: '14px',
    color: '#ff9800',
  },
  contactDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  contactEmail: {
    fontSize: '14px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  contactPhone: {
    fontSize: '14px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  contactIcon: {
    fontSize: '12px',
  },
  
  // Status Column
  statusColumn: {
    padding: '15px 12px',
    minWidth: '120px',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  subscribedBadge: {
    backgroundColor: '#e8f5e8',
    color: '#2e7d32',
  },
  unsubscribedBadge: {
    backgroundColor: '#ffebee',
    color: '#c62828',
  },
  
  // Enhanced Engagement Column
  engagementColumn: {
    padding: '15px 12px',
    minWidth: '140px',
  },
  engagementInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  engagementHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '2px',
  },
  engagementScore: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  engagementDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  engagementDetail: {
    fontSize: '12px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  engagementIcon: {
    fontSize: '10px',
  },
  lastActivity: {
    fontSize: '11px',
    color: '#999',
    marginTop: '2px',
  },
  
  // Enhanced Preferences Column
  preferencesColumn: {
    padding: '15px 12px',
    minWidth: '120px',
  },
  preferences: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  frequency: {
    fontSize: '12px',
    color: '#333',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  language: {
    fontSize: '11px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  timezone: {
    fontSize: '10px',
    color: '#999',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  prefIcon: {
    fontSize: '10px',
  },
  
  // Enhanced CASL Column
  caslColumn: {
    padding: '15px 12px',
    minWidth: '130px',
  },
  caslInfo: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  caslDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  consentMethod: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#333',
  },
  consentSource: {
    fontSize: '11px',
    color: '#666',
  },
  consentDate: {
    fontSize: '10px',
    color: '#999',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  
  // Source Column
  sourceColumn: {
    padding: '15px 12px',
    minWidth: '120px',
  },
  sourceText: {
    fontSize: '14px',
    color: '#666',
    display: 'block',
    marginBottom: '4px',
    fontWeight: '500',
  },
  addedDate: {
    fontSize: '12px',
    color: '#999',
  },
  
  // Enhanced Segments Column
  segmentsColumn: {
    padding: '15px 12px',
    minWidth: '150px',
  },
  segments: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  segmentTag: {
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  moreSegments: {
    fontSize: '10px',
    color: '#999',
    fontStyle: 'italic',
  },
  
  // Actions Column
  actionsColumn: {
    padding: '15px 12px',
    minWidth: '120px',
  },
  actionButton: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '14px',
    cursor: 'pointer',
    marginRight: '8px',
    color: '#666',
    transition: 'all 0.2s ease',
  },
  deleteAction: {
    color: '#f44336',
    borderColor: '#f44336',
  },
  
  // Pagination
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    flexWrap: 'wrap',
    gap: '15px',
  },
  paginationInfo: {
    fontSize: '14px',
    color: '#666',
  },
  paginationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  paginationButton: {
    backgroundColor: 'white',
    border: '2px solid teal',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'teal',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  pageInfo: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  pageSizeSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  pageSizeSelect: {
    padding: '8px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  
  // Empty State
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
  },
  emptyIcon: {
    fontSize: '48px',
    color: '#ccc',
    marginBottom: '20px',
  },
  emptyTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '10px',
  },
  emptyText: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '30px',
    lineHeight: '1.5',
  },
  emptyButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  
  // Responsive Design
  '@media (max-width: 1400px)': {
    container: {
      maxWidth: '100%',
      padding: '50px 15px 20px 15px',
    },
    statsGrid: {
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    },
    table: {
      fontSize: '13px',
    },
    tableHeaderCell: {
      padding: '12px 8px',
      fontSize: '13px',
    },
  },
  
  '@media (max-width: 768px)': {
    header: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    headerActions: {
      justifyContent: 'center',
    },
    filterBar: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    searchContainer: {
      maxWidth: 'none',
    },
    filterContainer: {
      justifyContent: 'space-between',
    },
    filterSelect: {
      minWidth: 'auto',
      flex: 1,
    },
    bulkActions: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    bulkButtons: {
      justifyContent: 'center',
    },
    statsGrid: {
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    },
    pagination: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    paginationControls: {
      justifyContent: 'center',
    },
  },
};