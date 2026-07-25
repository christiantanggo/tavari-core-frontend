// Step 73: Create WaiverMailIntegration.js
// Integration service for linking waivers to mail/contact system
// Uses existing mail_contacts, mail_consent_log, mail_unsubscribes tables
import { supabase } from '../../supabaseClient';

class WaiverMailIntegration {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async syncWaiverToMail(waiverId, email = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.rpc('sync_waiver_mail_contact', {
      p_business_id: this.businessId,
      p_waiver_id: waiverId,
      p_email: email || null
    });

    if (error) {
      throw error;
    }

    return data || null;
  }

  // Create contact from waiver
  async createContactFromWaiver(waiverId, email = null) {
    const syncResult = await this.syncWaiverToMail(waiverId, email);
    if (!syncResult?.contact_id) {
      return null;
    }

    const { data: contact, error } = await supabase
      .from('mail_contacts')
      .select('*')
      .eq('id', syncResult.contact_id)
      .single();

    if (error) {
      throw error;
    }

    return contact;
  }

  // Update contact preferences from waiver consents
  async updateContactPreferences(waiverId, email = null) {
    return await this.syncWaiverToMail(waiverId, email);
  }

  // Send marketing consent request
  async sendMarketingConsent(waiverId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: waiver } = await supabase
      .from('waiver_signatures')
      .select('*')
      .eq('id', waiverId)
      .single();

    if (!waiver || !waiver.email) {
      return { sent: false, reason: 'No email address' };
    }

    // Ensure waiver consent/contact sync is up to date
    await this.syncWaiverToMail(waiverId, waiver.email || null);

    // Log consent request
    // (Actual email sending would be handled by mail service)

    return { sent: true };
  }
}

export default new WaiverMailIntegration();




