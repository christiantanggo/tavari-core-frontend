// src/screens/Bookings/BookingListScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import bookingService from '../../services/Bookings/BookingService';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiArrowLeft, FiSearch, FiFilter, FiCalendar, FiClock } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BookingCheckInButton from '../../components/Bookings/BookingCheckInButton';
import BookingRestoreButton from '../../components/Bookings/BookingRestoreButton';
import { formatDateForBusiness } from '../../utils/businessDateFormat';
import { supabase } from '../../supabaseClient';

const BookingListScreen = () => {
  const navigate = useNavigate();
  const { openBookingDetail } = useBookingDetailModal();

  const formatStatusLabel = (value) => {
    if (!value) return 'Unknown';
    return String(value)
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingListScreen'
  });

  const { logSecurityEvent } = useSecurityContext({
    componentName: 'BookingListScreen',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  const { hasAnyPermission, hasElevatedPrivileges, hasPermission } = usePermissions();
  const canViewBookings = hasAnyPermission(['bookings.view', 'bookings.view_all']) || hasElevatedPrivileges();
  const canCheckIn = hasPermission('bookings.checkin') || hasElevatedPrivileges();
  
  // Business timezone
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');

  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState([]);
  const [filters, setFilters] = useState({
    status: '',
    paymentStatus: '',
    search: '',
    startDate: '',
    endDate: ''
  });

  useEffect(() => {
    if (auth.selectedBusinessId && canViewBookings) {
      bookingService.setBusinessId(auth.selectedBusinessId);
      loadBusinessTimezone();
      loadBookings();
    }
  }, [auth.selectedBusinessId, canViewBookings, filters]);

  // Load business timezone
  const loadBusinessTimezone = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('timezone')
        .eq('id', auth.selectedBusinessId)
        .single();
      
      if (!error && data?.timezone) {
        setBusinessTimezone(data.timezone);
      } else {
        setBusinessTimezone('America/Toronto'); // Default
      }
    } catch (error) {
      console.error('Error loading business timezone:', error);
      setBusinessTimezone('America/Toronto'); // Default
    }
  };

  const loadBookings = async () => {
    try {
      setLoading(true);
      // Build filter object, only including non-empty values
      const filterParams = {};
      if (filters.status) filterParams.status = filters.status;
      if (filters.paymentStatus) filterParams.paymentStatus = filters.paymentStatus;
      if (filters.search) filterParams.search = filters.search;
      if (filters.startDate) filterParams.startDate = filters.startDate;
      if (filters.endDate) filterParams.endDate = filters.endDate;
      
      const data = await bookingService.getBookings(filterParams);
      setBookings(data);
    } catch (error) {
      console.error('Error loading bookings:', error);
      toast.error('Error loading bookings');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckInComplete = () => {
    loadBookings(); // Refresh the list after check-in
  };

  if (!canViewBookings) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You do not have permission to view bookings.</p>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="BookingListScreen"
      >
        <div
          style={{
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            padding: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
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
            <h1 style={{ fontSize: '33px', fontWeight: '600', margin: 0 }}>All Bookings</h1>
          </div>

          {/* Filters */}
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            marginBottom: '20px',
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap'
          }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <input
                type="text"
                placeholder="Search by name, email, phone, or booking number..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '14px'
                }}
              />
            </div>
            <input
              type="date"
              placeholder="Start Date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              style={{
                padding: '10px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            />
            <input
              type="date"
              placeholder="End Date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              style={{
                padding: '10px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            />
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              style={{
                padding: '10px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="checked_in">Checked In</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
              <option value="no_show">No Show</option>
            </select>
            <select
              value={filters.paymentStatus}
              onChange={(e) => setFilters({ ...filters, paymentStatus: e.target.value })}
              style={{
                padding: '10px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            >
              <option value="">All Payment Statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>

          {/* Bookings List */}
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>
          ) : bookings.length === 0 ? (
            <div style={{
              backgroundColor: 'white',
              padding: '40px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              textAlign: 'center'
            }}>
              <p style={{ color: TavariStyles.colors.gray600 }}>No bookings found</p>
            </div>
          ) : (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              overflow: 'hidden'
            }}>
              {bookings.map(booking => (
                <div
                  key={booking.id}
                  style={{
                    padding: '20px',
                    borderBottom: '1px solid #e5e7eb',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'white'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div 
                      style={{ flex: 1, cursor: 'pointer' }}
                      onClick={() => openBookingDetail(booking.id, { onUpdated: loadBookings })}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ fontWeight: '600', fontSize: '18px' }}>
                          {booking.booking_activities?.activity_name || 'Activity'}
                        </div>
                        <div style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          fontWeight: '600',
                          backgroundColor: booking.status === 'checked_in' ? '#d1fae5' : 
                                          booking.status === 'cancelled' ? '#fee2e2' : '#fef3c7',
                          color: booking.status === 'checked_in' ? '#065f46' : 
                                 booking.status === 'cancelled' ? '#991b1b' : '#92400e'
                        }}>
                          {formatStatusLabel(booking.status)}
                        </div>
                        <div style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          fontWeight: '600',
                          backgroundColor: booking.payment_status === 'paid' ? '#dbeafe' : '#fee2e2',
                          color: booking.payment_status === 'paid' ? '#1e40af' : '#991b1b'
                        }}>
                          {formatStatusLabel(booking.payment_status)}
                        </div>
                      </div>
                      <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px', marginBottom: '4px' }}>
                        <FiCalendar style={{ display: 'inline', marginRight: '4px' }} />
                        {formatDateForBusiness(booking.booking_date, businessTimezone)} at {booking.booking_time}
                      </div>
                      <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px' }}>
                        {booking.customer_email || booking.customer_phone || 'No contact info'}
                      </div>
                      {booking.booking_number && (
                        <div style={{ color: TavariStyles.colors.gray500, fontSize: '13px', marginTop: '4px' }}>
                          Booking #{booking.booking_number}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: '16px' }}>
                      {booking.status === 'cancelled' ? (
                        <BookingRestoreButton
                          booking={booking}
                          businessId={auth.selectedBusinessId}
                          onRestored={loadBookings}
                          compact
                        />
                      ) : null}
                      {booking.booking_payments && booking.booking_payments.length > 0 && (
                        <div style={{ fontWeight: '600', fontSize: '16px', color: TavariStyles.colors.primary, textAlign: 'right' }}>
                          ${booking.booking_payments.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0).toFixed(2)}
                        </div>
                      )}
                      <BookingCheckInButton
                        booking={booking}
                        onCheckInComplete={handleCheckInComplete}
                        canCheckIn={canCheckIn}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingListScreen;












