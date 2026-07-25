import {
  activityShowsTermsOnConfirmation,
  activityUsesPendingTermsOnBooking,
  bookingRequiresPartyTermsApprovalCta,
  bookingRequiresTermsAcknowledgment,
} from '../bookingTermsAcknowledgment';

describe('bookingTermsAcknowledgment confirmation setting', () => {
  test('activityShowsTermsOnConfirmation reads activity flag', () => {
    expect(activityShowsTermsOnConfirmation(true)).toBe(true);
    expect(activityShowsTermsOnConfirmation(false)).toBe(false);
    expect(activityShowsTermsOnConfirmation({ terms_show_on_confirmation: true })).toBe(true);
    expect(activityShowsTermsOnConfirmation({ terms_show_on_confirmation: false })).toBe(false);
  });

  test('pending terms on booking require package + confirmation flag', () => {
    expect(activityUsesPendingTermsOnBooking({
      terms_package_id: 'pkg-1',
      terms_show_on_confirmation: true,
    })).toBe(true);
    expect(activityUsesPendingTermsOnBooking({
      terms_package_id: 'pkg-1',
      terms_show_on_confirmation: false,
    })).toBe(false);
    expect(activityUsesPendingTermsOnBooking({
      terms_package_id: null,
      terms_show_on_confirmation: true,
    })).toBe(false);
  });

  test('confirmation CTA only when activity opted in and terms pending', () => {
    const pending = { terms_package_id: 'pkg-1', terms_status: 'pending' };
    expect(bookingRequiresTermsAcknowledgment(pending)).toBe(true);
    expect(bookingRequiresPartyTermsApprovalCta(pending, false)).toBe(false);
    expect(bookingRequiresPartyTermsApprovalCta(pending, {
      terms_show_on_confirmation: true,
    })).toBe(true);
  });
});
