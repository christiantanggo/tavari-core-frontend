// Step 68: Create waiverSMSService.js
// Service for sending waiver-related SMS
// Real provider wiring is intentionally disabled in this deployment.

class WaiverSMSService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  getUnsupportedResult(reason = 'Waiver SMS delivery is not enabled in this deployment.') {
    return {
      smsSent: false,
      supported: false,
      reason
    };
  }

  // Send waiver link via SMS
  async sendWaiverLink(waiverId, recipientPhone) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    return this.getUnsupportedResult(
      recipientPhone
        ? 'Waiver SMS delivery is disabled. Use email delivery instead.'
        : 'Waiver SMS delivery is disabled because no phone number was provided.'
    );
  }

  // Send waiver reminder via SMS
  async sendWaiverReminder(waiverId, recipientPhone) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    return this.getUnsupportedResult(
      recipientPhone
        ? 'Waiver SMS reminders are disabled. Use email reminders instead.'
        : 'Waiver SMS reminders are disabled because no phone number was provided.'
    );
  }
}

export default new WaiverSMSService();




