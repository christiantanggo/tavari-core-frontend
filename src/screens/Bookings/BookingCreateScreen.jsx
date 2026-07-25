// src/screens/Bookings/BookingCreateScreen.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import bookingService from '../../services/Bookings/BookingService';
import bookingActivityService from '../../services/Bookings/BookingActivityService';
import bookingTypeService from '../../services/Bookings/BookingTypeService';
import bookingAddonService from '../../services/Bookings/BookingAddonService';
import bookingWaiverIntegration from '../../services/Bookings/BookingWaiverIntegration';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiArrowLeft, FiSave, FiUser, FiCalendar, FiClock, FiDollarSign } from 'react-icons/fi';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../../supabaseClient';
import {
  getActivityTicketLimits,
  validateParticipantCountAgainstTicketLimits,
} from '../../utils/bookingTicketAssignment';
import StaffBookingTicketLimitsPanel from '../../components/Bookings/StaffBookingTicketLimitsPanel';
import SecurityUtils from '../../Security/SecurityUtils';
import {
  checkBookingBusinessHours,
  approveBusinessHoursOverride,
} from '../../helpers/Bookings/businessHoursOverrideFlow';
import BookingBusinessHoursOverrideModal from '../../components/Bookings/BookingBusinessHoursOverrideModal';

dayjs.extend(utc);
dayjs.extend(timezone);

