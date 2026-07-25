// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\screens\Dining\ReservationsScreen.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiPlus, FiCalendar, FiUsers, FiClock, FiTrash2, FiEdit2, FiLock, FiAlertCircle, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import toast from 'react-hot-toast';

const ReservationsScreen = () => {
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'ReservationsScreen'
  });

  // Permission system
  const { 
    hasPermission, 
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const [reservations, setReservations] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingReservation, setEditingReservation] = useState(null);
  const [viewStartDate, setViewStartDate] = useState(new Date());
  const [daysToShow, setDaysToShow] = useState(7); // Show 7 days at a time
  const [newReservation, setNewReservation] = useState({
    table_id: '',
    reservation_name: '',
    reservation_time: '',
    reservation_guest_count: 2,
    reservation_phone: '',
    reservation_email: '',
    notes: ''
  });

  // Permission checks
  const canViewReservations = hasPermission('dining.reservations.view');
  const canCreateReservations = hasPermission('dining.reservations.create');
  const canEditReservations = hasPermission('dining.reservations.edit');
  const canCancelReservations = hasPermission('dining.reservations.cancel');

  useEffect(() => {
    if (!permissionsLoading && !canViewReservations) {
      toast.error('You do not have permission to view reservations');
    }
  }, [permissionsLoading, canViewReservations]);

  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading) {
      if (canViewReservations) {
        loadReservations();
        loadTables();
      }
    }
  }, [auth.selectedBusinessId, permissionsLoading, canViewReservations, viewStartDate, daysToShow]);

  const loadReservations = async () => {
    try {
      setLoading(true);
      
      // Calculate date range
      const endDate = new Date(viewStartDate);
      endDate.setDate(endDate.getDate() + daysToShow);
      
      const { data, error } = await supabase
        .from('dining_tables')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_reserved', true)
        .gte('reservation_time', viewStartDate.toISOString())
        .lte('reservation_time', endDate.toISOString())
        .order('reservation_time');

      if (error) throw error;
      
      setReservations(data || []);
    } catch (err) {
      console.error('❌ Error loading reservations:', err);
      toast.error('Error loading reservations');
    } finally {
      setLoading(false);
    }
  };

  const loadTables = async () => {
    try {
      const { data, error } = await supabase
        .from('dining_tables')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .order('table_number');

      if (error) throw error;
      setTables(data || []);
    } catch (err) {
      console.error('❌ Error loading tables:', err);
      toast.error('Error loading tables');
    }
  };

  const handleAddReservation = async () => {
    if (!canCreateReservations) {
      toast.error('You do not have permission to create reservations');
      return;
    }

    if (!newReservation.reservation_name || !newReservation.reservation_time) {
      toast.error('Please fill in guest name and reservation time');
      return;
    }

    if (!newReservation.table_id) {
      const availableTable = tables.find(t => !t.is_reserved);
      
      if (!availableTable) {
        toast.error('No tables available. Please create tables first in Table Map.');
        return;
      }
      
      newReservation.table_id = availableTable.id;
    }

    try {
      const updateData = {
        is_reserved: true,
        reservation_name: newReservation.reservation_name,
        reservation_time: newReservation.reservation_time,
        reservation_guest_count: Number(newReservation.reservation_guest_count),
        reservation_phone: newReservation.reservation_phone || null,
        reservation_email: newReservation.reservation_email || null,
        notes: newReservation.notes || null
      };

      const { data, error } = await supabase
        .from('dining_tables')
        .update(updateData)
        .eq('id', newReservation.table_id)
        .select();

      if (error) throw error;

      await loadReservations();
      setShowAddForm(false);
      setNewReservation({
        table_id: '',
        reservation_name: '',
        reservation_time: '',
        reservation_guest_count: 2,
        reservation_phone: '',
        reservation_email: '',
        notes: ''
      });
      toast.success('Reservation added successfully!');
    } catch (err) {
      console.error('❌ Error adding reservation:', err);
      toast.error('Error adding reservation: ' + err.message);
    }
  };

  const handleStartEdit = (reservation) => {
    if (!canEditReservations) {
      toast.error('You do not have permission to edit reservations');
      return;
    }

    setEditingReservation(reservation.id);
    setNewReservation({
      table_id: reservation.id,
      reservation_name: reservation.reservation_name,
      reservation_time: reservation.reservation_time,
      reservation_guest_count: reservation.reservation_guest_count,
      reservation_phone: reservation.reservation_phone || '',
      reservation_email: reservation.reservation_email || '',
      notes: reservation.notes || ''
    });
    setShowAddForm(true);
  };

  const handleUpdateReservation = async () => {
    if (!canEditReservations) {
      toast.error('You do not have permission to edit reservations');
      return;
    }

    if (!newReservation.reservation_name || !newReservation.reservation_time) {
      toast.error('Please fill in guest name and reservation time');
      return;
    }

    try {
      const { error } = await supabase
        .from('dining_tables')
        .update({
          reservation_name: newReservation.reservation_name,
          reservation_time: newReservation.reservation_time,
          reservation_guest_count: Number(newReservation.reservation_guest_count),
          reservation_phone: newReservation.reservation_phone || null,
          reservation_email: newReservation.reservation_email || null,
          notes: newReservation.notes || null
        })
        .eq('id', editingReservation);

      if (error) throw error;

      await loadReservations();
      setShowAddForm(false);
      setEditingReservation(null);
      setNewReservation({
        table_id: '',
        reservation_name: '',
        reservation_time: '',
        reservation_guest_count: 2,
        reservation_phone: '',
        reservation_email: '',
        notes: ''
      });
      toast.success('Reservation updated successfully!');
    } catch (err) {
      console.error('Error updating reservation:', err);
      toast.error('Error updating reservation: ' + err.message);
    }
  };

  const handleCancelReservation = async (tableId) => {
    if (!canCancelReservations) {
      toast.error('You do not have permission to cancel reservations');
      return;
    }

    if (!window.confirm('Are you sure you want to cancel this reservation?')) return;

    try {
      const { error } = await supabase
        .from('dining_tables')
        .update({
          is_reserved: false,
          reservation_name: null,
          reservation_time: null,
          reservation_guest_count: null,
          reservation_phone: null,
          reservation_email: null,
          notes: null
        })
        .eq('id', tableId);

      if (error) throw error;

      await loadReservations();
      toast.success('Reservation cancelled successfully!');
    } catch (err) {
      console.error('Error cancelling reservation:', err);
      toast.error('Error cancelling reservation: ' + err.message);
    }
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    setEditingReservation(null);
    setNewReservation({
      table_id: '',
      reservation_name: '',
      reservation_time: '',
      reservation_guest_count: 2,
      reservation_phone: '',
      reservation_email: '',
      notes: ''
    });
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDateHeader = (date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    
    const diffTime = compareDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getDayLabel = (date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    
    const diffTime = compareDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  };

  // Group reservations by date
  const groupReservationsByDate = () => {
    const grouped = {};
    const dates = [];
    
    // Generate all dates in range
    for (let i = 0; i < daysToShow; i++) {
      const date = new Date(viewStartDate);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      grouped[dateKey] = [];
      dates.push({ date, dateKey });
    }
    
    // Group reservations
    reservations.forEach(reservation => {
      const dateKey = new Date(reservation.reservation_time).toISOString().split('T')[0];
      if (grouped[dateKey]) {
        grouped[dateKey].push(reservation);
      }
    });
    
    return { grouped, dates };
  };

  const handlePreviousWeek = () => {
    const newDate = new Date(viewStartDate);
    newDate.setDate(newDate.getDate() - daysToShow);
    setViewStartDate(newDate);
  };

  const handleNextWeek = () => {
    const newDate = new Date(viewStartDate);
    newDate.setDate(newDate.getDate() + daysToShow);
    setViewStartDate(newDate);
  };

  const handleToday = () => {
    setViewStartDate(new Date());
  };

  // Loading state
  if (loading || permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={{...TavariStyles.components.loading.spinner}}></div>
          <p>Loading reservations...</p>
        </div>
      </div>
    );
  }

  // No access screen
  if (!canViewReservations) {
    return (
      <div style={styles.container}>
        <div style={styles.noAccessContainer}>
          <div style={styles.noAccessCard}>
            <FiLock size={64} style={styles.lockIcon} />
            <h2 style={styles.noAccessTitle}>Access Denied</h2>
            <p style={styles.noAccessText}>
              You do not have permission to view reservations.
            </p>
            <p style={styles.noAccessSubtext}>
              Contact your manager or business owner to request access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { grouped, dates } = groupReservationsByDate();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Reservations</h1>
          <p style={styles.subtitle}>Manage table reservations</p>
        </div>
        
        {canCreateReservations && (
          <button 
            style={styles.addButton} 
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <FiPlus /> New Reservation
          </button>
        )}
      </div>

      {/* Date Navigation */}
      <div style={styles.dateNavigation}>
        <button style={styles.navButton} onClick={handlePreviousWeek}>
          <FiChevronLeft /> Previous
        </button>
        <button style={styles.todayButton} onClick={handleToday}>
          Today
        </button>
        <button style={styles.navButton} onClick={handleNextWeek}>
          Next <FiChevronRight />
        </button>
      </div>

      {/* Add/Edit Reservation Form */}
      {showAddForm && canCreateReservations && (
        <div style={styles.addForm}>
          <h3 style={styles.formTitle}>
            {editingReservation ? 'Edit Reservation' : 'New Reservation'}
          </h3>
          
          <div style={styles.formGrid}>
            {!editingReservation && (
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Table (Optional)
                  <span style={styles.optionalBadge}>Optional</span>
                </label>
                <select
                  style={styles.select}
                  value={newReservation.table_id}
                  onChange={(e) => setNewReservation({...newReservation, table_id: e.target.value})}
                >
                  <option value="">No specific table (assign later)</option>
                  {tables.filter(t => !t.is_reserved).map(table => (
                    <option key={table.id} value={table.id}>
                      Table {table.table_number} - {table.capacity} seats
                    </option>
                  ))}
                </select>
                {!newReservation.table_id && (
                  <div style={styles.infoMessage}>
                    <FiAlertCircle size={14} />
                    <span>Table will be auto-assigned or you can choose one later</span>
                  </div>
                )}
              </div>
            )}

            <div style={styles.formGroup}>
              <label style={styles.label}>Guest Name *</label>
              <input
                type="text"
                style={styles.input}
                placeholder="John Doe"
                value={newReservation.reservation_name}
                onChange={(e) => setNewReservation({...newReservation, reservation_name: e.target.value})}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Phone Number</label>
              <input
                type="tel"
                style={styles.input}
                placeholder="(555) 123-4567"
                value={newReservation.reservation_phone}
                onChange={(e) => setNewReservation({...newReservation, reservation_phone: e.target.value})}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                style={styles.input}
                placeholder="guest@example.com"
                value={newReservation.reservation_email}
                onChange={(e) => setNewReservation({...newReservation, reservation_email: e.target.value})}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Date & Time *</label>
              <input
                type="datetime-local"
                style={styles.input}
                value={newReservation.reservation_time}
                onChange={(e) => setNewReservation({...newReservation, reservation_time: e.target.value})}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Number of Guests</label>
              <input
                type="number"
                style={styles.input}
                min="1"
                max="20"
                value={newReservation.reservation_guest_count}
                onChange={(e) => setNewReservation({...newReservation, reservation_guest_count: parseInt(e.target.value) || 2})}
              />
            </div>

            <div style={{...styles.formGroup, gridColumn: '1 / -1'}}>
              <label style={styles.label}>Special Requests / Notes</label>
              <textarea
                style={{...styles.input, minHeight: '80px', fontFamily: 'inherit'}}
                placeholder="Allergies, dietary restrictions, special occasions, etc."
                value={newReservation.notes}
                onChange={(e) => setNewReservation({...newReservation, notes: e.target.value})}
              />
            </div>
          </div>

          <div style={styles.formActions}>
            <button 
              style={styles.submitButton} 
              onClick={editingReservation ? handleUpdateReservation : handleAddReservation}
            >
              {editingReservation ? 'Update Reservation' : 'Add Reservation'}
            </button>
            <button 
              style={styles.cancelButton} 
              onClick={handleCancelForm}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reservations by Date */}
      <div style={styles.content}>
        {dates.map(({ date, dateKey }) => (
          <div key={dateKey} style={styles.dateSection}>
            <div style={styles.dateHeader}>
              <div style={styles.dateHeaderLeft}>
                <h2 style={styles.dateTitle}>{formatDateHeader(date)}</h2>
                <span style={styles.dateSubtitle}>
                  {date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              <div style={styles.reservationCount}>
                {grouped[dateKey].length} {grouped[dateKey].length === 1 ? 'Reservation' : 'Reservations'}
              </div>
            </div>

            {grouped[dateKey].length === 0 ? (
              <div style={styles.noReservationsForDay}>
                <FiCalendar size={32} color="#ccc" />
                <p>No reservations for this day</p>
              </div>
            ) : (
              <div style={styles.reservationsList}>
                {grouped[dateKey].map((reservation) => (
                  <div key={reservation.id} style={styles.reservationCard}>
                    <div style={styles.cardHeader}>
                      <div style={styles.cardLeft}>
                        <div style={styles.timeBlock}>
                          <FiClock size={18} />
                          <span style={styles.timeText}>{formatTime(reservation.reservation_time)}</span>
                        </div>
                        <div style={styles.guestInfo}>
                          <div style={styles.guestName}>{reservation.reservation_name}</div>
                          <div style={styles.cardDetail}>
                            <FiUsers size={14} />
                            <span>{reservation.reservation_guest_count} guests</span>
                            <span style={styles.separator}>•</span>
                            <span style={styles.tableLabel}>Table {reservation.table_number}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div style={styles.cardActions}>
                        {canEditReservations && (
                          <button
                            style={styles.editButton}
                            onClick={() => handleStartEdit(reservation)}
                            title="Edit reservation"
                          >
                            <FiEdit2 />
                          </button>
                        )}
                        {canCancelReservations && (
                          <button
                            style={styles.cancelReservationButton}
                            onClick={() => handleCancelReservation(reservation.id)}
                            title="Cancel reservation"
                          >
                            <FiTrash2 />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {(reservation.reservation_phone || reservation.reservation_email || reservation.notes) && (
                      <div style={styles.cardBody}>
                        {reservation.reservation_phone && (
                          <div style={styles.contactDetail}>
                            <span>📞</span>
                            <span>{reservation.reservation_phone}</span>
                          </div>
                        )}
                        {reservation.reservation_email && (
                          <div style={styles.contactDetail}>
                            <span>✉️</span>
                            <span>{reservation.reservation_email}</span>
                          </div>
                        )}
                        {reservation.notes && (
                          <div style={styles.notes}>
                            <strong>Notes:</strong> {reservation.notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f5f5f5',
    paddingTop: '80px',
    overflow: 'hidden'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '16px'
  },
  noAccessContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '40px'
  },
  noAccessCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '48px',
    textAlign: 'center',
    maxWidth: '500px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
  },
  lockIcon: {
    color: '#dc2626',
    marginBottom: '24px'
  },
  noAccessTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '12px'
  },
  noAccessText: {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '8px'
  },
  noAccessSubtext: {
    fontSize: '14px',
    color: '#9ca3af'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #e0e0e0'
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    margin: 0
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    margin: 0
  },
  addButton: {
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'background-color 0.2s'
  },
  dateNavigation: {
    display: 'flex',
    gap: '12px',
    padding: '16px 24px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #e0e0e0',
    justifyContent: 'center',
    alignItems: 'center'
  },
  navButton: {
    padding: '8px 16px',
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s',
    ':hover': {
      backgroundColor: '#f5f5f5'
    }
  },
  todayButton: {
    padding: '8px 24px',
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'background-color 0.2s'
  },
  addForm: {
    padding: '24px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #e0e0e0'
  },
  formTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    marginBottom: '20px'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '20px',
    marginBottom: '20px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  optionalBadge: {
    fontSize: '11px',
    fontWeight: '600',
    backgroundColor: '#e0e0e0',
    color: '#666',
    padding: '2px 8px',
    borderRadius: '12px',
    textTransform: 'uppercase'
  },
  input: {
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px'
  },
  select: {
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    backgroundColor: '#fff'
  },
  infoMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#0ea5e9',
    backgroundColor: '#e0f2fe',
    padding: '8px 12px',
    borderRadius: '4px',
    marginTop: '4px'
  },
  formActions: {
    display: 'flex',
    gap: '12px'
  },
  submitButton: {
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'background-color 0.2s'
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '24px'
  },
  dateSection: {
    marginBottom: '32px'
  },
  dateHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '2px solid #008080'
  },
  dateHeaderLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  dateTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  dateSubtitle: {
    fontSize: '14px',
    color: '#6b7280'
  },
  reservationCount: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#008080',
    backgroundColor: '#e0f2f2',
    padding: '6px 16px',
    borderRadius: '20px'
  },
  noReservationsForDay: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    border: '2px dashed #e0e0e0',
    gap: '12px',
    color: '#999'
  },
  reservationsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  reservationCard: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
    transition: 'all 0.2s',
    ':hover': {
      boxShadow: '0 4px 8px rgba(0,0,0,0.12)'
    }
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardLeft: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    flex: 1
  },
  timeBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#f0f9ff',
    padding: '8px 12px',
    borderRadius: '6px',
    minWidth: '100px'
  },
  timeText: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#0369a1'
  },
  guestInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  guestName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937'
  },
  cardDetail: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#6b7280'
  },
  separator: {
    color: '#d1d5db'
  },
  tableLabel: {
    fontWeight: '600',
    color: '#008080'
  },
  cardActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  editButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#008080',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '4px',
    transition: 'background-color 0.2s',
    ':hover': {
      backgroundColor: '#f0f9ff'
    }
  },
  cancelReservationButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#dc2626',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '4px',
    transition: 'background-color 0.2s',
    ':hover': {
      backgroundColor: '#fee2e2'
    }
  },
  cardBody: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  contactDetail: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#6b7280'
  },
  notes: {
    marginTop: '4px',
    padding: '12px',
    backgroundColor: '#fef3c7',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#92400e',
    borderLeft: '3px solid #f59e0b'
  }
};

export default ReservationsScreen;