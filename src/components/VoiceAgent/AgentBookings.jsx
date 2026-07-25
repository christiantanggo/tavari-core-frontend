// components/VoiceAgent/AgentBookings.jsx
// Bookings/Reservations with Calendar View and Manual Booking Creation
import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Phone, Mail, Users, Clock, X, CheckCircle, AlertCircle, Plus, List, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

// Helper functions (defined outside component to avoid initialization issues)
const formatTime = (timeStr) => {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  // Handle date strings directly without timezone conversion
  // If it's already in YYYY-MM-DD format, parse it directly
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
  // Fallback for other date formats
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

const AgentBookings = ({ businessId, voiceAgentService }) => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('calendar'); // 'list' or 'calendar'
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filter, setFilter] = useState('all');
  const [showBookingModal, setShowBookingModal] = useState(false);
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
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [savingBooking, setSavingBooking] = useState(false);

  useEffect(() => {
    loadAgents();
    loadBookings();
  }, [businessId, filter, selectedDate, viewMode]);

  const loadAgents = async () => {
    try {
      const agentsData = await voiceAgentService.getAgents();
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
      // Load a wider date range to ensure all bookings are available for display
      // This prevents timezone issues from hiding bookings
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(today.getDate() - 7); // Load 7 days in past
      const endDate = new Date(today);
      endDate.setDate(today.getDate() + 60); // Load 60 days in future
      
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log('📅 Loading bookings for date range:', { 
        startDate: startDateStr, 
        endDate: endDateStr, 
        selectedDate, 
        viewMode 
      });

      const bookingsData = await voiceAgentService.getBookings(null, {
        status: filter !== 'all' ? filter : undefined,
        start_date: startDateStr,
        end_date: endDateStr,
        limit: 200,
      });
      console.log('✅ Bookings loaded:', bookingsData?.length || 0, bookingsData);
      console.log('📋 Booking dates:', bookingsData?.map(b => ({
        name: b.customer_name,
        date: b.booking_date,
        time: b.booking_time
      })));
      setBookings(bookingsData || []);
    } catch (error) {
      console.error('❌ Error loading bookings:', error);
      console.error('Error details:', error.message, error.code, error.details);
      toast.error(`Failed to load bookings: ${error.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const updateBookingStatus = async (bookingId, newStatus) => {
    try {
      await voiceAgentService.updateBookingStatus(bookingId, newStatus);
      await loadBookings();
      toast.success('Booking status updated');
    } catch (error) {
      console.error('Error updating booking:', error);
      toast.error('Failed to update booking');
    }
  };

  const handleCreateBooking = async () => {
    if (!selectedAgentId) {
      toast.error('Please select an agent first');
      return;
    }

    if (!bookingFormData.customer_name || !bookingFormData.customer_phone || !bookingFormData.booking_date || !bookingFormData.booking_time) {
      toast.error('Please fill in all required fields (Name, Phone, Date, Time)');
      return;
    }

    try {
      setSavingBooking(true);
      console.log('📝 Creating booking:', { agentId: selectedAgentId, bookingData: bookingFormData });
      const createdBooking = await voiceAgentService.createBooking(selectedAgentId, bookingFormData);
      console.log('✅ Booking created:', createdBooking);
      toast.success('Booking created successfully!');
      setShowBookingModal(false);
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
      // Reload bookings immediately (no delay needed)
      await loadBookings();
    } catch (error) {
      console.error('❌ Error creating booking:', error);
      console.error('Error details:', error.message, error.code, error.details, error.hint);
      toast.error(`Failed to create booking: ${error.message || 'Unknown error'}. ${error.hint ? `Hint: ${error.hint}` : ''}`);
    } finally {
      setSavingBooking(false);
    }
  };

  const openBookingModal = (date = null, time = null) => {
    setBookingFormData({
      ...bookingFormData,
      booking_date: date || selectedDate,
      booking_time: time || '',
    });
    setShowBookingModal(true);
  };

  // Use pre-generated time slots (defined outside component)
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  // Timezone-safe date normalization - extracts YYYY-MM-DD without timezone conversion
  const normalizeDateString = (dateValue) => {
    if (!dateValue) return null;
    // If it's already a string in YYYY-MM-DD format, return as-is (most common case)
    if (typeof dateValue === 'string') {
      // Extract just the date part (YYYY-MM-DD) if it includes time
      const dateMatch = dateValue.match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        return dateMatch[1]; // Return just YYYY-MM-DD
      }
    }
    // If it's a Date object, use local date components (no timezone conversion)
    const dateObj = new Date(dateValue);
    if (isNaN(dateObj.getTime())) return null;
    // Use local date components to avoid timezone conversion issues
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Get bookings for selected date
  const getBookingsForDate = (date) => {
    const normalizedDate = normalizeDateString(date);
    const matchingBookings = bookings.filter(booking => {
      const bookingDate = normalizeDateString(booking.booking_date);
      const matches = bookingDate === normalizedDate;
      if (matches) {
        console.log('✅ Date match:', {
          selectedDate: normalizedDate,
          bookingDate: bookingDate,
          rawBookingDate: booking.booking_date,
          customer: booking.customer_name
        });
      }
      return matches;
    });
    console.log('🔍 getBookingsForDate:', { 
      date, 
      normalizedDate, 
      totalBookings: bookings.length, 
      matchingBookings: matchingBookings.length,
      bookingDates: bookings.map(b => ({ 
        name: b.customer_name, 
        rawDate: b.booking_date, 
        normalized: normalizeDateString(b.booking_date),
        matches: normalizeDateString(b.booking_date) === normalizedDate,
        time: b.booking_time 
      }))
    });
    return matchingBookings;
  };

  // Normalize time format for comparison (handles both "HH:MM" and "HH:MM:SS")
  const normalizeTime = (timeStr) => {
    if (!timeStr) return '';
    // Remove seconds if present: "14:30:00" -> "14:30"
    return timeStr.substring(0, 5);
  };

  // Get booking for a specific time slot
  const getBookingForTime = (date, time) => {
    const normalizedDate = normalizeDateString(date);
    
    const booking = bookings.find(booking => {
      const bookingDate = normalizeDateString(booking.booking_date);
      
      // Normalize both times for comparison (handles "14:30:00" vs "14:30")
      const normalizedBookingTime = normalizeTime(booking.booking_time);
      const normalizedSlotTime = normalizeTime(time);
      
      const matches = bookingDate === normalizedDate && 
        normalizedBookingTime === normalizedSlotTime &&
        booking.status !== 'cancelled';
      
      if (matches) {
        console.log('✅ Time slot match found:', {
          bookingDate,
          normalizedDate,
          bookingTime: booking.booking_time,
          normalizedBookingTime,
          slotTime: time,
          normalizedSlotTime,
          customer: booking.customer_name
        });
      }
      
      return matches;
    });
    
    return booking;
  };

  const changeDate = (days) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    setSelectedDate(newDate.toISOString().split('T')[0]);
  };

  const goToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading bookings...</div>
      </div>
    );
  }

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl,
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md,
    },
    viewToggle: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: '2px',
    },
    viewToggleButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: 'transparent',
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    viewToggleButtonActive: {
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
    },
    dateNavigator: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
    },
    dateButton: {
      padding: '6px 12px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
    },
    calendarGrid: {
      display: 'grid',
      gridTemplateColumns: '120px 1fr auto',
      gap: '1px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      overflow: 'hidden',
    },
    timeSlot: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.white,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      minHeight: '60px',
      display: 'flex',
      alignItems: 'center',
    },
    bookingSlot: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50,
      minHeight: '60px',
      display: 'flex',
      alignItems: 'center',
      position: 'relative',
    },
    addButtonColumn: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.white,
      minHeight: '60px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButton: {
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary || '#008080',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '18px',
      fontWeight: 'bold',
    },
    bookingBlock: {
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      padding: '8px 12px',
      borderRadius: TavariStyles.borderRadius?.sm || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      width: '100%',
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
      zIndex: 1000,
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '90%',
      maxWidth: '500px',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    },
    modalHeader: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalContent: {
      padding: TavariStyles.spacing.xl,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.md,
    },
    label: {
      display: 'block',
      marginBottom: '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    select: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    modalFooter: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
    },
    button: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
    },
    buttonPrimary: {
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
    },
    buttonSecondary: {
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700,
    },
  };

  // Calendar View
  const renderCalendarView = () => {
    const dayBookings = getBookingsForDate(selectedDate);
    console.log('📅 Calendar view for date:', selectedDate, 'Bookings for this date:', dayBookings);
    console.log('📅 All bookings loaded:', bookings.length, bookings.map(b => ({ 
      name: b.customer_name, 
      date: b.booking_date, 
      time: b.booking_time, 
      type: b.booking_type,
      status: b.status 
    })));

    return (
      <div>
        <div style={styles.calendarGrid}>
          {/* Header */}
          <div style={{ ...styles.timeSlot, backgroundColor: TavariStyles.colors.gray100, fontWeight: 'bold' }}>Time</div>
          <div style={{ ...styles.bookingSlot, backgroundColor: TavariStyles.colors.gray100, fontWeight: 'bold', justifyContent: 'center' }}>
            Bookings for {formatDate(selectedDate)}
          </div>
          <div style={{ ...styles.addButtonColumn, backgroundColor: TavariStyles.colors.gray100, fontWeight: 'bold' }}>Add</div>

          {/* Time slots */}
          {timeSlots.map((slot) => {
            const booking = getBookingForTime(selectedDate, slot.time);
            return (
              <React.Fragment key={slot.time}>
                <div style={styles.timeSlot}>{slot.displayTime}</div>
                <div style={styles.bookingSlot}>
                  {booking ? (
                    <div style={styles.bookingBlock} title={`${booking.customer_name} - ${booking.customer_phone}`}>
                      {booking.customer_name} - {formatTime(booking.booking_time)}
                    </div>
                  ) : (
                    <div style={{ color: TavariStyles.colors.gray400, fontSize: TavariStyles.typography.fontSize.sm }}>Available</div>
                  )}
                </div>
                <div style={styles.addButtonColumn}>
                  <button
                    style={styles.addButton}
                    onClick={() => openBookingModal(selectedDate, slot.time)}
                    title="Add booking"
                  >
                    +
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  // Check if a booking is upcoming (not in the past)
  const isBookingUpcoming = (booking) => {
    if (!booking.booking_date || !booking.booking_time) return false;
    
    // Normalize the booking date and time
    const normalizedDate = normalizeDateString(booking.booking_date);
    const normalizedTime = normalizeTime(booking.booking_time);
    
    if (!normalizedDate || !normalizedTime) return false;
    
    // Create a date string in ISO format for comparison
    const bookingDateTime = `${normalizedDate}T${normalizedTime}:00`;
    const bookingDate = new Date(bookingDateTime);
    const now = new Date();
    
    // Return true if booking date/time is in the future
    return bookingDate >= now;
  };

  // List View (existing)
  const renderListView = () => {
    // First filter by status
    let filteredBookings = filter !== 'all' 
      ? bookings.filter(b => b.status === filter)
      : bookings;
    
    // Then filter out past bookings - only show upcoming
    filteredBookings = filteredBookings.filter(isBookingUpcoming);
    
    // Sort by date and time (earliest first)
    filteredBookings.sort((a, b) => {
      const dateA = normalizeDateString(a.booking_date);
      const timeA = normalizeTime(a.booking_time);
      const dateB = normalizeDateString(b.booking_date);
      const timeB = normalizeTime(b.booking_time);
      
      const dateTimeA = dateA && timeA ? `${dateA}T${timeA}:00` : '';
      const dateTimeB = dateB && timeB ? `${dateB}T${timeB}:00` : '';
      
      if (!dateTimeA && !dateTimeB) return 0;
      if (!dateTimeA) return 1;
      if (!dateTimeB) return -1;
      
      return new Date(dateTimeA) - new Date(dateTimeB);
    });

    return (
      <div>
        {filteredBookings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray600 }}>
            <Calendar size={48} style={{ marginBottom: '16px', opacity: 0.5, margin: '0 auto 16px' }} />
            <div>No bookings found</div>
          </div>
        ) : (
          filteredBookings.map(booking => (
            <div key={booking.id} style={{
              padding: TavariStyles.spacing.lg,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: TavariStyles.borderRadius?.md || '8px',
              marginBottom: TavariStyles.spacing.md,
              backgroundColor: TavariStyles.colors.white,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: TavariStyles.spacing.md }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.semibold, marginBottom: '4px' }}>
                    {booking.customer_name}
                  </div>
                  <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
                    <div>{booking.customer_phone}</div>
                    {booking.customer_email && <div>{booking.customer_email}</div>}
                    <div style={{ marginTop: '4px' }}>
                      <strong>{formatDate(booking.booking_date)}</strong> at <strong>{formatTime(booking.booking_time)}</strong>
                    </div>
                    {booking.confirmation_code && (
                      <div style={{ marginTop: '4px', color: TavariStyles.colors.primary }}>
                        Confirmation: {booking.confirmation_code}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{
                  padding: '4px 12px',
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: '600',
                  textTransform: 'capitalize',
                  backgroundColor: booking.status === 'confirmed' ? '#d1fae5' : booking.status === 'pending' ? '#dbeafe' : '#fee2e2',
                  color: booking.status === 'confirmed' ? '#065f46' : booking.status === 'pending' ? '#1e40af' : '#991b1b',
                }}>
                  {booking.status || 'pending'}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header with View Toggle and Date Navigation */}
      <div style={styles.header}>
        <div style={styles.viewToggle}>
          <button
            style={{
              ...styles.viewToggleButton,
              ...(viewMode === 'calendar' ? styles.viewToggleButtonActive : {}),
            }}
            onClick={() => setViewMode('calendar')}
          >
            <CalendarDays size={18} />
            Calendar
          </button>
          <button
            style={{
              ...styles.viewToggleButton,
              ...(viewMode === 'list' ? styles.viewToggleButtonActive : {}),
            }}
            onClick={() => setViewMode('list')}
          >
            <List size={18} />
            List
          </button>
        </div>

        {viewMode === 'calendar' && (
          <div style={styles.dateNavigator}>
            <button style={styles.dateButton} onClick={() => changeDate(-1)}>
              <ChevronLeft size={20} />
            </button>
            <div style={{ minWidth: '200px', textAlign: 'center', fontWeight: '600' }}>
              {formatDate(selectedDate)}
            </div>
            <button style={styles.dateButton} onClick={() => changeDate(1)}>
              <ChevronRight size={20} />
            </button>
            <button
              style={{ ...styles.dateButton, marginLeft: TavariStyles.spacing.md }}
              onClick={goToToday}
            >
              Today
            </button>
          </div>
        )}

        {viewMode === 'list' && (
          <div style={{ display: 'flex', gap: TavariStyles.spacing.sm }}>
            <button
              onClick={() => setFilter('all')}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                backgroundColor: filter === 'all' ? TavariStyles.colors.primary : TavariStyles.colors.white,
                color: filter === 'all' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
                cursor: 'pointer',
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
                backgroundColor: filter === 'confirmed' ? TavariStyles.colors.primary : TavariStyles.colors.white,
                color: filter === 'confirmed' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
                cursor: 'pointer',
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
                backgroundColor: filter === 'pending' ? TavariStyles.colors.primary : TavariStyles.colors.white,
                color: filter === 'pending' ? TavariStyles.colors.white : TavariStyles.colors.gray700,
                cursor: 'pointer',
              }}
            >
              Pending
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {viewMode === 'calendar' ? renderCalendarView() : renderListView()}

      {/* Manual Booking Modal */}
      {showBookingModal && (
        <div style={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && setShowBookingModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.xl, fontWeight: 'bold' }}>Add Booking</h2>
              <button
                onClick={() => setShowBookingModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
              >
                <X size={24} />
              </button>
            </div>
            <div style={styles.modalContent}>
              {agents.length > 0 && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>Agent *</label>
                  <select
                    style={styles.select}
                    value={selectedAgentId || ''}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                  >
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={styles.formGroup}>
                <label style={styles.label}>Customer Name *</label>
                <input
                  type="text"
                  style={styles.input}
                  value={bookingFormData.customer_name}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, customer_name: e.target.value })}
                  placeholder="John Smith"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Phone Number *</label>
                <input
                  type="tel"
                  style={styles.input}
                  value={bookingFormData.customer_phone}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, customer_phone: e.target.value })}
                  placeholder="555-123-4567"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Email (Optional)</label>
                <input
                  type="email"
                  style={styles.input}
                  value={bookingFormData.customer_email}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, customer_email: e.target.value })}
                  placeholder="customer@example.com"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Booking Type *</label>
                <select
                  style={styles.select}
                  value={bookingFormData.booking_type}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, booking_type: e.target.value })}
                >
                  <option value="appointment">Appointment</option>
                  <option value="reservation">Reservation</option>
                  <option value="callback">Callback</option>
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Service Type</label>
                <input
                  type="text"
                  style={styles.input}
                  value={bookingFormData.service_type}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, service_type: e.target.value })}
                  placeholder="e.g., Birthday Party, Open Play"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Date *</label>
                  <input
                    type="date"
                    style={styles.input}
                    value={bookingFormData.booking_date}
                    onChange={(e) => setBookingFormData({ ...bookingFormData, booking_date: e.target.value })}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Time *</label>
                  <input
                    type="time"
                    style={styles.input}
                    value={bookingFormData.booking_time}
                    onChange={(e) => setBookingFormData({ ...bookingFormData, booking_time: e.target.value })}
                  />
                </div>
              </div>
              {bookingFormData.booking_type === 'reservation' && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>Party Size</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={bookingFormData.party_size}
                    onChange={(e) => setBookingFormData({ ...bookingFormData, party_size: parseInt(e.target.value) || 1 })}
                    min="1"
                  />
                </div>
              )}
              <div style={styles.formGroup}>
                <label style={styles.label}>Duration (minutes)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={bookingFormData.duration_minutes}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, duration_minutes: parseInt(e.target.value) || 30 })}
                  min="15"
                  step="15"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Notes</label>
                <textarea
                  style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
                  value={bookingFormData.notes}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, notes: e.target.value })}
                  placeholder="Special requests or notes..."
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Status</label>
                <select
                  style={styles.select}
                  value={bookingFormData.status}
                  onChange={(e) => setBookingFormData({ ...bookingFormData, status: e.target.value })}
                >
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button
                style={{ ...styles.button, ...styles.buttonSecondary }}
                onClick={() => setShowBookingModal(false)}
              >
                Cancel
              </button>
              <button
                style={{ ...styles.button, ...styles.buttonPrimary }}
                onClick={handleCreateBooking}
                disabled={savingBooking}
              >
                {savingBooking ? 'Creating...' : 'Create Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentBookings;
