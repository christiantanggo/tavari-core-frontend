// components/CustomVoiceAgent/CustomAgentBookings.jsx
// Bookings/Reservations for custom voice agents with Calendar View
import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Phone, Mail, Users, Clock, List, CalendarDays, ChevronLeft, ChevronRight, Plus, X, Edit2, Trash2, Settings } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bcrypt from 'bcryptjs';

// Helper functions (defined outside component)
const formatTime = (timeStr) => {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [year, month, day] = dateStr.split('T')[0].split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

// Generate time slots (8 AM to 8 PM in 30-minute increments)
const generateTimeSlots = () => {
  const slots = [];
  for (let hour = 8; hour <= 20; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const displayTime = formatTime(timeStr);
      slots.push({ time: timeStr, displayTime });
    }
  }
  return slots;
};

const CustomAgentBookings = ({ businessId, customVoiceAgentService }) => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' or 'list'
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD format
  });
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null); // null = create, object = edit
  const [bookingFormData, setBookingFormData] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    booking_type: 'appointment',
    service_type: '',
    booking_date: '',
    booking_time: '',
    party_size: 1,
    duration_minutes: 30,
    notes: '',
    status: 'confirmed',
  });
  const [savingBooking, setSavingBooking] = useState(false);
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [maxCapacity, setMaxCapacity] = useState(1); // Max capacity per time slot
  const [capacityOverrides, setCapacityOverrides] = useState({}); // { "date_time": capacity }
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [overridingSlot, setOverridingSlot] = useState(null); // { date, time }
  const [overrideCapacity, setOverrideCapacity] = useState(1);

  // Use pre-generated time slots
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  useEffect(() => {
    if (businessId) {
      loadAgents();
      loadBookings();
      loadCapacity();
    }
  }, [businessId, filter, selectedDate, viewMode]);

  const loadCapacity = async () => {
    try {
      const config = await customVoiceAgentService.getConfiguration();
      if (config && config.max_capacity_per_slot) {
        setMaxCapacity(config.max_capacity_per_slot);
      }
    } catch (error) {
      console.error('Error loading capacity config:', error);
    }
  };

  const loadAgents = async () => {
    try {
      const agentsData = await customVoiceAgentService.getAgents();
      setAgents(agentsData || []);
      if (agentsData && agentsData.length > 0 && !selectedAgentId) {
        setSelectedAgentId(agentsData[0].id);
      }
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  };

  const loadBookings = async () => {
    try {
      setLoading(true);
      // Load bookings for a wider date range to ensure calendar display works
      const startDate = new Date(selectedDate);
      startDate.setDate(startDate.getDate() - 7); // 7 days before
      const endDate = new Date(selectedDate);
      endDate.setDate(endDate.getDate() + 30); // 30 days after

      let query = supabase
        .from('voice_agent_bookings')
        .select('*')
        .eq('business_id', businessId)
        .gte('booking_date', startDate.toISOString().split('T')[0])
        .lte('booking_date', endDate.toISOString().split('T')[0])
        .order('booking_date', { ascending: true })
        .order('booking_time', { ascending: true })
        .limit(500);

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setBookings(data || []);
    } catch (error) {
      console.error('Error loading bookings:', error);
      toast.error('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  // Normalize date string for comparison
  const normalizeDateString = (dateValue) => {
    if (!dateValue) return null;
    if (typeof dateValue === 'string') {
      const dateMatch = dateValue.match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        return dateMatch[1];
      }
    }
    const dateObj = new Date(dateValue);
    if (isNaN(dateObj.getTime())) return null;
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Normalize time format for comparison
  const normalizeTime = (timeStr) => {
    if (!timeStr) return '';
    return timeStr.substring(0, 5); // "14:30:00" -> "14:30"
  };

  // Get all bookings for a specific time slot
  const getBookingsForTime = (date, time) => {
    const normalizedDate = normalizeDateString(date);
    return bookings.filter(booking => {
      const bookingDate = normalizeDateString(booking.booking_date);
      const normalizedBookingTime = normalizeTime(booking.booking_time);
      const normalizedSlotTime = normalizeTime(time);
      return bookingDate === normalizedDate && 
        normalizedBookingTime === normalizedSlotTime &&
        booking.status !== 'cancelled';
    });
  };

  // Get booking count and capacity info for a time slot
  const getTimeSlotInfo = (date, time) => {
    const slotBookings = getBookingsForTime(date, time);
    const bookedCount = slotBookings.length;
    
    // Check if there's an override for this slot
    const slotKey = `${date}_${time}`;
    const effectiveCapacity = capacityOverrides[slotKey] || maxCapacity;
    
    const isFull = bookedCount >= effectiveCapacity;
    const remaining = Math.max(0, effectiveCapacity - bookedCount);
    
    return {
      bookings: slotBookings,
      bookedCount,
      isFull,
      remaining,
      maxCapacity: effectiveCapacity,
      isOverridden: !!capacityOverrides[slotKey],
    };
  };

  // Verify manager PIN
  const verifyManagerPin = async (pin) => {
    if (!businessId) {
      throw new Error('Business ID is required');
    }

    try {
      // Get all managers/owners/admins for this business
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('active', true)
        .in('role', ['manager', 'owner', 'admin']);

      if (rolesError || !userRoles || userRoles.length === 0) {
        return false;
      }

      const managerUserIds = userRoles.map(ur => ur.user_id);

      // Get PINs for all managers
      const { data: managers, error: managersError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', managerUserIds);

      if (managersError || !managers) {
        return false;
      }

      // Check PIN against all managers
      for (const manager of managers) {
        if (!manager.pin) continue;

        let pinMatched = false;
        if (manager.pin.startsWith('$2b$') || manager.pin.startsWith('$2a$')) {
          // Bcrypt hashed PIN
          pinMatched = await bcrypt.compare(pin, manager.pin);
        } else {
          // Plain text PIN
          pinMatched = String(manager.pin) === String(pin);
        }

        if (pinMatched) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error verifying manager PIN:', error);
      return false;
    }
  };

  // Open capacity override modal
  const openCapacityOverride = (date, time) => {
    const slotKey = `${date}_${time}`;
    const currentOverride = capacityOverrides[slotKey];
    setOverridingSlot({ date, time });
    setOverrideCapacity(currentOverride || maxCapacity);
    setPinInput('');
    setPinError('');
    setShowPinModal(true);
  };

  // Handle PIN submission for capacity override
  const handlePinSubmit = async () => {
    if (pinInput.length !== 4) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }

    try {
      const isValid = await verifyManagerPin(pinInput);
      
      if (isValid) {
        // PIN verified, apply capacity override
        const slotKey = `${overridingSlot.date}_${overridingSlot.time}`;
        setCapacityOverrides(prev => ({
          ...prev,
          [slotKey]: overrideCapacity,
        }));
        
        toast.success(`Capacity override set to ${overrideCapacity} for this time slot`);
        setShowPinModal(false);
        setPinInput('');
        setPinError('');
        setOverridingSlot(null);
      } else {
        setPinError('Invalid PIN. Please try again.');
        setPinInput('');
      }
    } catch (error) {
      console.error('Error verifying PIN:', error);
      setPinError('Failed to verify PIN. Please try again.');
    }
  };

  // Remove capacity override
  const removeCapacityOverride = async (date, time) => {
    if (!window.confirm('Remove capacity override for this time slot?')) {
      return;
    }

    // Verify PIN again before removing
    const pin = window.prompt('Enter manager PIN to remove override:');
    if (!pin || pin.length !== 4) {
      toast.error('PIN required to remove override');
      return;
    }

    try {
      const isValid = await verifyManagerPin(pin);
      if (isValid) {
        const slotKey = `${date}_${time}`;
        setCapacityOverrides(prev => {
          const newOverrides = { ...prev };
          delete newOverrides[slotKey];
          return newOverrides;
        });
        toast.success('Capacity override removed');
      } else {
        toast.error('Invalid PIN');
      }
    } catch (error) {
      console.error('Error verifying PIN:', error);
      toast.error('Failed to verify PIN');
    }
  };

  const changeDate = (days) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    setSelectedDate(newDate.toISOString().split('T')[0]);
  };

  const goToToday = () => {
    const today = new Date();
    setSelectedDate(today.toISOString().split('T')[0]);
  };

  const openBookingModal = (date = null, time = null, booking = null) => {
    if (booking) {
      // Editing existing booking
      setEditingBooking(booking);
      setBookingFormData({
        customer_name: booking.customer_name || '',
        customer_phone: booking.customer_phone || '',
        customer_email: booking.customer_email || '',
        booking_type: booking.booking_type || 'appointment',
        service_type: booking.service_type || '',
        booking_date: booking.booking_date || '',
        booking_time: booking.booking_time || '',
        party_size: booking.party_size || 1,
        duration_minutes: booking.duration_minutes || 30,
        notes: booking.notes || '',
        status: booking.status || 'confirmed',
      });
      setSelectedAgentId(booking.agent_id);
    } else {
      // Creating new booking
      setEditingBooking(null);
      setBookingFormData({
        customer_name: '',
        customer_phone: '',
        customer_email: '',
        booking_type: 'appointment',
        service_type: '',
        booking_date: date || selectedDate,
        booking_time: time || '',
        party_size: 1,
        duration_minutes: 30,
        notes: '',
        status: 'confirmed',
      });
    }
    setShowBookingModal(true);
  };

  const handleSaveBooking = async () => {
    if (!selectedAgentId && !editingBooking) {
      toast.error('Please select an agent first');
      return;
    }

    if (!bookingFormData.customer_name || !bookingFormData.customer_phone || !bookingFormData.booking_date || !bookingFormData.booking_time) {
      toast.error('Please fill in all required fields (Name, Phone, Date, Time)');
      return;
    }

    // Check capacity before creating new booking (not when editing)
    if (!editingBooking) {
      const slotInfo = getTimeSlotInfo(bookingFormData.booking_date, bookingFormData.booking_time);
      if (slotInfo.isFull) {
        toast.error(`This time slot is full (${slotInfo.bookedCount}/${slotInfo.maxCapacity} booked). Please choose another time.`);
        return;
      }
    } else {
      // When editing, check capacity only if date/time changed
      const originalDate = editingBooking.booking_date;
      const originalTime = editingBooking.booking_time;
      if (bookingFormData.booking_date !== originalDate || bookingFormData.booking_time !== originalTime) {
        const slotInfo = getTimeSlotInfo(bookingFormData.booking_date, bookingFormData.booking_time);
        // Exclude the current booking from the count
        const otherBookings = slotInfo.bookings.filter(b => b.id !== editingBooking.id);
        if (otherBookings.length >= maxCapacity) {
          toast.error(`This time slot is full (${otherBookings.length}/${maxCapacity} bookings). Please choose another time.`);
          return;
        }
      }
    }

    try {
      setSavingBooking(true);
      
      if (editingBooking) {
        // Update existing booking
        await customVoiceAgentService.updateBooking(editingBooking.id, {
          customer_name: bookingFormData.customer_name,
          customer_phone: bookingFormData.customer_phone,
          customer_email: bookingFormData.customer_email || null,
          booking_type: bookingFormData.booking_type,
          service_type: bookingFormData.service_type || null,
          booking_date: bookingFormData.booking_date,
          booking_time: bookingFormData.booking_time,
          party_size: bookingFormData.party_size || 1,
          duration_minutes: bookingFormData.duration_minutes || 30,
          notes: bookingFormData.notes || null,
          status: bookingFormData.status,
        });
        toast.success('Booking updated successfully!');
      } else {
        // Create new booking
        const createdBooking = await customVoiceAgentService.createBooking(selectedAgentId, bookingFormData);
        toast.success('Booking created successfully!');
      }
      
      setShowBookingModal(false);
      setEditingBooking(null);
      setBookingFormData({
        customer_name: '',
        customer_phone: '',
        customer_email: '',
        booking_type: 'appointment',
        service_type: '',
        booking_date: '',
        booking_time: '',
        party_size: 1,
        duration_minutes: 30,
        notes: '',
        status: 'confirmed',
      });
      await loadBookings();
    } catch (error) {
      console.error('Error saving booking:', error);
      toast.error(`Failed to ${editingBooking ? 'update' : 'create'} booking: ${error.message || 'Unknown error'}`);
    } finally {
      setSavingBooking(false);
    }
  };

  const handleDeleteBooking = async (booking) => {
    if (!window.confirm(`Are you sure you want to delete the booking for "${booking.customer_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await customVoiceAgentService.deleteBooking(booking.id);
      toast.success('Booking deleted successfully');
      await loadBookings();
    } catch (error) {
      console.error('Error deleting booking:', error);
      toast.error('Failed to delete booking: ' + (error.message || 'Unknown error'));
    }
  };

  const updateBookingStatus = async (bookingId, newStatus) => {
    try {
      await customVoiceAgentService.updateBookingStatus(bookingId, newStatus);
      toast.success('Booking status updated');
      await loadBookings();
    } catch (error) {
      console.error('Error updating booking:', error);
      toast.error('Failed to update booking');
    }
  };

  // Render calendar view
  const renderCalendarView = () => {
    return (
      <div>
        {/* Date Navigation */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: TavariStyles.spacing.lg,
          padding: TavariStyles.spacing.md,
          backgroundColor: TavariStyles.colors.gray50,
          borderRadius: TavariStyles.borderRadius?.md || '8px',
        }}>
          <button
            onClick={() => changeDate(-1)}
            style={{
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
              border: `1px solid ${TavariStyles.colors.gray300}`,
              borderRadius: TavariStyles.borderRadius?.md || '8px',
              backgroundColor: TavariStyles.colors.white,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: TavariStyles.spacing.xs,
            }}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: TavariStyles.typography.fontSize.lg, fontWeight: '600' }}>
              {formatDate(selectedDate)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: TavariStyles.spacing.sm }}>
            <button
              onClick={goToToday}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                backgroundColor: TavariStyles.colors.white,
                cursor: 'pointer',
                fontSize: TavariStyles.typography.fontSize.sm,
              }}
            >
              Today
            </button>
            <button
              onClick={() => changeDate(1)}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                backgroundColor: TavariStyles.colors.white,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: TavariStyles.spacing.xs,
              }}
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr 60px 60px',
          gap: TavariStyles.spacing.sm,
          border: `1px solid ${TavariStyles.colors.gray200}`,
          borderRadius: TavariStyles.borderRadius?.md || '8px',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.gray100, fontWeight: 'bold' }}>Time</div>
          <div style={{ padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.gray100, fontWeight: 'bold', textAlign: 'center' }}>
            Bookings
          </div>
          <div style={{ padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.gray100 }}></div>
          <div style={{ padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.gray100 }}></div>

          {/* Time slots */}
          {timeSlots.map((slot) => {
            const slotInfo = getTimeSlotInfo(selectedDate, slot.time);
            const isFull = slotInfo.isFull;
            const slotKey = `${selectedDate}_${slot.time}`;
            const hasOverride = !!capacityOverrides[slotKey];
            return (
              <React.Fragment key={slot.time}>
                <div style={{
                  padding: TavariStyles.spacing.md,
                  borderTop: `1px solid ${TavariStyles.colors.gray200}`,
                  fontSize: TavariStyles.typography.fontSize.sm,
                }}>
                  {slot.displayTime}
                </div>
                <div style={{
                  padding: TavariStyles.spacing.md,
                  borderTop: `1px solid ${TavariStyles.colors.gray200}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: TavariStyles.spacing.xs,
                }}>
                  {slotInfo.bookings.length > 0 ? (
                    slotInfo.bookings.map((booking, idx) => (
                      <div key={booking.id || idx} style={{
                        padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                        backgroundColor: booking.status === 'confirmed' ? '#d1fae5' : '#fef3c7',
                        borderRadius: TavariStyles.borderRadius?.sm || '6px',
                        fontSize: TavariStyles.typography.fontSize.sm,
                        fontWeight: '500',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: TavariStyles.spacing.xs,
                      }}>
                        <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => openBookingModal(null, null, booking)}>
                          {booking.customer_name} - {formatTime(booking.booking_time)}
                        </span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openBookingModal(null, null, booking);
                            }}
                            style={{
                              padding: '4px',
                              border: 'none',
                              backgroundColor: 'transparent',
                              cursor: 'pointer',
                              color: TavariStyles.colors.gray600,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Edit booking"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBooking(booking);
                            }}
                            style={{
                              padding: '4px',
                              border: 'none',
                              backgroundColor: 'transparent',
                              cursor: 'pointer',
                              color: '#dc2626',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Delete booking"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: TavariStyles.colors.gray400, fontSize: TavariStyles.typography.fontSize.sm }}>Available</div>
                  )}
                  {/* Capacity indicator */}
                  <div style={{
                    fontSize: TavariStyles.typography.fontSize.xs,
                    color: isFull ? '#dc2626' : TavariStyles.colors.gray600,
                    fontWeight: isFull ? '600' : '400',
                  }}>
                    {slotInfo.bookedCount}/{slotInfo.maxCapacity} {slotInfo.bookedCount === 1 ? 'booking' : 'bookings'}
                    {slotInfo.remaining > 0 && ` (${slotInfo.remaining} ${slotInfo.remaining === 1 ? 'spot' : 'spots'} left)`}
                    {hasOverride && (
                      <span style={{ 
                        marginLeft: '6px', 
                        color: '#008080', 
                        fontWeight: '600',
                        fontSize: '10px',
                      }} title="Capacity overridden by manager">
                        (OVERRIDE)
                      </span>
                    )}
                  </div>
                </div>
                <div style={{
                  padding: TavariStyles.spacing.md,
                  borderTop: `1px solid ${TavariStyles.colors.gray200}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <button
                    onClick={() => {
                      if (isFull && !hasOverride) {
                        toast.error(`This time slot is full (${slotInfo.bookedCount}/${slotInfo.maxCapacity}). Please choose another time.`);
                      } else {
                        openBookingModal(selectedDate, slot.time);
                      }
                    }}
                    disabled={isFull && !hasOverride}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      border: `1px solid ${TavariStyles.colors.gray300}`,
                      backgroundColor: (isFull && !hasOverride) ? TavariStyles.colors.gray200 : TavariStyles.colors.white,
                      cursor: (isFull && !hasOverride) ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '20px',
                      color: (isFull && !hasOverride) ? TavariStyles.colors.gray400 : TavariStyles.colors.gray700,
                      opacity: (isFull && !hasOverride) ? 0.5 : 1,
                    }}
                    title={(isFull && !hasOverride) ? `Full (${slotInfo.bookedCount}/${slotInfo.maxCapacity})` : 'Add booking'}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div style={{
                  padding: TavariStyles.spacing.md,
                  borderTop: `1px solid ${TavariStyles.colors.gray200}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <button
                    onClick={() => openCapacityOverride(selectedDate, slot.time)}
                    style={{
                      padding: '6px',
                      border: hasOverride ? `2px solid #008080` : `1px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: TavariStyles.borderRadius?.sm || '6px',
                      backgroundColor: hasOverride ? '#e0f2f1' : TavariStyles.colors.white,
                      color: hasOverride ? '#008080' : TavariStyles.colors.gray600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title={hasOverride ? 'Edit capacity override' : 'Override capacity (Manager PIN required)'}
                  >
                    <Settings size={16} />
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  // Render list view
  const renderListView = () => {
    // Filter to only show upcoming bookings (not past)
    const now = new Date();
    const upcomingBookings = bookings.filter(booking => {
      const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`);
      return bookingDateTime >= now;
    });

    const filteredBookings = filter === 'all' 
      ? upcomingBookings 
      : upcomingBookings.filter(b => b.status === filter);

    if (filteredBookings.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray600 }}>
          <Calendar size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
          <div>No bookings found</div>
        </div>
      );
    }

    return filteredBookings.map(booking => (
      <div key={booking.id} style={{
        padding: TavariStyles.spacing.lg,
        border: `1px solid ${TavariStyles.colors.gray200}`,
        borderRadius: TavariStyles.borderRadius?.md || '8px',
        marginBottom: TavariStyles.spacing.md,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: TavariStyles.spacing.md,
        }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: TavariStyles.typography.fontSize.lg, fontWeight: '600', marginBottom: '4px' }}>
              {booking.customer_name}
            </h3>
            <div style={{ display: 'flex', gap: TavariStyles.spacing.md, flexWrap: 'wrap', fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
              {booking.customer_phone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Phone size={14} />
                  {booking.customer_phone}
                </div>
              )}
              {booking.customer_email && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Mail size={14} />
                  {booking.customer_email}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Calendar size={14} />
                {formatDate(booking.booking_date)} at {formatTime(booking.booking_time)}
              </div>
              {booking.party_size > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Users size={14} />
                  {booking.party_size} guests
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, alignItems: 'center' }}>
            <div style={{
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: '600',
              textTransform: 'capitalize',
              backgroundColor: booking.status === 'confirmed' ? '#d1fae5' : booking.status === 'cancelled' ? '#fee2e2' : '#fef3c7',
              color: booking.status === 'confirmed' ? '#065f46' : booking.status === 'cancelled' ? '#991b1b' : '#92400e',
            }}>
              {booking.status}
            </div>
            <button
              onClick={() => openBookingModal(null, null, booking)}
              style={{
                padding: '6px',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.sm || '6px',
                backgroundColor: TavariStyles.colors.white,
                cursor: 'pointer',
                color: TavariStyles.colors.gray600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Edit booking"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => handleDeleteBooking(booking)}
              style={{
                padding: '6px',
                border: `1px solid #fee2e2`,
                borderRadius: TavariStyles.borderRadius?.sm || '6px',
                backgroundColor: TavariStyles.colors.white,
                cursor: 'pointer',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Delete booking"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {booking.notes && (
          <div style={{ marginTop: TavariStyles.spacing.sm, padding: TavariStyles.spacing.sm, backgroundColor: TavariStyles.colors.gray50, borderRadius: TavariStyles.borderRadius?.sm || '6px' }}>
            {booking.notes}
          </div>
        )}
      </div>
    ));
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading bookings...</div>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
    }}>
      {/* View Toggle and Filters */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: TavariStyles.spacing.xl,
        flexWrap: 'wrap',
        gap: TavariStyles.spacing.md,
      }}>
        <div style={{ display: 'flex', gap: TavariStyles.spacing.sm }}>
          <button
            onClick={() => setViewMode('calendar')}
            style={{
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
              border: `1px solid ${TavariStyles.colors.gray300}`,
              borderRadius: TavariStyles.borderRadius?.md || '8px',
              backgroundColor: viewMode === 'calendar' ? TavariStyles.colors.primary || '#008080' : TavariStyles.colors.white,
              color: viewMode === 'calendar' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
              cursor: 'pointer',
              fontSize: TavariStyles.typography.fontSize.sm,
              display: 'flex',
              alignItems: 'center',
              gap: TavariStyles.spacing.xs,
            }}
          >
            <CalendarDays size={16} />
            Calendar
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
              border: `1px solid ${TavariStyles.colors.gray300}`,
              borderRadius: TavariStyles.borderRadius?.md || '8px',
              backgroundColor: viewMode === 'list' ? TavariStyles.colors.primary || '#008080' : TavariStyles.colors.white,
              color: viewMode === 'list' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
              cursor: 'pointer',
              fontSize: TavariStyles.typography.fontSize.sm,
              display: 'flex',
              alignItems: 'center',
              gap: TavariStyles.spacing.xs,
            }}
          >
            <List size={16} />
            List
          </button>
        </div>

        {viewMode === 'list' && (
          <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, flexWrap: 'wrap' }}>
            <button
              onClick={() => setFilter('all')}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                backgroundColor: filter === 'all' ? TavariStyles.colors.primary || '#008080' : TavariStyles.colors.white,
                color: filter === 'all' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
                cursor: 'pointer',
                fontSize: TavariStyles.typography.fontSize.sm,
              }}
            >
              All
            </button>
            <button
              onClick={() => setFilter('confirmed')}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                backgroundColor: filter === 'confirmed' ? TavariStyles.colors.primary || '#008080' : TavariStyles.colors.white,
                color: filter === 'confirmed' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
                cursor: 'pointer',
                fontSize: TavariStyles.typography.fontSize.sm,
              }}
            >
              Confirmed
            </button>
            <button
              onClick={() => setFilter('pending')}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                backgroundColor: filter === 'pending' ? TavariStyles.colors.primary || '#008080' : TavariStyles.colors.white,
                color: filter === 'pending' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
                cursor: 'pointer',
                fontSize: TavariStyles.typography.fontSize.sm,
              }}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('cancelled')}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                backgroundColor: filter === 'cancelled' ? TavariStyles.colors.primary || '#008080' : TavariStyles.colors.white,
                color: filter === 'cancelled' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
                cursor: 'pointer',
                fontSize: TavariStyles.typography.fontSize.sm,
              }}
            >
              Cancelled
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {viewMode === 'calendar' ? renderCalendarView() : renderListView()}

      {/* Booking Modal */}
      {showBookingModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: TavariStyles.colors.white,
            borderRadius: TavariStyles.borderRadius?.lg || '12px',
            padding: TavariStyles.spacing.xl,
            maxWidth: '500px',
            width: '90%',
            maxHeight: '90vh',
            overflowY: 'auto',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: TavariStyles.spacing.lg,
            }}>
              <h2 style={{ fontSize: TavariStyles.typography.fontSize.xl, fontWeight: '600' }}>
                {editingBooking ? 'Edit Booking' : 'Create Booking'}
              </h2>
              <button
                onClick={() => {
                  setShowBookingModal(false);
                  setEditingBooking(null);
                  setBookingFormData({
                    customer_name: '',
                    customer_phone: '',
                    customer_email: '',
                    booking_type: 'appointment',
                    service_type: '',
                    booking_date: '',
                    booking_time: '',
                    party_size: 1,
                    duration_minutes: 30,
                    notes: '',
                    status: 'confirmed',
                  });
                }}
                style={{
                  padding: TavariStyles.spacing.xs,
                  border: 'none',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {agents.length > 0 && !editingBooking && (
              <div style={{ marginBottom: TavariStyles.spacing.md }}>
                <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                  Agent *
                </label>
                <select
                  value={selectedAgentId || ''}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: TavariStyles.borderRadius?.md || '8px',
                  }}
                >
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Customer Name *
              </label>
              <input
                type="text"
                value={bookingFormData.customer_name}
                onChange={(e) => setBookingFormData({ ...bookingFormData, customer_name: e.target.value })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Phone Number *
              </label>
              <input
                type="tel"
                value={bookingFormData.customer_phone}
                onChange={(e) => setBookingFormData({ ...bookingFormData, customer_phone: e.target.value })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Email
              </label>
              <input
                type="email"
                value={bookingFormData.customer_email}
                onChange={(e) => setBookingFormData({ ...bookingFormData, customer_email: e.target.value })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Date *
              </label>
              <input
                type="date"
                value={bookingFormData.booking_date}
                onChange={(e) => setBookingFormData({ ...bookingFormData, booking_date: e.target.value })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Time *
              </label>
              <input
                type="time"
                value={bookingFormData.booking_time}
                onChange={(e) => setBookingFormData({ ...bookingFormData, booking_time: e.target.value })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Service Type
              </label>
              <input
                type="text"
                value={bookingFormData.service_type}
                onChange={(e) => setBookingFormData({ ...bookingFormData, service_type: e.target.value })}
                placeholder="e.g., Birthday Party, Consultation"
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Party Size
              </label>
              <input
                type="number"
                min="1"
                value={bookingFormData.party_size}
                onChange={(e) => setBookingFormData({ ...bookingFormData, party_size: parseInt(e.target.value) || 1 })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Duration (minutes)
              </label>
              <input
                type="number"
                min="15"
                step="15"
                value={bookingFormData.duration_minutes}
                onChange={(e) => setBookingFormData({ ...bookingFormData, duration_minutes: parseInt(e.target.value) || 30 })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Status
              </label>
              <select
                value={bookingFormData.status}
                onChange={(e) => setBookingFormData({ ...bookingFormData, status: e.target.value })}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Notes
              </label>
              <textarea
                value={bookingFormData.notes}
                onChange={(e) => setBookingFormData({ ...bookingFormData, notes: e.target.value })}
                rows={3}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: TavariStyles.spacing.md, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowBookingModal(false);
                  setEditingBooking(null);
                  setBookingFormData({
                    customer_name: '',
                    customer_phone: '',
                    customer_email: '',
                    booking_type: 'appointment',
                    service_type: '',
                    booking_date: '',
                    booking_time: '',
                    party_size: 1,
                    duration_minutes: 30,
                    notes: '',
                    status: 'confirmed',
                  });
                }}
                style={{
                  padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  backgroundColor: TavariStyles.colors.white,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBooking}
                disabled={savingBooking}
                style={{
                  padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
                  border: 'none',
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  backgroundColor: TavariStyles.colors.primary || '#008080',
                  color: TavariStyles.colors.white,
                  cursor: savingBooking ? 'not-allowed' : 'pointer',
                  opacity: savingBooking ? 0.6 : 1,
                }}
              >
                {savingBooking ? (editingBooking ? 'Updating...' : 'Creating...') : (editingBooking ? 'Update Booking' : 'Create Booking')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN Modal for Capacity Override */}
      {showPinModal && overridingSlot && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
        }}>
          <div style={{
            backgroundColor: TavariStyles.colors.white,
            borderRadius: TavariStyles.borderRadius?.lg || '12px',
            padding: TavariStyles.spacing.xl,
            maxWidth: '400px',
            width: '90%',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: TavariStyles.spacing.lg,
            }}>
              <h2 style={{ fontSize: TavariStyles.typography.fontSize.xl, fontWeight: '600' }}>
                Override Capacity
              </h2>
              <button
                onClick={() => {
                  setShowPinModal(false);
                  setPinInput('');
                  setPinError('');
                  setOverridingSlot(null);
                }}
                style={{
                  padding: TavariStyles.spacing.xs,
                  border: 'none',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  color: TavariStyles.colors.gray600,
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.xs }}>
                Time Slot: {formatTime(overridingSlot.time)} on {formatDate(overridingSlot.date)}
              </div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.md }}>
                Current Capacity: {maxCapacity} | Override to:
              </div>
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                New Capacity
              </label>
              <input
                type="number"
                min="1"
                value={overrideCapacity}
                onChange={(e) => setOverrideCapacity(parseInt(e.target.value) || 1)}
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{ display: 'block', marginBottom: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '500' }}>
                Manager PIN *
              </label>
              <input
                type="password"
                maxLength="4"
                value={pinInput}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPinInput(value);
                  setPinError('');
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && pinInput.length === 4) {
                    handlePinSubmit();
                  }
                }}
                placeholder="Enter 4-digit PIN"
                style={{
                  width: '100%',
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  border: `1px solid ${pinError ? '#dc2626' : TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  fontSize: '18px',
                  letterSpacing: '4px',
                  textAlign: 'center',
                }}
                autoFocus
              />
              {pinError && (
                <div style={{ color: '#dc2626', fontSize: TavariStyles.typography.fontSize.xs, marginTop: TavariStyles.spacing.xs }}>
                  {pinError}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: TavariStyles.spacing.md, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowPinModal(false);
                  setPinInput('');
                  setPinError('');
                  setOverridingSlot(null);
                }}
                style={{
                  padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  backgroundColor: TavariStyles.colors.white,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePinSubmit}
                disabled={pinInput.length !== 4}
                style={{
                  padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
                  border: 'none',
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  backgroundColor: TavariStyles.colors.primary || '#008080',
                  color: TavariStyles.colors.white,
                  cursor: pinInput.length !== 4 ? 'not-allowed' : 'pointer',
                  opacity: pinInput.length !== 4 ? 0.5 : 1,
                }}
              >
                Apply Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomAgentBookings;
