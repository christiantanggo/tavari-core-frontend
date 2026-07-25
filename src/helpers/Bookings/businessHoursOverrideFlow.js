import { validateBookingWithinBusinessHours } from './businessHoursValidation';
import { validateAnyManagerPin } from '../managerPinValidation';

export function checkBookingBusinessHours({
  bookingDate,
  bookingTime,
  durationMinutes,
  operatingHours,
  holidayHours,
}) {
  return validateBookingWithinBusinessHours({
    bookingDate,
    bookingTime,
    durationMinutes,
    operatingHours,
    holidayHours,
  });
}

export async function approveBusinessHoursOverride(businessId, pin) {
  const result = await validateAnyManagerPin(businessId, pin);
  if (!result.ok) {
    throw new Error('Invalid manager PIN');
  }
  return {
    approvedBy: result.managerId,
    managerName: result.managerName,
  };
}
