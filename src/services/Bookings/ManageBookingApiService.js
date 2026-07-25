import { fetchTavariApiManageBooking } from '../TavariApis/tavariApisCatalog';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';

class ManageBookingApiService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async getPortalInfo() {
    return fetchTavariApiManageBooking(this.businessId, { action: 'getPortalInfo' }, { method: 'GET' });
  }

  async sendOtp(phoneNumber, email = null) {
    return fetchTavariApiManageBooking(this.businessId, {
      action: 'sendOtp',
      phoneNumber: normalizePhoneDigits(phoneNumber),
      ...(email ? { email } : {}),
    });
  }

  async verifyOtp(phoneNumber, otpCode) {
    return fetchTavariApiManageBooking(this.businessId, {
      action: 'verifyOtp',
      phoneNumber: normalizePhoneDigits(phoneNumber),
      otpCode: String(otpCode || '').trim(),
    });
  }

  async selectBooking(sessionToken, bookingId) {
    return fetchTavariApiManageBooking(this.businessId, {
      action: 'selectBooking',
      bookingId,
      sessionToken,
    }, {
      headers: {
        'X-Customer-Session': sessionToken,
        Authorization: `Bearer ${sessionToken}`,
      },
    });
  }
}

const manageBookingApiService = new ManageBookingApiService();
export default manageBookingApiService;
