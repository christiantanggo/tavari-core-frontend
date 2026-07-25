// components/POS/POSDailyDepositScreen/POSDepositHistoryComponent.jsx - Deposit History Management
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../supabaseClient';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { TavariStyles } from '../../../utils/TavariStyles';
import { insertAuditLog } from '../../../utils/auditLogInsert';
import { fetchRegisterStations, resolveStationLabel } from '../../../services/posRegisterStationsService';
import bcrypt from 'bcryptjs';

const POSDepositHistoryComponent = ({ 
  businessId, 
  userId, 
  businessSettings 
}) => {
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSDepositHistoryComponent'
  });

  // State management
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDeposits, setSelectedDeposits] = useState(new Set());
  
  // Manager PIN access control
  const [showAccessModal, setShowAccessModal] = useState(true);
  const [managerPin, setManagerPin] = useState('');
  const [managerPinError, setManagerPinError] = useState('');
  const [hasAccess, setHasAccess] = useState(false);
  
  // Upload state
  const [uploadingDepositId, setUploadingDepositId] = useState(null);
  const fileInputRef = useRef(null);
  
  // Filters
  const [dateFilter, setDateFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tillFilter, setTillFilter] = useState('all');
  
  // Export state
  const [exporting, setExporting] = useState(false);
  const [registerStations, setRegisterStations] = useState([]);

  useEffect(() => {
    if (businessId) {
      fetchRegisterStations(businessId, { activeOnly: false }).then(({ data }) => {
        setRegisterStations(data || []);
      });
    }
  }, [businessId]);

  useEffect(() => {
    if (hasAccess && businessId) {
      loadDepositHistory();
    }
  }, [hasAccess, businessId, dateFilter, statusFilter, tillFilter]);

  // Load deposit history with filters
  const loadDepositHistory = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('pos_daily_deposits')
        .select('*')
        .eq('business_id', businessId)
        .order('deposit_date', { ascending: false });

      // Apply date filter
      if (dateFilter !== 'all') {
        const now = new Date();
        let startDate;
        
        switch (dateFilter) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'quarter':
            const quarter = Math.floor(now.getMonth() / 3);
            startDate = new Date(now.getFullYear(), quarter * 3, 1);
            break;
          default:
            startDate = null;
        }
        
        if (startDate) {
          query = query.gte('deposit_date', startDate.toISOString().split('T')[0]);
        }
      }

      // Apply status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'submitted') {
          query = query.eq('submitted_to_bank', true);
        } else if (statusFilter === 'pending') {
          query = query.eq('submitted_to_bank', false);
        }
      }

      // Apply till filter
      if (tillFilter !== 'all') {
        query = query.eq('terminal_id', tillFilter);
      }

      const { data, error: depositError } = await query;

      if (depositError) throw depositError;

      const rows = data || [];
      const userIds = [
        ...new Set(
          rows.flatMap((deposit) => [deposit.counted_by, deposit.verified_by].filter(Boolean))
        ),
      ];

      let userMap = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, full_name, email')
          .in('id', userIds);

        userMap = Object.fromEntries((users || []).map((user) => [user.id, user]));
      }

      setDeposits(
        rows.map((deposit) => ({
          ...deposit,
          counted_by_user: userMap[deposit.counted_by] || null,
          verified_by_user: userMap[deposit.verified_by] || null,
        }))
      );
      
    } catch (err) {
      console.error('Error loading deposit history:', err);
      setError('Failed to load deposit history');
    } finally {
      setLoading(false);
    }
  };

  // Validate manager PIN for access
  const validateManagerPin = async () => {
    if (!managerPin || managerPin.length !== 4) {
      setManagerPinError('PIN must be 4 digits');
      return;
    }

    try {
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('active', true)
        .in('role', ['manager', 'owner']);

      if (rolesError) throw rolesError;

      const managerUserIds = userRoles.map(ur => ur.user_id);

      const { data: managers, error: managersError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', managerUserIds);

      if (managersError) throw managersError;

      for (const manager of managers) {
        if (!manager.pin) continue;
        
        let pinMatched = false;
        if (manager.pin.startsWith('$2b$') || manager.pin.startsWith('$2a$')) {
          pinMatched = await bcrypt.compare(managerPin, manager.pin);
        } else {
          pinMatched = manager.pin === managerPin;
        }

        if (pinMatched) {
          setHasAccess(true);
          setShowAccessModal(false);
          setManagerPin('');
          setManagerPinError('');
          
          // Log access
          await insertAuditLog({
            userId,
            businessId,
            details: {
              action: 'deposit_history_accessed',
              context: 'POSDepositHistory',
              accessed_by: manager.full_name || manager.email,
              access_time: new Date().toISOString(),
            },
          });
          
          return;
        }
      }

      setManagerPinError('Invalid manager PIN');
    } catch (err) {
      console.error('Error validating manager PIN:', err);
      setManagerPinError('Error validating PIN');
    }
  };

  // Handle bank submission status toggle
  const handleToggleBankSubmission = async (depositId, currentStatus) => {
    try {
      const { error } = await supabase
        .from('pos_daily_deposits')
        .update({ 
          submitted_to_bank: !currentStatus,
          bank_submission_date: !currentStatus ? new Date().toISOString() : null
        })
        .eq('id', depositId)
        .eq('business_id', businessId);

      if (error) throw error;

      // Log the change
      await insertAuditLog({
        userId,
        businessId,
        details: {
          action: 'deposit_bank_status_changed',
          context: 'POSDepositHistory',
          deposit_id: depositId,
          new_status: !currentStatus ? 'submitted' : 'pending',
          changed_by: auth.authUser?.email,
        },
      });

      await loadDepositHistory();
      showToast(
        !currentStatus ? 'Marked as submitted to bank' : 'Marked as pending submission',
        'success'
      );
      
    } catch (err) {
      console.error('Error updating bank submission status:', err);
      showToast('Failed to update bank submission status', 'error');
    }
  };

  // Handle bulk bank submission
  const handleBulkBankSubmission = async () => {
    if (selectedDeposits.size === 0) {
      showToast('Please select deposits to mark as submitted', 'error');
      return;
    }

    try {
      const depositIds = Array.from(selectedDeposits);
      
      const { error } = await supabase
        .from('pos_daily_deposits')
        .update({ 
          submitted_to_bank: true,
          bank_submission_date: new Date().toISOString()
        })
        .in('id', depositIds)
        .eq('business_id', businessId);

      if (error) throw error;

      // Log bulk submission
      await insertAuditLog({
        userId,
        businessId,
        details: {
          action: 'deposits_bulk_submitted',
          context: 'POSDepositHistory',
          deposit_ids: depositIds,
          count: depositIds.length,
          submitted_by: auth.authUser?.email,
        },
      });

      setSelectedDeposits(new Set());
      await loadDepositHistory();
      showToast(`${depositIds.length} deposits marked as submitted to bank`, 'success');
      
    } catch (err) {
      console.error('Error bulk updating bank submission:', err);
      showToast('Failed to update bank submission status', 'error');
    }
  };

  // Handle deposit slip upload
  const handleDepositSlipUpload = async (depositId, file) => {
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Please upload an image (JPG, PNG, GIF) or PDF file', 'error');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      showToast('File size must be less than 10MB', 'error');
      return;
    }

    try {
      setUploadingDepositId(depositId);
      
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `deposit-slip-${depositId}-${Date.now()}.${fileExt}`;
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('pos_deposit_slips')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Update deposit record with file URL
      const { error: updateError } = await supabase
        .from('pos_daily_deposits')
        .update({ 
          deposit_slip_url: uploadData.path,
          deposit_slip_uploaded_at: new Date().toISOString(),
          deposit_slip_uploaded_by: userId
        })
        .eq('id', depositId)
        .eq('business_id', businessId);

      if (updateError) throw updateError;

      // Log upload
      await insertAuditLog({
        userId,
        businessId,
        details: {
          action: 'deposit_slip_uploaded',
          context: 'POSDepositHistory',
          deposit_id: depositId,
          file_name: fileName,
          file_size: file.size,
          uploaded_by: auth.authUser?.email,
        },
      });

      await loadDepositHistory();
      showToast('Deposit slip uploaded successfully', 'success');
      
    } catch (err) {
      console.error('Error uploading deposit slip:', err);
      showToast('Failed to upload deposit slip', 'error');
    } finally {
      setUploadingDepositId(null);
    }
  };

  // Handle export to Excel/PDF
  const handleExport = async (format) => {
    try {
      setExporting(true);
      
      // Prepare export data
      const exportData = deposits.map(deposit => ({
        'Deposit Date': new Date(deposit.deposit_date).toLocaleDateString(),
        'Till': resolveStationLabel(deposit.terminal_id, registerStations),
        'Expected Total': formatCurrency(deposit.expected_total),
        'Counted Total': formatCurrency(deposit.counted_total),
        'Variance': formatCurrency(deposit.variance_amount),
        'Variance %': `${deposit.variance_percentage?.toFixed(2) || 0}%`,
        'Counted By': deposit.counted_by_user?.full_name || deposit.counted_by_user?.email || 'Unknown',
        'Verified By': deposit.verified_by_user?.full_name || deposit.verified_by_user?.email || 'Unknown',
        'Bank Status': deposit.submitted_to_bank ? 'Submitted' : 'Pending',
        'Bank Date': deposit.bank_submission_date ? new Date(deposit.bank_submission_date).toLocaleDateString() : '',
        'Notes': deposit.notes || ''
      }));

      if (format === 'excel') {
        // Create CSV content for Excel
        const headers = Object.keys(exportData[0] || {});
        const csvContent = [
          headers.join(','),
          ...exportData.map(row => 
            headers.map(header => 
              `"${(row[header] || '').toString().replace(/"/g, '""')}"`
            ).join(',')
          )
        ].join('\n');

        // Download CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `deposit-history-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        
                    } else if (format === 'pdf') {
        // For PDF, we'll create a printable HTML version
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
          <html>
            <head>
              <title>Deposit History Report</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #008080; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; font-weight: bold; }
                .variance-positive { color: #008080; }
                .variance-negative { color: #ef4444; }
                @media print {
                  .no-print { display: none; }
                }
              </style>
            </head>
            <body>
              <h1>Daily Deposit History Report</h1>
              <p>Generated: ${new Date().toLocaleString()}</p>
              <p>Total Deposits: ${exportData.length}</p>
              
              <table>
                <thead>
                  <tr>
                    ${Object.keys(exportData[0] || {}).map(header => `<th>${header}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${exportData.map(row => `
                    <tr>
                      ${Object.values(row).map(value => `<td>${value}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              
              <div class="no-print" style="margin-top: 20px;">
                <button onclick="window.print()">Print Report</button>
                <button onclick="window.close()">Close</button>
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
      }

      // Log export action
      await insertAuditLog({
        userId,
        businessId,
        details: {
          action: 'deposit_history_exported',
          context: 'POSDepositHistory',
          format,
          record_count: exportData.length,
          exported_by: auth.authUser?.email,
        },
      });

      showToast(`Deposit history exported to ${format.toUpperCase()}`, 'success');
      
    } catch (err) {
      console.error('Error exporting deposit history:', err);
      showToast('Failed to export deposit history', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Get unique tills for filter
  const getAvailableTills = () => {
    const depositTillIds = [...new Set(deposits.map((d) => d.terminal_id).filter(Boolean))];
    const configured = registerStations.map((station) => ({
      id: station.terminal_id,
      name: station.terminal_name,
    }));
    depositTillIds.forEach((tillId) => {
      if (!configured.some((station) => station.id === tillId)) {
        configured.push({ id: tillId, name: resolveStationLabel(tillId, registerStations) });
      }
    });
    return configured;
  };

  const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? TavariStyles.colors.danger : 
                   type === 'success' ? TavariStyles.colors.success : 
                   TavariStyles.colors.primary;
    
    toast.style.cssText = `
      position: fixed;
      top: 120px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-weight: bold;
      z-index: 1000;
      background-color: ${bgColor};
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 3000);
  };

  const formatCurrency = (amount) => {
    return `${Number(amount || 0).toFixed(2)}`;
  };

  const formatVariance = (amount) => {
    const num = Number(amount || 0);
    const sign = num >= 0 ? '+' : '';
    return `${sign}${formatCurrency(num)}`;
  };

  // Manager PIN Access Modal
  if (!hasAccess) {
    return (
      <div style={styles.container}>
        {showAccessModal && (
          <div style={TavariStyles.components.modal.overlay}>
            <div style={TavariStyles.components.modal.content}>
              <div style={TavariStyles.components.modal.header}>
                <h3>Manager Access Required</h3>
              </div>
              
              <div style={TavariStyles.components.modal.body}>
                <p>
                  Access to deposit history requires manager authorization. 
                  Please enter your manager PIN to continue.
                </p>
                
                <div style={styles.formGroup}>
                  <label style={TavariStyles.components.form.label}>Manager PIN</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={managerPin}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      setManagerPin(value);
                      setManagerPinError('');
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && managerPin.length === 4) {
                        validateManagerPin();
                      }
                    }}
                    placeholder="••••"
                    style={{
                      ...TavariStyles.components.form.input,
                      textAlign: 'center',
                      letterSpacing: '4px',
                      fontSize: '18px',
                      fontFamily: 'monospace'
                    }}
                    autoFocus
                  />
                  {managerPinError && (
                    <p style={styles.errorText}>{managerPinError}</p>
                  )}
                </div>
              </div>
              
              <div style={TavariStyles.components.modal.footer}>
                <button
                  onClick={validateManagerPin}
                  disabled={managerPin.length !== 4}
                  style={{
                    ...TavariStyles.components.button.base,
                    ...TavariStyles.components.button.variants.primary,
                    width: '100%'
                  }}
                >
                  Access Deposit History
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={TavariStyles.components.loading.spinner}></div>
          <div>Loading deposit history...</div>
          <style>{TavariStyles.keyframes.spin}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Filters and Actions */}
      <div style={styles.filtersSection}>
        <div style={styles.filtersRow}>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Date Range:</label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Status</option>
              <option value="pending">Pending Bank Submission</option>
              <option value="submitted">Submitted to Bank</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Till:</label>
            <select
              value={tillFilter}
              onChange={(e) => setTillFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Tills</option>
              {getAvailableTills().map(till => (
                <option key={till.id} value={till.id}>{till.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={styles.actionsRow}>
          <div style={styles.bulkActions}>
            {selectedDeposits.size > 0 && (
              <button
                onClick={handleBulkBankSubmission}
                style={{
                  ...TavariStyles.components.button.base,
                  ...TavariStyles.components.button.variants.primary,
                  ...TavariStyles.components.button.sizes.sm
                }}
              >
                Mark {selectedDeposits.size} as Submitted ({selectedDeposits.size})
              </button>
            )}
          </div>

          <div style={styles.exportActions}>
            <button
              onClick={() => handleExport('excel')}
              disabled={exporting || deposits.length === 0}
              style={{
                ...TavariStyles.components.button.base,
                ...TavariStyles.components.button.variants.secondary,
                ...TavariStyles.components.button.sizes.sm
              }}
            >
              Export Excel
            </button>
            <button
              onClick={() => handleExport('pdf')}
              disabled={exporting || deposits.length === 0}
              style={{
                ...TavariStyles.components.button.base,
                ...TavariStyles.components.button.variants.secondary,
                ...TavariStyles.components.button.sizes.sm
              }}
            >
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Deposits Table */}
      <div style={styles.tableContainer}>
        {deposits.length === 0 ? (
          <div style={styles.emptyState}>
            <h3>No Deposits Found</h3>
            <p>No daily deposits match your current filters.</p>
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr style={styles.headerRow}>
                <th style={styles.checkboxHeader}>
                  <input
                    type="checkbox"
                    checked={selectedDeposits.size === deposits.filter(d => !d.submitted_to_bank).length && deposits.filter(d => !d.submitted_to_bank).length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedDeposits(new Set(deposits.filter(d => !d.submitted_to_bank).map(d => d.id)));
                      } else {
                        setSelectedDeposits(new Set());
                      }
                    }}
                  />
                </th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Till</th>
                <th style={styles.th}>Expected</th>
                <th style={styles.th}>Counted</th>
                <th style={styles.th}>Variance</th>
                <th style={styles.th}>Counted By</th>
                <th style={styles.th}>Verified By</th>
                <th style={styles.th}>Bank Status</th>
                <th style={styles.th}>Deposit Slip</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit.id} style={styles.row}>
                  <td style={styles.td}>
                    {!deposit.submitted_to_bank && (
                      <input
                        type="checkbox"
                        checked={selectedDeposits.has(deposit.id)}
                        onChange={(e) => {
                          const newSelected = new Set(selectedDeposits);
                          if (e.target.checked) {
                            newSelected.add(deposit.id);
                          } else {
                            newSelected.delete(deposit.id);
                          }
                          setSelectedDeposits(newSelected);
                        }}
                      />
                    )}
                  </td>
                  <td style={styles.td}>
                    {new Date(deposit.deposit_date).toLocaleDateString()}
                  </td>
                  <td style={styles.td}>
                    {resolveStationLabel(deposit.terminal_id, registerStations)}
                  </td>
                  <td style={styles.td}>
                    {formatCurrency(deposit.expected_total)}
                  </td>
                  <td style={styles.td}>
                    {formatCurrency(deposit.counted_total)}
                  </td>
                  <td style={{
                    ...styles.td,
                    color: deposit.variance_amount === 0 ? TavariStyles.colors.success :
                           deposit.variance_amount > 0 ? TavariStyles.colors.primary :
                           TavariStyles.colors.danger,
                    fontWeight: TavariStyles.typography.fontWeight.semibold
                  }}>
                    {formatVariance(deposit.variance_amount)}
                    <br />
                    <small>({deposit.variance_percentage?.toFixed(2) || 0}%)</small>
                  </td>
                  <td style={styles.td}>
                    {deposit.counted_by_user?.full_name || deposit.counted_by_user?.email || 'Unknown'}
                  </td>
                  <td style={styles.td}>
                    {deposit.verified_by_user?.full_name || deposit.verified_by_user?.email || 'Unknown'}
                  </td>
                  <td style={styles.td}>
                    <div style={styles.statusCell}>
                      <span style={{
                        ...styles.statusBadge,
                        backgroundColor: deposit.submitted_to_bank ? TavariStyles.colors.success : TavariStyles.colors.warning,
                        color: TavariStyles.colors.white
                      }}>
                        {deposit.submitted_to_bank ? 'Submitted' : 'Pending'}
                      </span>
                      {deposit.bank_submission_date && (
                        <small style={styles.dateText}>
                          {new Date(deposit.bank_submission_date).toLocaleDateString()}
                        </small>
                      )}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.depositSlipCell}>
                      {deposit.deposit_slip_url ? (
                        <a
                          href={`${supabase.storage.from('pos_deposit_slips').getPublicUrl(deposit.deposit_slip_url).data.publicUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.viewSlipLink}
                        >
                          View Slip
                        </a>
                      ) : (
                        <>
                          <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept="image/*,.pdf"
                            onChange={(e) => {
                              if (e.target.files[0]) {
                                handleDepositSlipUpload(deposit.id, e.target.files[0]);
                                e.target.value = '';
                              }
                            }}
                          />
                          <button
                            onClick={() => {
                              setUploadingDepositId(deposit.id);
                              fileInputRef.current?.click();
                            }}
                            disabled={uploadingDepositId === deposit.id}
                            style={{
                              ...TavariStyles.components.button.base,
                              ...TavariStyles.components.button.variants.secondary,
                              ...TavariStyles.components.button.sizes.sm
                            }}
                          >
                            {uploadingDepositId === deposit.id ? 'Uploading...' : 'Upload'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <button
                      onClick={() => handleToggleBankSubmission(deposit.id, deposit.submitted_to_bank)}
                      style={{
                        ...TavariStyles.components.button.base,
                        ...TavariStyles.components.button.variants.ghost,
                        ...TavariStyles.components.button.sizes.sm
                      }}
                    >
                      {deposit.submitted_to_bank ? 'Mark Pending' : 'Mark Submitted'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <div style={TavariStyles.utils.merge(
          TavariStyles.components.banner.base,
          TavariStyles.components.banner.variants.error
        )}>
          {error}
        </div>
      )}
    </div>
  );
};

// Styles
const styles = {
  container: {
    padding: TavariStyles.spacing.xl,
    maxHeight: 'calc(100vh - 200px)',
    overflow: 'auto'
  },

  filtersSection: {
    marginBottom: TavariStyles.spacing.xl,
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.lg,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },

  filtersRow: {
    display: 'flex',
    gap: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.lg,
    flexWrap: 'wrap'
  },

  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },

  filterLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray700
  },

  filterSelect: {
    ...TavariStyles.components.form.select,
    minWidth: '150px'
  },

  actionsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TavariStyles.spacing.lg
  },

  bulkActions: {
    display: 'flex',
    gap: TavariStyles.spacing.md
  },

  exportActions: {
    display: 'flex',
    gap: TavariStyles.spacing.md
  },

  tableContainer: {
    ...TavariStyles.components.table.container,
    maxHeight: 'calc(100vh - 400px)',
    overflow: 'auto'
  },

  table: {
    ...TavariStyles.components.table.table
  },

  headerRow: {
    ...TavariStyles.components.table.headerRow
  },

  checkboxHeader: {
    ...TavariStyles.components.table.th,
    width: '50px',
    textAlign: 'center'
  },

  th: {
    ...TavariStyles.components.table.th
  },

  row: {
    ...TavariStyles.components.table.row,
    ':hover': {
      backgroundColor: TavariStyles.colors.gray50
    }
  },

  td: {
    ...TavariStyles.components.table.td,
    fontSize: TavariStyles.typography.fontSize.sm
  },

  statusCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },

  statusBadge: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    textAlign: 'center'
  },

  dateText: {
    color: TavariStyles.colors.gray500,
    fontSize: TavariStyles.typography.fontSize.xs
  },

  depositSlipCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },

  viewSlipLink: {
    color: TavariStyles.colors.primary,
    textDecoration: 'underline',
    fontSize: TavariStyles.typography.fontSize.sm
  },

  emptyState: {
    textAlign: 'center',
    padding: TavariStyles.spacing['6xl'],
    color: TavariStyles.colors.gray500
  },

  loading: {
    ...TavariStyles.components.loading.container,
    minHeight: '300px'
  },

  formGroup: {
    marginBottom: TavariStyles.spacing.lg
  },

  errorText: {
    color: TavariStyles.colors.danger,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginTop: TavariStyles.spacing.xs
  }
};

export default POSDepositHistoryComponent;