// src/screens/Bookings/BookingCheckInScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import bookingService from '../../services/Bookings/BookingService';
import BookingCheckInButton from '../../components/Bookings/BookingCheckInButton';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiArrowLeft, FiSearch } from 'react-icons/fi';
import toast from 'react-hot-toast';

const BookingCheckInScreen = () => {
  const navigate = useNavigate();

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingCheckInScreen'
  });

  const { logSecurityEvent } = useSecurityContext({
    componentName: 'BookingCheckInScreen',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const canCheckIn = hasPermission('bookings.checkin') || hasElevatedPrivileges();

  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(null);
  const [todayBookings, setTodayBookings] = useState([]);

  useEffect(() => {
    if (auth.selectedBusinessId && canCheckIn) {
      bookingService.setBusinessId(auth.selectedBusinessId);
      loadTodayBookings();
    }
  }, [auth.selectedBusinessId, canCheckIn]);

  const loadTodayBookings = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = await bookingService.getBookings({
        startDate: today,
        endDate: today
      });
      setTodayBookings(
        (data || []).filter((row) => ['pending', 'confirmed', 'checked_in'].includes(row.status))
      );
    } catch (error) {
      console.error('Error loading today bookings:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setBooking(null);
      return;
    }

    try {
      setLoading(true);
      const bookings = await bookingService.getBookings({ search: searchQuery.trim() });
      if (bookings.length > 0) {
        // Find exact match by booking number or email
        const exactMatch = bookings.find(b => 
          b.booking_number?.toLowerCase() === searchQuery.trim().toLowerCase() ||
          b.customer_email?.toLowerCase() === searchQuery.trim().toLowerCase()
        );
        setBooking(exactMatch || bookings[0]);
      } else {
        setBooking(null);
        toast.error('No booking found');
      }
    } catch (error) {
      console.error('Error searching booking:', error);
      toast.error('Error searching for booking');
    } finally {
      setLoading(false);
    }
  };

  if (!canCheckIn) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You do not have permission to check in bookings.</p>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="BookingCheckInScreen"
      >
        <div style={{ padding: '30px', maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px' }}>
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
            <h1 style={{ fontSize: '33px', fontWeight: '600', margin: 0 }}>Check-In</h1>
          </div>

          {/* Search */}
          <div style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            marginBottom: '30px'
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
              Search Booking
            </h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input
                type="text"
                placeholder="Enter booking number, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                style={{
                  flex: 1,
                  padding: '12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px'
                }}
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                style={{
                  padding: '12px 24px',
                  backgroundColor: loading ? '#ccc' : TavariStyles.colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <FiSearch /> Search
              </button>
            </div>
          </div>

          {/* Booking Details */}
          {booking && (
            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              marginBottom: '30px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px' }}>
                    {booking.booking_activities?.activity_name || 'Activity'}
                  </h3>
                  <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px' }}>
                    {new Date(booking.booking_date).toLocaleDateString()} at {booking.booking_time}
                  </div>
                  <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px', marginTop: '4px' }}>
                    Booking #{booking.booking_number}
                  </div>
                </div>
                <div style={{
                  padding: '6px 12px',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: '600',
                  backgroundColor: booking.status === 'checked_in' ? '#d1fae5' : '#fef3c7',
                  color: booking.status === 'checked_in' ? '#065f46' : '#92400e'
                }}>
                  {booking.status}
                </div>
              </div>

              {['pending', 'confirmed', 'checked_in'].includes(booking.status) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <BookingCheckInButton
                    booking={booking}
                    canCheckIn={canCheckIn}
                    onCheckInComplete={() => {
                      loadTodayBookings();
                      bookingService
                        .getBookingByIdWithMailNames(booking.id)
                        .then(setBooking)
                        .catch(() => {});
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Today's Bookings */}
          <div style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '20px' }}>
              Today's Check-In Queue ({todayBookings.length})
            </h2>
            {todayBookings.length === 0 ? (
              <p style={{ color: TavariStyles.colors.gray600 }}>No pending or confirmed bookings for today</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {todayBookings.map(b => (
                  <div
                    key={b.id}
                    style={{
                      padding: '16px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                        {b.booking_activities?.activity_name || 'Activity'}
                      </div>
                      <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>
                        {b.booking_time} - Booking #{b.booking_number}
                      </div>
                      <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>
                        {b.customer_email || b.customer_phone}
                      </div>
                    </div>
                    <BookingCheckInButton
                      booking={b}
                      canCheckIn={canCheckIn}
                      onCheckInComplete={() => {
                        loadTodayBookings();
                        if (booking?.id === b.id) {
                          bookingService
                            .getBookingByIdWithMailNames(b.id)
                            .then(setBooking)
                            .catch(() => {});
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingCheckInScreen;