const BookingCreateScreen = () => {
  const navigate = useNavigate();
  const { openBookingDetail } = useBookingDetailModal();
  const location = useLocation();
  const prefillBooking = location.state?.prefillBooking || null;
  const isPrefilledFromSchedule = !!prefillBooking?.activityId;

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingCreateScreen'
  });

  useSecurityContext({
    componentName: 'BookingCreateScreen',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  const {
    hasPermission,
    hasElevatedPrivileges,
    isOwner,
    isManager,
    isLoggedInUserManager,
    hasLoggedInUserElevatedPrivileges,
  } = usePermissions();
  const canCreateBookings = hasPermission('bookings.create') || hasElevatedPrivileges();
  const canOverrideTicketLimits =
    isOwner() ||
    isManager() ||
    hasElevatedPrivileges() ||
    isLoggedInUserManager() ||
    hasLoggedInUserElevatedPrivileges();
  
  // Business timezone
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(prefillBooking?.activityId ? 2 : 1);
  const [activities, setActivities] = useState([]);
  const [bookingTypes, setBookingTypes] = useState([]);
  const [addons, setAddons] = useState([]);

  // Form state
  const [formData, setFormData] = useState({
    activityId: '',
    bookingTypeId: '',
    customerEmail: '',
    customerPhone: '',
    customerId: null,
    bookingDate: '',
    bookingTime: '',
    participants: [],
    addons: [],
    notes: ''
  });
  const [staffTicketLimitOverride, setStaffTicketLimitOverride] = useState(false);
  const [hoursOverrideModal, setHoursOverrideModal] = useState({ open: false, reason: '' });

  useEffect(() => {
    if (auth.selectedBusinessId && canCreateBookings) {
      bookingService.setBusinessId(auth.selectedBusinessId);
      bookingActivityService.setBusinessId(auth.selectedBusinessId);
      loadBusinessTimezone();
      bookingTypeService.setBusinessId(auth.selectedBusinessId);
      bookingAddonService.setBusinessId(auth.selectedBusinessId);
      bookingWaiverIntegration.setBusinessId(auth.selectedBusinessId);
      loadInitialData();
    }
  }, [auth.selectedBusinessId, canCreateBookings]);

  useEffect(() => {
    if (!prefillBooking) return;

    setFormData((prev) => ({
      ...prev,
      activityId: prefillBooking.activityId || prev.activityId,
      bookingDate: prefillBooking.bookingDate || prev.bookingDate,
      bookingTime: prefillBooking.bookingTime || prev.bookingTime
    }));
  }, [prefillBooking]);

  useEffect(() => {
    if (prefillBooking?.activityId) {
      setStep(2);
    }
  }, [prefillBooking?.activityId]);

  useEffect(() => {
    if (!prefillBooking?.activityId || !auth.selectedBusinessId) return;

    const loadPrefillAddons = async () => {
      try {
        const activityAddons = await bookingAddonService.getAddonsForActivity(prefillBooking.activityId);
        setAddons(activityAddons);
      } catch (error) {
        console.error('Error loading prefilled activity addons:', error);
      }
    };

    loadPrefillAddons();
  }, [prefillBooking?.activityId, auth.selectedBusinessId]);

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

  const loadInitialData = async () => {
    try {
      const [activitiesData, typesData] = await Promise.all([
        bookingActivityService.getActivities({ activeOnly: true }),
        bookingTypeService.getBookingTypes(true)
      ]);
      setActivities(activitiesData);
      setBookingTypes(typesData);
    } catch (error) {
      console.error('Error loading initial data:', error);
      toast.error('Error loading activities and types');
    }
  };

  const handleActivityChange = async (activityId) => {
    setFormData({ ...formData, activityId, addons: [] });
    if (activityId) {
      try {
        const activityAddons = await bookingAddonService.getAddonsForActivity(activityId);
        setAddons(activityAddons);
      } catch (error) {
        console.error('Error loading addons:', error);
      }
    }
  };

  const selectedActivity = activities.find((activity) => activity.id === formData.activityId);

  const staffTicketLimits = useMemo(
    () => getActivityTicketLimits(selectedActivity?.ticket_settings, 'staff'),
    [selectedActivity?.ticket_settings]
  );

  useEffect(() => {
    setStaffTicketLimitOverride(false);
  }, [formData.activityId]);

  const handleAddParticipant = () => {
    const nextCount = formData.participants.length + 1;
    const check = validateParticipantCountAgainstTicketLimits(
      nextCount,
      staffTicketLimits,
      { override: staffTicketLimitOverride && canOverrideTicketLimits }
    );
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    setFormData({
      ...formData,
      participants: [{
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        phoneNumber: '',
        email: '',
        isMinor: false
      }, ...formData.participants]
    });
  };

  const submitCreateBooking = async (businessHoursOverrideApprovedBy = null) => {
    const waiverCheck = await bookingWaiverIntegration.checkWaiverRequirement(
      formData.activityId,
      formData.bookingTypeId,
    );

    const createdIp = await SecurityUtils.getClientIP().catch(() => null);
    const booking = await bookingService.createBooking({
      activityId: formData.activityId,
      bookingTypeId: formData.bookingTypeId || null,
      customerId: formData.customerId,
      customerEmail: formData.customerEmail,
      customerPhone: formData.customerPhone,
      bookingDate: formData.bookingDate,
      bookingTime: formData.bookingTime,
      participants: formData.participants,
      addons: formData.addons,
      notes: formData.notes,
      requiresWaiver: waiverCheck.requiresWaiver,
      createdBy: auth.authUser?.id,
      createdIp,
      ticketLimitOverride: staffTicketLimitOverride && canOverrideTicketLimits,
      businessHoursOverrideApprovedBy,
    });

    toast.success(
      waiverCheck.requiresWaiver
        ? 'Booking created. Participants are marked as needing waivers.'
        : 'Booking created successfully!',
    );
    navigate('/dashboard/bookings');
    openBookingDetail(booking.id);
  };

  const handleHoursOverrideApproved = async (pin) => {
    const { approvedBy } = await approveBusinessHoursOverride(auth.selectedBusinessId, pin);
    setHoursOverrideModal({ open: false, reason: '' });
    try {
      setLoading(true);
      await submitCreateBooking(approvedBy);
    } catch (error) {
      console.error('Error creating booking:', error);
      toast.error('Error creating booking: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.activityId || !formData.bookingDate || !formData.bookingTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    const participantCount = formData.participants.length > 0 ? formData.participants.length : 1;
    const limitCheck = validateParticipantCountAgainstTicketLimits(
      participantCount,
      staffTicketLimits,
      { override: staffTicketLimitOverride && canOverrideTicketLimits }
    );
    if (!limitCheck.ok) {
      toast.error(limitCheck.message);
      return;
    }

    const selectedActivity = activities.find((activity) => activity.id === formData.activityId);
    const hoursCheck = checkBookingBusinessHours({
      bookingDate: formData.bookingDate,
      bookingTime: formData.bookingTime,
      durationMinutes: selectedActivity?.duration_minutes || 60,
      operatingHours: auth.businessData?.operating_hours,
      holidayHours: auth.businessData?.holiday_hours,
    });
    if (!hoursCheck.ok && hoursCheck.requiresOverride) {
      setHoursOverrideModal({ open: true, reason: hoursCheck.message });
      return;
    }
    if (!hoursCheck.ok) {
      toast.error(hoursCheck.message);
      return;
    }

    try {
      setLoading(true);
      await submitCreateBooking();
    } catch (error) {
      console.error('Error creating booking:', error);
      toast.error('Error creating booking: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  if (!canCreateBookings) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You do not have permission to create bookings.</p>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="BookingCreateScreen"
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
            <h1 style={{ fontSize: '33px', fontWeight: '600', margin: 0 }}>Create New Booking</h1>
          </div>

          {/* Step 1: Activity & Type Selection */}
          {step === 1 && !isPrefilledFromSchedule && (
            <div style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>Select Activity</h2>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                  Activity *
                </label>
                <select
                  value={formData.activityId}
                  onChange={(e) => handleActivityChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px'
                  }}
                >
                  <option value="">Select an activity...</option>
                  {activities.map(activity => (
                    <option key={activity.id} value={activity.id}>
                      {activity.activity_name} ({activity.duration_minutes} min)
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                  Booking Type
                </label>
                <select
                  value={formData.bookingTypeId}
                  onChange={(e) => setFormData({ ...formData, bookingTypeId: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px'
                  }}
                >
                  <option value="">Select a type...</option>
                  {bookingTypes.filter(t => t.is_active).map(type => (
                    <option key={type.id} value={type.id}>
                      {type.display_name || type.type_name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!formData.activityId}
                style={{
                  padding: '12px 24px',
                  backgroundColor: formData.activityId ? TavariStyles.colors.primary : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: formData.activityId ? 'pointer' : 'not-allowed'
                }}
              >
                Next: Customer Details
              </button>
            </div>
          )}

          {/* Step 2: Customer & Date/Time */}
          {step === 2 && (
            <div style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>Customer & Schedule</h2>

              {prefillBooking?.activityId && selectedActivity && (
                <div style={{
                  marginBottom: '20px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#f0fdf4',
                  border: `1px solid ${TavariStyles.colors.primary}33`,
                  color: TavariStyles.colors.gray900,
                  fontSize: '14px'
                }}>
                  <strong>Activity:</strong> {selectedActivity.activity_name}
                </div>
              )}
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                  Customer Email *
                </label>
                <input
                  type="email"
                  value={formData.customerEmail}
                  onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px'
                  }}
                  placeholder="customer@example.com"
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                  Customer Phone
                </label>
                <input
                  type="tel"
                  value={formData.customerPhone}
                  onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px'
                  }}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                    Booking Date *
                  </label>
                  <input
                    type="date"
                    value={formData.bookingDate}
                    onChange={(e) => setFormData({ ...formData, bookingDate: e.target.value })}
                    min={dayjs().tz(businessTimezone).format('YYYY-MM-DD')}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '16px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                    Booking Time *
                  </label>
                  <input
                    type="time"
                    value={formData.bookingTime}
                    onChange={(e) => setFormData({ ...formData, bookingTime: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '16px'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => {
                    if (isPrefilledFromSchedule) {
                      navigate('/dashboard/bookings');
                      return;
                    }
                    setStep(1);
                  }}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: TavariStyles.colors.gray700,
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!formData.customerEmail || !formData.bookingDate || !formData.bookingTime}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: (formData.customerEmail && formData.bookingDate && formData.bookingTime) ? TavariStyles.colors.primary : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: (formData.customerEmail && formData.bookingDate && formData.bookingTime) ? 'pointer' : 'not-allowed'
                  }}
                >
                  Next: Participants
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Participants */}
          {step === 3 && (
            <div style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>Participants</h2>

              {staffTicketLimits.enforced && (
                <StaffBookingTicketLimitsPanel
                  limits={staffTicketLimits}
                  participantCount={formData.participants.length || 1}
                  overrideActive={staffTicketLimitOverride}
                  onOverrideChange={setStaffTicketLimitOverride}
                  canOverride={canOverrideTicketLimits}
                  style={{ marginBottom: '20px' }}
                />
              )}
              
              <div style={{ marginBottom: '20px' }}>
                <button
                  onClick={handleAddParticipant}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: TavariStyles.colors.primary,
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  + Add Participant
                </button>
              </div>

              {formData.participants.map((participant, index) => (
                <div key={index} style={{
                  padding: '16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  marginBottom: '12px'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <input
                      type="text"
                      placeholder="First Name *"
                      value={participant.firstName}
                      onChange={(e) => {
                        const updated = [...formData.participants];
                        updated[index].firstName = e.target.value;
                        setFormData({ ...formData, participants: updated });
                      }}
                      style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                    />
                    <input
                      type="text"
                      placeholder="Last Name *"
                      value={participant.lastName}
                      onChange={(e) => {
                        const updated = [...formData.participants];
                        updated[index].lastName = e.target.value;
                        setFormData({ ...formData, participants: updated });
                      }}
                      style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <input
                      type="date"
                      placeholder="Date of Birth"
                      value={participant.dateOfBirth}
                      onChange={(e) => {
                        const updated = [...formData.participants];
                        updated[index].dateOfBirth = e.target.value;
                        setFormData({ ...formData, participants: updated });
                      }}
                      style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                    />
                    <input
                      type="tel"
                      placeholder="Phone"
                      value={participant.phoneNumber}
                      onChange={(e) => {
                        const updated = [...formData.participants];
                        updated[index].phoneNumber = e.target.value;
                        setFormData({ ...formData, participants: updated });
                      }}
                      style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={participant.isMinor}
                        onChange={(e) => {
                          const updated = [...formData.participants];
                          updated[index].isMinor = e.target.checked;
                          setFormData({ ...formData, participants: updated });
                        }}
                      />
                      <span>Minor</span>
                    </label>
                  </div>
                  <button
                    onClick={() => {
                      const updated = formData.participants.filter((_, i) => i !== index);
                      setFormData({ ...formData, participants: updated });
                    }}
                    style={{
                      padding: '4px 12px',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                <button
                  onClick={() => setStep(2)}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: TavariStyles.colors.gray700,
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: TavariStyles.colors.primary,
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Next: Add-ons & Notes
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Add-ons & Notes */}
          {step === 4 && (
            <div style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>Add-ons & Notes</h2>
              
              {addons.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '12px', fontWeight: '600' }}>
                    Add-ons
                  </label>
                  {addons.map(addon => {
                    const selected = formData.addons.find(a => a.addonId === addon.id);
                    return (
                      <div key={addon.id} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontWeight: '600' }}>{addon.addon_name}</div>
                          <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>
                            ${parseFloat(addon.price).toFixed(2)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <input
                            type="number"
                            min="0"
                            value={selected?.quantity || 0}
                            onChange={(e) => {
                              const quantity = parseInt(e.target.value) || 0;
                              if (quantity > 0) {
                                const updated = formData.addons.filter(a => a.addonId !== addon.id);
                                updated.push({ addonId: addon.id, quantity, unitPrice: addon.price });
                                setFormData({ ...formData, addons: updated });
                              } else {
                                setFormData({
                                  ...formData,
                                  addons: formData.addons.filter(a => a.addonId !== addon.id)
                                });
                              }
                            }}
                            style={{
                              width: '60px',
                              padding: '6px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '6px',
                              textAlign: 'center'
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontFamily: 'inherit'
                  }}
                  placeholder="Additional notes or special requests..."
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setStep(3)}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: TavariStyles.colors.gray700,
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
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
                  {loading ? 'Creating...' : (
                    <>
                      <FiSave /> Create Booking
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
        <BookingBusinessHoursOverrideModal
          open={hoursOverrideModal.open}
          reason={hoursOverrideModal.reason}
          onCancel={() => setHoursOverrideModal({ open: false, reason: '' })}
          onApproved={handleHoursOverrideApproved}
        />
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingCreateScreen;












