// src/screens/Bookings/BookingCalendarScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import bookingService from '../../services/Bookings/BookingService';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiCalendar } from 'react-icons/fi';
import toast from 'react-hot-toast';

const BookingCalendarScreen = () => {
  const navigate = useNavigate();
  const { openBookingDetail } = useBookingDetailModal();

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingCalendarScreen'
  });

  const { logSecurityEvent } = useSecurityContext({
    componentName: 'BookingCalendarScreen',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  const { hasAnyPermission, hasElevatedPrivileges } = usePermissions();
  const canViewBookings = hasAnyPermission(['bookings.view', 'bookings.calendar.view']) || hasElevatedPrivileges();

  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [bookings, setBookings] = useState([]);
  const [viewMode, setViewMode] = useState('month'); // month, week, day

  useEffect(() => {
    if (auth.selectedBusinessId && canViewBookings) {
      bookingService.setBusinessId(auth.selectedBusinessId);
      loadBookings();
    }
  }, [auth.selectedBusinessId, canViewBookings, currentDate]);

  const loadBookings = async () => {
    try {
      setLoading(true);
      const startDate = new Date(currentDate);
      startDate.setDate(1);
      const endDate = new Date(currentDate);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0);

      const data = await bookingService.getBookingsByDateRange(
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );
      setBookings(data);
    } catch (error) {
      console.error('Error loading bookings:', error);
      toast.error('Error loading bookings');
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    return days;
  };

  const getBookingsForDate = (date) => {
    if (!date) return [];
    const dateStr = date.toISOString().split('T')[0];
    return bookings.filter(b => b.booking_date === dateStr);
  };

  const navigateMonth = (direction) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  if (!canViewBookings) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You do not have permission to view the calendar.</p>
      </div>
    );
  }

  const days = getDaysInMonth();
  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="BookingCalendarScreen"
      >
        <div style={{ padding: '30px', maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '30px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => navigate('/dashboard/bookings')}
                style={{
                  marginRight: '16px',
                  padding: '8px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <FiArrowLeft size={24} />
              </button>
              <h1 style={{ fontSize: '33px', fontWeight: '600', margin: 0 }}>Booking Calendar</h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => navigateMonth(-1)}
                style={{
                  padding: '8px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <FiChevronLeft size={24} />
              </button>
              <div style={{ fontSize: '18px', fontWeight: '600', minWidth: '200px', textAlign: 'center' }}>
                {monthName}
              </div>
              <button
                onClick={() => navigateMonth(1)}
                style={{
                  padding: '8px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <FiChevronRight size={24} />
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>Loading calendar...</div>
          ) : (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              overflow: 'hidden'
            }}>
              {/* Calendar Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                borderBottom: '2px solid #e5e7eb',
                backgroundColor: '#f9fafb'
              }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} style={{
                    padding: '12px',
                    textAlign: 'center',
                    fontWeight: '600',
                    fontSize: '14px',
                    color: TavariStyles.colors.gray700
                  }}>
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)'
              }}>
                {days.map((date, index) => {
                  const dayBookings = getBookingsForDate(date);
                  const isToday = date && date.toDateString() === new Date().toDateString();
                  
                  return (
                    <div
                      key={index}
                      style={{
                        minHeight: '120px',
                        border: '1px solid #e5e7eb',
                        padding: '8px',
                        backgroundColor: date ? (isToday ? '#fef3c7' : 'white') : '#f9fafb',
                        cursor: date ? 'pointer' : 'default'
                      }}
                      onClick={() => {
                        if (date) {
                          const dateStr = date.toISOString().split('T')[0];
                          navigate(`/dashboard/bookings/list?date=${dateStr}`);
                        }
                      }}
                    >
                      {date && (
                        <>
                          <div style={{
                            fontWeight: isToday ? '700' : '600',
                            fontSize: '14px',
                            marginBottom: '4px',
                            color: isToday ? TavariStyles.colors.primary : TavariStyles.colors.gray900
                          }}>
                            {date.getDate()}
                          </div>
                          {dayBookings.slice(0, 3).map(booking => (
                            <div
                              key={booking.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                openBookingDetail(booking.id);
                              }}
                              style={{
                                fontSize: '11px',
                                padding: '4px 6px',
                                marginBottom: '4px',
                                borderRadius: '4px',
                                backgroundColor: booking.status === 'checked_in' ? '#d1fae5' : 
                                                booking.status === 'cancelled' ? '#fee2e2' : '#fef3c7',
                                color: booking.status === 'checked_in' ? '#065f46' : 
                                       booking.status === 'cancelled' ? '#991b1b' : '#92400e',
                                cursor: 'pointer',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={`${booking.booking_activities?.activity_name || 'Activity'} - ${booking.booking_time}`}
                            >
                              {booking.booking_time} - {booking.booking_activities?.activity_name || 'Activity'}
                            </div>
                          ))}
                          {dayBookings.length > 3 && (
                            <div style={{
                              fontSize: '11px',
                              color: TavariStyles.colors.gray600,
                              fontStyle: 'italic'
                            }}>
                              +{dayBookings.length - 3} more
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingCalendarScreen;












