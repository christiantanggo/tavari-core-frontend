// src/components/Scheduling/AvailabilityTab.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';
import { isSchedulingVisibleForWeek } from '../../utils/businessEmploymentStatus';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';

dayjs.extend(weekOfYear);

const AvailabilityTab = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(dayjs().startOf('week'));
  const [employees, setEmployees] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [draggedEmployee, setDraggedEmployee] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState({ employeeId: null, day: null });
  const [editingAvailability, setEditingAvailability] = useState(null);
  
  // Modal state
  const [isAvailable, setIsAvailable] = useState(true);
  const [dayOfWeek, setDayOfWeek] = useState(0); // 0 = Sunday, 1 = Monday, etc.
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [selectedDays, setSelectedDays] = useState([]);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [indefinitely, setIndefinitely] = useState(false);
  const [wholeDay, setWholeDay] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);

  const weekDays = Array.from({ length: 7 }, (_, i) => currentWeek.clone().add(i, 'days'));
  const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  useEffect(() => {
    if (businessId) {
      loadEmployees();
      loadAvailability();
    }
  }, [businessId, currentWeek]);

  const loadEmployees = async () => {
    if (!businessId) return;
    try {
      const { data: businessUsers, error } = await supabase
        .from('business_users')
        .select(`user_id, role, employment_status, termination_date, employee_order, users!business_users_user_id_fkey(id, full_name, employment_status, wage, position, hire_date)`) 
        .eq('business_id', businessId);

      if (error) throw error;

      const employeeMap = new Map();

      (businessUsers || [])
        .filter((bu) => bu.users && isSchedulingVisibleForWeek({
          membership: bu,
          user: bu.users,
          role: bu.role,
        }))
        .forEach(bu => {
          employeeMap.set(bu.users.id, {
            id: bu.users.id,
            full_name: bu.users.full_name,
            wage: bu.users.wage || 0,
            position: bu.users.position,
            order: Number.isInteger(bu.employee_order) ? bu.employee_order : null,
            hireDate: bu.users.hire_date || null
          });
        });

      const activeEmployees = Array.from(employeeMap.values())
        .sort((a, b) => {
          const hasOrderA = a.order !== null;
          const hasOrderB = b.order !== null;
          if (hasOrderA || hasOrderB) {
            const orderA = hasOrderA ? a.order : Number.MAX_SAFE_INTEGER;
            const orderB = hasOrderB ? b.order : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
          }

          if (a.hireDate && b.hireDate) {
            const diff = new Date(a.hireDate).getTime() - new Date(b.hireDate).getTime();
            if (diff !== 0) return diff;
          } else if (a.hireDate && !b.hireDate) {
            return -1;
          } else if (!a.hireDate && b.hireDate) {
            return 1;
          }

          return a.full_name.localeCompare(b.full_name);
        });

      setEmployees(activeEmployees);
    } catch (error) {
      console.error('Error loading employees:', error);
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailability = async () => {
    if (!businessId) return;
    try {
      const { data, error } = await supabase
        .from('scheduling_availability')
        .select('*')
        .eq('business_id', businessId);

      if (error) throw error;
      setAvailability(data || []);
    } catch (error) {
      console.error('Error loading availability:', error);
    }
  };

  const navigateWeek = (direction) => {
    setCurrentWeek(currentWeek.clone().add(direction, 'week'));
  };

  const handleAddAvailability = (employeeId, day) => {
    setSelectedCell({ employeeId, day });
    setEditingAvailability(null);
    setShowModal(true);
    setIsAvailable(true);
    setDayOfWeek(day.day());
    setStartTime('09:00');
    setEndTime('17:00');
    setSelectedDays([]);
    setEffectiveDate(day.format('YYYY-MM-DD'));
    setExpiryDate(day.format('YYYY-MM-DD'));
    setIndefinitely(false);
    setWholeDay(false);
  };

  const handleEditAvailability = (availabilityItem, employeeId, day) => {
    setEditingAvailability(availabilityItem);
    setSelectedCell({ employeeId, day });
    setShowModal(true);
    setIsAvailable(availabilityItem.is_available);
    setDayOfWeek(availabilityItem.day_of_week);
    const isWholeDay = Boolean(
      availabilityItem.all_day ||
      (!availabilityItem.start_time && !availabilityItem.end_time) ||
      (availabilityItem.start_time === '00:00' && (availabilityItem.end_time === '23:59' || availabilityItem.end_time === '24:00'))
    );
    setWholeDay(isWholeDay);
    setStartTime(isWholeDay ? '00:00' : (availabilityItem.start_time || '09:00'));
    setEndTime(isWholeDay ? '23:59' : (availabilityItem.end_time || '17:00'));
    setSelectedDays([availabilityItem.day_of_week]);
    setEffectiveDate(availabilityItem.effective_date);
    setExpiryDate(availabilityItem.expiry_date);
    setIndefinitely(!availabilityItem.expiry_date);
  };

  const toggleDay = (dayIndex) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) 
        ? prev.filter(d => d !== dayIndex)
        : [...prev, dayIndex]
    );
  };

  const handleSaveAvailability = async () => {
    if (!selectedCell.employeeId || !selectedCell.day) return;

    try {
      if (!wholeDay) {
        const toMinutes = (time) => {
          const [h, m] = time.split(':').map(Number);
          if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
          return h * 60 + m;
        };
        const startMinutes = toMinutes(startTime);
        const endMinutes = toMinutes(endTime);
        if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes) || startMinutes >= endMinutes) {
          toast.error('End time must be after start time');
          return;
        }
      }

      const payloadStart = wholeDay ? '00:00' : startTime;
      const payloadEnd = wholeDay ? '23:59' : endTime;
      const { data: { user } } = await supabase.auth.getUser();

      if (editingAvailability) {
        // Update existing
        const { data: updatedAvailability, error } = await supabase
          .from('scheduling_availability')
          .update({
            is_available: isAvailable,
            start_time: payloadStart,
            end_time: payloadEnd,
            all_day: wholeDay,
            effective_date: effectiveDate,
            expiry_date: indefinitely ? null : expiryDate,
            status: 'pending',
            requested_by: user?.id || null,
            approved_by: null,
            approved_at: null,
            denied_by: null,
            denied_at: null,
            denial_reason: null
          })
          .eq('id', editingAvailability.id)
          .select('id, employee_id, day_of_week, is_available, start_time, end_time, all_day, effective_date, expiry_date, status')
          .maybeSingle();

        if (error) throw error;
        toast.success('Availability request updated and sent for approval');
        await sendSchedulingNotification({
          businessId,
          eventKey: 'availability_submitted',
          employeeId: updatedAvailability?.employee_id || editingAvailability.employee_id,
          context: {
            action: 'updated',
            availability: updatedAvailability
          }
        });
      } else {
        // Insert new
        const daysToApply = selectedDays.length > 0 ? selectedDays : [selectedCell.day.day()];
        
        const startDateObj = dayjs(effectiveDate);
        const endDateObj = indefinitely ? null : dayjs(expiryDate);

        const records = daysToApply.map(dayIndex => ({
          business_id: businessId,
          employee_id: selectedCell.employeeId,
          day_of_week: dayIndex,
          is_available: isAvailable,
          start_time: payloadStart,
          end_time: payloadEnd,
          all_day: wholeDay,
          effective_date: startDateObj.format('YYYY-MM-DD'),
          expiry_date: endDateObj ? endDateObj.format('YYYY-MM-DD') : null,
          status: 'pending',
          requested_by: user?.id || null
        }));

        const { data: createdAvailability, error } = await supabase
          .from('scheduling_availability')
          .insert(records)
          .select('id, employee_id, day_of_week, is_available, start_time, end_time, all_day, effective_date, expiry_date, status');

        if (error) throw error;
        toast.success('Availability request submitted for approval');
        await Promise.all((createdAvailability || []).map((record) => sendSchedulingNotification({
          businessId,
          eventKey: 'availability_submitted',
          employeeId: record.employee_id,
          context: {
            action: 'created',
            availability: record
          }
        })));
      }

      setShowModal(false);
      loadAvailability();
    } catch (error) {
      console.error('Error saving availability:', error);
      toast.error('Failed to save availability');
    }
  };

  const handleAvailabilityDecision = async (availabilityItem, decision) => {
    const denialReason = decision === 'denied'
      ? window.prompt('Reason for denial? This will be included with the request.', availabilityItem.denial_reason || '')
      : '';

    if (decision === 'denied' && denialReason === null) return;

    setSavingDecision(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = decision === 'approved'
        ? {
            status: 'approved',
            approved_by: user?.id || null,
            approved_at: new Date().toISOString(),
            denied_by: null,
            denied_at: null,
            denial_reason: null,
            updated_at: new Date().toISOString()
          }
        : {
            status: 'denied',
            denied_by: user?.id || null,
            denied_at: new Date().toISOString(),
            approved_by: null,
            approved_at: null,
            denial_reason: denialReason || null,
            updated_at: new Date().toISOString()
          };

      const { data: updatedAvailability, error } = await supabase
        .from('scheduling_availability')
        .update(payload)
        .eq('id', availabilityItem.id)
        .select('id, employee_id, day_of_week, is_available, start_time, end_time, all_day, effective_date, expiry_date, status, denial_reason')
        .maybeSingle();

      if (error) throw error;

      await sendSchedulingNotification({
        businessId,
        eventKey: decision === 'approved' ? 'availability_approved' : 'availability_denied',
        employeeId: availabilityItem.employee_id,
        context: {
          availability: updatedAvailability,
          denialReason: updatedAvailability?.denial_reason
        }
      });

      toast.success(`Availability ${decision}`);
      loadAvailability();
    } catch (error) {
      console.error('Error updating availability status:', error);
      toast.error(`Failed to ${decision} availability`);
    } finally {
      setSavingDecision(false);
    }
  };

  const handleDeleteAvailability = async () => {
    if (!editingAvailability) return;

    try {
      const { error } = await supabase
        .from('scheduling_availability')
        .delete()
        .eq('id', editingAvailability.id);

      if (error) throw error;
      
      toast.success('Availability deleted successfully');
      setShowModal(false);
      loadAvailability();
    } catch (error) {
      console.error('Error deleting availability:', error);
      toast.error('Failed to delete availability');
    }
  };

  const getAvailabilityForCell = (employeeId, date) => {
    const targetDay = date.startOf('day');
    return availability.filter((av) => {
      if (av.employee_id !== employeeId) return false;
      const matchesDow = typeof av.day_of_week === 'number' && av.day_of_week === targetDay.day();
      const matchesDate = av.availability_date ? dayjs(av.availability_date).isSame(targetDay, 'day') : false;
      if (!matchesDow && !matchesDate) return false;
      const effective = av.effective_date ? dayjs(av.effective_date) : null;
      const expiry = av.expiry_date ? dayjs(av.expiry_date) : null;
      if (effective && targetDay.isBefore(effective, 'day')) return false;
      if (expiry && targetDay.isAfter(expiry, 'day')) return false;
      return true;
    });
  };

  const formatTimeLabel = (timeString) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return '';
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const formatAvailabilityLabel = (av) => {
    const isWholeDay = Boolean(
      av.all_day ||
      (!av.start_time && !av.end_time) ||
      (av.start_time === '00:00' && (av.end_time === '23:59' || av.end_time === '24:00'))
    );

    if (av.is_available) {
      if (isWholeDay) return 'Available (Whole Day)';
      return `Available ${formatTimeLabel(av.start_time)} - ${formatTimeLabel(av.end_time)}`;
    }

    if (isWholeDay) return 'Unavailable (Whole Day)';
    return `Unavailable ${formatTimeLabel(av.start_time)} - ${formatTimeLabel(av.end_time)}`;
  };

  const getAvailabilityStatus = (av) => av.status || 'approved';

  const getStatusStyles = (status) => {
    const normalized = status || 'approved';
    if (normalized === 'pending') return { backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#f59e0b' };
    if (normalized === 'denied') return { backgroundColor: '#fee2e2', color: '#991b1b', borderColor: '#ef4444' };
    if (normalized === 'cancelled') return { backgroundColor: '#e5e7eb', color: '#374151', borderColor: '#9ca3af' };
    return { backgroundColor: '#dcfce7', color: '#166534', borderColor: '#22c55e' };
  };

  const formatStatus = (status) => String(status || 'approved').replace(/_/g, ' ');

  const handleEmployeeDragStart = (event, employeeId) => {
    setDraggedEmployee(employeeId);
    event.dataTransfer.setData('application/x-tavari-employee', String(employeeId));
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleEmployeeDragOver = (event) => {
    if (!draggedEmployee && !event.dataTransfer.types?.includes('application/x-tavari-employee')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleEmployeeDragEnd = () => {
    setDraggedEmployee(null);
  };

  const handleEmployeeDrop = async (targetEmployeeId) => {
    if (!draggedEmployee || draggedEmployee === targetEmployeeId) {
      setDraggedEmployee(null);
      return;
    }

    const draggedIndex = employees.findIndex((e) => e.id === draggedEmployee);
    const targetIndex = employees.findIndex((e) => e.id === targetEmployeeId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedEmployee(null);
      return;
    }

    const reordered = [...employees];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, removed);

    try {
      await Promise.all(
        reordered.map((emp, index) =>
          supabase
            .from('business_users')
            .update({ employee_order: index })
            .eq('business_id', businessId)
            .eq('user_id', emp.id)
        )
      );
      setEmployees(reordered.map((emp, index) => ({ ...emp, order: index })));
    } catch (error) {
      console.error('Error updating employee order:', error);
      toast.error('Failed to update employee order');
      loadEmployees();
    }

    setDraggedEmployee(null);
  };

  const styles = {
    container: {
      padding: '20px',
      backgroundColor: TavariStyles.colors.background
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px'
    },
    weekNavigation: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    },
    navButton: {
      padding: '8px 16px',
      backgroundColor: TavariStyles.colors.primary,
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontWeight: '600'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: '200px repeat(7, 1fr)',
      gap: '4px'
    },
    gridHeader: {
      padding: '12px',
      backgroundColor: TavariStyles.colors.gray100,
      fontWeight: '600',
      textAlign: 'center',
      fontSize: '14px',
      color: TavariStyles.colors.gray700
    },
    employeeCell: {
      padding: '12px',
      backgroundColor: 'white',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    dragHandle: {
      color: TavariStyles.colors.gray400,
      cursor: 'grab'
    },
    employeeHireDate: {
      fontSize: '13px',
      color: TavariStyles.colors.gray600,
      marginTop: '2px'
    },
    dayCell: {
      padding: '8px',
      backgroundColor: 'white',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      minHeight: '60px',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    addButton: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      backgroundColor: TavariStyles.colors.primary,
      color: 'white',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '18px',
      opacity: 0,
      transition: 'opacity 0.15s ease'
    },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    },
    modalContent: {
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '24px',
      width: '90%',
      maxWidth: '600px',
      maxHeight: '80vh',
      overflowY: 'auto'
    }
  };

  return (
    <div style={styles.container}>
      {/* Header with Week Navigation */}
      <div style={styles.header}>
        <h2 style={{ margin: 0 }}>Employee Availability</h2>
        <div style={styles.weekNavigation}>
          <button onClick={() => navigateWeek(-1)} style={styles.navButton}>
            ‹ Previous Week
          </button>
          <span style={{ fontWeight: '600' }}>
            {currentWeek.format('MMMM D')} - {currentWeek.clone().add(6, 'days').format('MMMM D, YYYY')}
          </span>
          <button onClick={() => navigateWeek(1)} style={styles.navButton}>
            Next Week ›
          </button>
        </div>
      </div>

      {/* Availability Grid */}
      <div style={styles.grid}>
        {/* Header Row */}
        <div style={styles.gridHeader}>Team Members</div>
        {weekDays.map((day, index) => (
          <div key={day.format('YYYY-MM-DD')} style={styles.gridHeader}>
            <div>{dayLetters[index]}</div>
            <div style={{ fontSize: '13px', marginTop: '4px', color: TavariStyles.colors.gray600 }}>
              {day.format('M/D')}
            </div>
          </div>
        ))}

        {/* Employee Rows */}
        {employees.map(employee => (
          <React.Fragment key={employee.id}>
            <div
              style={styles.employeeCell}
              onDragOver={handleEmployeeDragOver}
              onDrop={(event) => {
                const isEmployeeDrag = draggedEmployee || event.dataTransfer.types?.includes('application/x-tavari-employee');
                if (!isEmployeeDrag) return;
                event.preventDefault();
                handleEmployeeDrop(employee.id);
              }}
            >
              <div
                style={styles.dragHandle}
                draggable
                onDragStart={(event) => handleEmployeeDragStart(event, employee.id)}
                onDragEnd={handleEmployeeDragEnd}
              >
                <GripVertical size={16} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span>{employee.full_name}</span>
                {employee.hireDate && (
                  <span style={styles.employeeHireDate}>
                    Hire date: {new Date(employee.hireDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            {weekDays.map(day => {
              const dayAvail = getAvailabilityForCell(employee.id, day);
              return (
                <div
                  key={day.format('YYYY-MM-DD')}
                  style={styles.dayCell}
                  onMouseEnter={(e) => {
                    const btn = e.currentTarget.querySelector('button[data-add-availability]');
                    if (btn) btn.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    const btn = e.currentTarget.querySelector('button[data-add-availability]');
                    if (btn) btn.style.opacity = '0';
                  }}
                  onDragOver={handleEmployeeDragOver}
                  onDrop={(event) => {
                    if (draggedEmployee) {
                      event.preventDefault();
                      handleEmployeeDrop(employee.id);
                    }
                  }}
                >
                  {dayAvail.length > 0 ? (
                    <div style={{ fontSize: '13px', textAlign: 'center' }}>
                      {dayAvail.map((av, idx) => (
                        <div
                          key={idx}
                          style={{
                            backgroundColor: av.is_available ? '#dbeafe' : '#fee2e2',
                            border: `1px solid ${getStatusStyles(getAvailabilityStatus(av)).borderColor}`,
                            padding: '4px 8px',
                            borderRadius: '6px',
                            marginBottom: '4px',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <div
                            onClick={() => handleEditAvailability(av, employee.id, day)}
                            style={{
                              cursor: 'pointer',
                              fontWeight: 700
                            }}
                          >
                            {formatAvailabilityLabel(av)}
                          </div>
                          <div
                            style={{
                              display: 'inline-flex',
                              marginTop: '4px',
                              padding: '2px 6px',
                              borderRadius: '999px',
                              fontSize: '10px',
                              fontWeight: 800,
                              textTransform: 'capitalize',
                              ...getStatusStyles(getAvailabilityStatus(av))
                            }}
                          >
                            {formatStatus(getAvailabilityStatus(av))}
                          </div>
                          {getAvailabilityStatus(av) === 'pending' && (
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginTop: '6px' }}>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleAvailabilityDecision(av, 'approved');
                                }}
                                disabled={savingDecision}
                                style={{
                                  border: 'none',
                                  backgroundColor: '#16a34a',
                                  color: 'white',
                                  borderRadius: '4px',
                                  padding: '3px 6px',
                                  fontSize: '10px',
                                  cursor: 'pointer',
                                  fontWeight: 800
                                }}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleAvailabilityDecision(av, 'denied');
                                }}
                                disabled={savingDecision}
                                style={{
                                  border: 'none',
                                  backgroundColor: '#dc2626',
                                  color: 'white',
                                  borderRadius: '4px',
                                  padding: '3px 6px',
                                  fontSize: '10px',
                                  cursor: 'pointer',
                                  fontWeight: 800
                                }}
                              >
                                Deny
                              </button>
                            </div>
                          )}
                          {getAvailabilityStatus(av) === 'denied' && av.denial_reason && (
                            <div style={{ marginTop: '4px', fontSize: '10px', color: '#991b1b' }}>
                              {av.denial_reason}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      data-add-availability
                      onClick={() => handleAddAvailability(employee.id, day)}
                      style={styles.addButton}
                    >
                      <Plus size={20} />
                    </button>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Add Availability Modal */}
      {showModal && (
        <div style={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>{editingAvailability ? 'Edit Availability' : 'Add Availability'}</h3>
              <button onClick={() => setShowModal(false)} style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            {/* Availability Type Toggle */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', backgroundColor: '#e5e7eb', borderRadius: '8px', padding: '4px' }}>
              <button
                onClick={() => {
                  setIsAvailable(true);
                  setWholeDay(false);
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: isAvailable ? 'white' : 'transparent',
                  color: isAvailable ? '#008080' : '#6b7280',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isAvailable ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                Available
              </button>
              <button
                onClick={() => setIsAvailable(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: !isAvailable ? 'white' : 'transparent',
                  color: !isAvailable ? '#008080' : '#6b7280',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: !isAvailable ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                Unavailable
              </button>
            </div>

            {/* Time Selection */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                  disabled={wholeDay}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                  disabled={wholeDay}
                />
              </div>
            </div>

            {!isAvailable && (
              <div style={{ marginBottom: '20px' }}>
                <TavariCheckbox
                  checked={wholeDay}
                  onChange={(checked) => {
                    setWholeDay(checked);
                    if (checked) {
                      setStartTime('00:00');
                      setEndTime('23:59');
                    }
                  }}
                  label="Whole Day"
                />
              </div>
            )}

            {/* Day Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px' }}>
                Apply to Days
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {dayLetters.map((letter, index) => (
                  <button
                    key={index}
                    onClick={() => toggleDay(index)}
                    style={{
                      width: '40px',
                      height: '40px',
                      border: '2px solid',
                      borderColor: selectedDays.includes(index) ? '#008080' : '#e5e7eb',
                      backgroundColor: selectedDays.includes(index) ? '#008080' : 'transparent',
                      color: selectedDays.includes(index) ? 'white' : '#374151',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px' }}>
                Click day buttons to apply to multiple days
              </p>
            </div>

            {/* Date Range */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <TavariCheckbox
                    checked={indefinitely}
                    onChange={setIndefinitely}
                  />
                  <label style={{ fontWeight: '600', fontSize: '14px' }}>Indefinitely</label>
                </div>
              </div>

              {!indefinitely && (
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>
                      Effective Date
                    </label>
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>
                      Expiry Date
                    </label>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              {editingAvailability && (
                <button
                  onClick={handleDeleteAvailability}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAvailability}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#008080',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                {editingAvailability ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvailabilityTab;

