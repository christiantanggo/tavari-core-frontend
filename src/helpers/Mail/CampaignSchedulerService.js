// helpers/Mail/CampaignSchedulerService.js - Production Ready Version
import { supabase } from '../../supabaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezonePlugin from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const DEFAULT_BUSINESS_TIMEZONE = 'America/Toronto';

class CampaignSchedulerService {
  constructor() {
    this.timezones = [
      'America/Toronto', 'America/Vancouver', 'America/Edmonton', 
      'America/Winnipeg', 'America/Halifax', 'America/St_Johns', 'UTC'
    ];
    
    this.recurringFrequencies = ['weekly', 'monthly', 'custom'];
    this.daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    // Enhanced caching system (localStorage for persistence)
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  getSafeTimezone(timezone) {
    const timezoneToUse = timezone || DEFAULT_BUSINESS_TIMEZONE;

    try {
      Intl.DateTimeFormat('en-CA', { timeZone: timezoneToUse }).format(new Date());
      return timezoneToUse;
    } catch (error) {
      console.warn('Invalid scheduler timezone, falling back to default:', timezoneToUse, error);
      return DEFAULT_BUSINESS_TIMEZONE;
    }
  }

  async getBusinessTimezoneForRecommendations(businessId) {
    const cacheKey = `${businessId}_timezone`;
    const cached = this.getCachedData(cacheKey);
    if (cached) {
      return this.getSafeTimezone(cached);
    }

    const { data, error } = await supabase
      .from('businesses')
      .select('timezone')
      .eq('id', businessId)
      .maybeSingle();

    if (error) throw error;

    const resolvedTimezone = this.getSafeTimezone(data?.timezone);
    this.setCachedData(cacheKey, resolvedTimezone);
    return resolvedTimezone;
  }

  getZonedDateParts(dateInput, timezone) {
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.getSafeTimezone(timezone),
      weekday: 'long',
      hour: '2-digit',
      hourCycle: 'h23'
    });

    const parts = formatter.formatToParts(date);
    const weekday = parts.find((part) => part.type === 'weekday')?.value?.toLowerCase();
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);

    if (!weekday || Number.isNaN(hour)) {
      return null;
    }

    return { weekday, hour };
  }

  // Get cached data
  getCachedData(key) {
    try {
      const cached = localStorage.getItem(`scheduler_${key}`);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < this.cacheTimeout) {
          return data;
        }
        localStorage.removeItem(`scheduler_${key}`);
      }
    } catch (error) {
      console.warn('Cache read error:', error);
    }
    return null;
  }

  // Set cached data
  setCachedData(key, data) {
    try {
      localStorage.setItem(`scheduler_${key}`, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn('Cache write error:', error);
    }
  }

  // Clear cache for business
  clearCacheForBusiness(businessId) {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(`scheduler_${businessId}_`)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Cache clear error:', error);
    }
  }

  // Execute with retry logic
  async executeWithRetry(operation, maxRetries = this.maxRetries) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (i < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * (i + 1)));
        }
      }
    }
    
    throw lastError;
  }

  getCampaignContentBlocks(campaign) {
    if (Array.isArray(campaign?.content_json)) return campaign.content_json;
    if (Array.isArray(campaign?.content_blocks)) return campaign.content_blocks;
    return [];
  }

  hasUnsubscribeLink(campaign) {
    const contentBlocks = this.getCampaignContentBlocks(campaign);
    const hasBlockLink = contentBlocks.some(block =>
      (block.type === 'text' && String(block.content || '').includes('{UnsubscribeLink}')) ||
      (block.type === 'button' && String(block.content?.url || '').toLowerCase().includes('unsubscribe'))
    );

    if (hasBlockLink) return true;

    return String(campaign?.content_html || '').toLowerCase().includes('unsubscribe');
  }

  escapeTokenForRegex(token) {
    return String(token || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  replaceMergeTokens(content, tokens, value) {
    return tokens.reduce((output, token) => (
      output.replace(new RegExp(this.escapeTokenForRegex(token), 'g'), String(value ?? ''))
    ), String(content || ''));
  }

  personalizeEmailContent(htmlContent, contact, businessId = '') {
    const firstName = contact?.first_name || contact?.firstName || '';
    const lastName = contact?.last_name || contact?.lastName || '';
    const email = contact?.email || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const loyaltyPoints = contact?.loyalty_points ?? contact?.loyaltyPoints ?? contact?.points_balance ?? contact?.pointsBalance ?? '';

    let output = String(htmlContent || '');
    output = this.replaceMergeTokens(output, ['{{First Name}}', '{{FirstName}}', '{FirstName}'], firstName);
    output = this.replaceMergeTokens(output, ['{{Last Name}}', '{{LastName}}', '{LastName}'], lastName);
    output = this.replaceMergeTokens(output, ['{{Full Name}}', '{{FullName}}', '{FullName}'], fullName);
    output = this.replaceMergeTokens(output, ['{{Email Address}}', '{{Email}}', '{Email}'], email);
    output = this.replaceMergeTokens(output, ['{{LoyaltyPoints}}', '{{Loyalty Points}}'], loyaltyPoints);

    const reviewLink = businessId
      ? `${this.resolvePublicSiteUrlForScheduler()}/reputation/review/${businessId}`
      : '';
    const checkedInDemo = String(firstName || '').trim();
    output = this.replaceMergeTokens(output, ['{{{ReviewLink}}}', '{{{Review Link}}}'], reviewLink);
    output = this.replaceMergeTokens(output, ['{{ReviewLink}}', '{{Review Link}}'], reviewLink);
    output = this.replaceMergeTokens(
      output,
      ['{{CheckedInName}}', '{{Checked-In Name}}', '{{Checked In Name}}'],
      checkedInDemo,
    );

    return output;
  }

  resolvePublicSiteUrlForScheduler() {
    const envUrl = String(
      import.meta.env.VITE_PUBLIC_SITE_URL ||
        import.meta.env.VITE_APP_URL ||
        import.meta.env.REACT_APP_BASE_URL ||
        ''
    ).trim();
    if (envUrl && !/localhost|127\.0\.0\.1/i.test(envUrl)) {
      return envUrl.replace(/\/$/, '');
    }
    return 'https://tavarios.ca';
  }

  async queueCampaignRecipients(campaign, businessId) {
    const { data: contacts, error: contactsError } = await supabase
      .from('mail_contacts')
      .select('id, email, first_name, last_name')
      .eq('business_id', businessId)
      .eq('subscribed', true)
      .not('consent_method', 'is', null)
      .not('consent_timestamp', 'is', null);

    if (contactsError) throw contactsError;

    const validContacts = (contacts || []).filter(contact => contact.email);
    if (validContacts.length === 0) {
      throw new Error('No subscribed contacts with recorded consent are available for this campaign');
    }

    await supabase
      .from('mail_sending_queue')
      .delete()
      .eq('campaign_id', campaign.id)
      .in('status', ['queued', 'processing']);

    const queueItems = validContacts.map(contact => ({
      campaign_id: campaign.id,
      contact_id: contact.id,
      email_address: contact.email,
      status: 'queued',
      priority: 5,
      scheduled_for: new Date().toISOString(),
      business_id: businessId,
      personalized_content: this.personalizeEmailContent(campaign.content_html || '', contact, businessId)
    }));

    const batchSize = 1000;
    for (let i = 0; i < queueItems.length; i += batchSize) {
      const batch = queueItems.slice(i, i + batchSize);
      const { error } = await supabase
        .from('mail_sending_queue')
        .insert(batch);

      if (error) throw error;
    }

    await supabase
      .from('mail_campaigns')
      .update({
        status: 'sending',
        total_recipients: validContacts.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaign.id)
      .eq('business_id', businessId);

    return {
      queued: queueItems.length
    };
  }

  async processQueuedCampaign(businessId) {
    const totals = {
      processed: 0,
      sent: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < 200; i++) {
      const { data, error } = await supabase.functions.invoke('mail-process-queue', {
        body: {
          businessId,
          batchSize: 50
        }
      });

      if (error) throw error;

      const processed = data?.processed || 0;
      totals.processed += processed;
      totals.sent += data?.sent || 0;
      totals.failed += data?.failed || 0;
      if (Array.isArray(data?.errors)) {
        totals.errors.push(...data.errors);
      }

      if (processed === 0) {
        break;
      }
    }

    return totals;
  }

  // Enhanced schedule campaign with comprehensive error handling
  async scheduleCampaign(campaignId, scheduleData, businessId) {
    try {
      const { type, scheduled_for, timezone, recurring_settings, optimization } = scheduleData;

      // Enhanced validation
      const validation = this.validateScheduleData(scheduleData, businessId);
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.errors.join(', '),
          details: validation.details
        };
      }

      // Check campaign exists and belongs to business
      const { data: campaign, error: campaignError } = await supabase
        .from('mail_campaigns')
        .select('id, name, status, business_id, content_json, content_html, subject_line')
        .eq('id', campaignId)
        .eq('business_id', businessId)
        .single();

      if (campaignError || !campaign) {
        return {
          success: false,
          error: 'Campaign not found or access denied'
        };
      }

      // Validate campaign is ready for scheduling
      const campaignValidation = this.validateCampaignForScheduling(campaign);
      if (!campaignValidation.isValid) {
        return {
          success: false,
          error: 'Campaign is not ready for scheduling',
          details: campaignValidation.errors
        };
      }

      if (type === 'send_now') {
        return await this.triggerImmediateSend(campaignId, businessId);
      }

      await supabase
        .from('mail_campaign_schedules')
        .delete()
        .eq('campaign_id', campaignId)
        .in('status', ['scheduled', 'processing', 'failed']);

      // Create schedule record using the columns that exist in production
      const scheduleRecord = {
        id: `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        campaign_id: campaignId,
        schedule_type: type,
        timezone: timezone || 'America/Toronto',
        status: 'scheduled',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      scheduleRecord.scheduled_for = scheduled_for;

      if (optimization?.enabled) {
        const optimizedTime = await this.getOptimalSendTime(businessId, scheduled_for);
        if (optimizedTime) {
          scheduleRecord.scheduled_for = optimizedTime;
        }
        scheduleRecord.optimization_settings = optimization;
      }

      if (type === 'recurring' && recurring_settings) {
        const nextSendTimes = this.calculateNextSendTimes(
          scheduleRecord.scheduled_for, 
          recurring_settings, 
          timezone
        );
        
        if (nextSendTimes.length === 0) {
          return {
            success: false,
            error: 'No valid future send times could be calculated for recurring campaign'
          };
        }
        
        scheduleRecord.recurring_settings = recurring_settings;
        scheduleRecord.next_send_times = nextSendTimes;
      }

      // Store schedule in database with retry logic
      const { data, error } = await this.executeWithRetry(async () => {
        return await supabase
          .from('mail_campaign_schedules')
          .insert(scheduleRecord)
          .select()
          .single();
      });

      if (error) throw error;

      // Update campaign status
      const { error: campaignError2 } = await supabase
        .from('mail_campaigns')
        .update({ 
          status: 'scheduled',
          scheduled_at: scheduleRecord.scheduled_for,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
        .eq('business_id', businessId);

      if (campaignError2) {
        // Rollback schedule creation
        await supabase
          .from('mail_campaign_schedules')
          .delete()
          .eq('id', scheduleRecord.id);
        throw campaignError2;
      }

      // Clear relevant caches
      this.clearCacheForBusiness(businessId);

      // Log successful scheduling
      await this.logSchedulingEvent('scheduled', {
        campaign_id: campaignId,
        schedule_id: scheduleRecord.id,
        schedule_type: type,
        business_id: businessId,
        scheduled_for: scheduleRecord.scheduled_for
      });

      return {
        success: true,
        schedule_id: scheduleRecord.id,
        schedule: data,
        optimized: !!optimization?.enabled,
        next_send_times: scheduleRecord.next_send_times || [],
        message: type === 'send_later' ? 'Campaign scheduled successfully' :
                 `Recurring campaign scheduled with ${scheduleRecord.next_send_times?.length || 0} future sends`
      };
    } catch (error) {
      console.error('Error scheduling campaign:', error);
      
      // Log error for monitoring
      await this.logSchedulingEvent('error', {
        campaign_id: campaignId,
        business_id: businessId,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message,
        code: error.code || 'SCHEDULING_ERROR'
      };
    }
  }

  // Enhanced campaign validation for scheduling
  validateCampaignForScheduling(campaign) {
    const errors = [];
    
    if (!campaign.name?.trim()) {
      errors.push('Campaign must have a name');
    }
    
    if (!campaign.subject_line?.trim()) {
      errors.push('Campaign must have a subject line');
    }
    
    const contentBlocks = this.getCampaignContentBlocks(campaign);

    if (!contentBlocks || contentBlocks.length === 0) {
      errors.push('Campaign must have content blocks');
    }
    
    if (campaign.status === 'sent') {
      errors.push('Campaign has already been sent');
    }
    
    if (campaign.status === 'sending') {
      errors.push('Campaign is currently being sent');
    }

    // Check for unsubscribe link compliance
    if (!this.hasUnsubscribeLink(campaign)) {
      errors.push('Campaign must include an unsubscribe link for compliance');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Enhanced send time calculation with business-specific optimization
  calculateNextSendTimes(startDateTime, recurringSettings, timezone) {
    const sendTimes = [];
    const startDate = new Date(startDateTime);
    const { frequency, interval = 1, daysOfWeek = [], endDate, maxSends = 52 } = recurringSettings;
    
    let currentDate = new Date(startDate);
    let sendCount = 0;
    const maxIterations = Math.min(maxSends || 52, 100); // Cap at 100 for safety
    const oneYearFromNow = new Date(Date.now() + (365 * 24 * 60 * 60 * 1000));

    // Validate start date
    if (currentDate <= new Date()) {
      currentDate = this.getNextValidOccurrence(currentDate, frequency, daysOfWeek, interval);
    }

    while (sendCount < maxIterations) {
      // Validate current date is in future
      if (currentDate <= new Date()) {
        currentDate = this.getNextValidOccurrence(currentDate, frequency, daysOfWeek, interval);
        continue;
      }

      // Add current date to send times
      sendTimes.push(currentDate.toISOString());
      sendCount++;

      // Calculate next send date based on frequency
      try {
        if (frequency === 'weekly') {
          currentDate = this.calculateNextWeeklyOccurrence(currentDate, daysOfWeek, interval);
        } else if (frequency === 'monthly') {
          currentDate = this.calculateNextMonthlyOccurrence(currentDate, interval);
        } else if (frequency === 'custom') {
          currentDate = new Date(currentDate.getTime() + (interval * 24 * 60 * 60 * 1000));
        } else {
          throw new Error(`Invalid frequency: ${frequency}`);
        }
      } catch (error) {
        console.error('Error calculating next occurrence:', error);
        break;
      }

      // Check constraints
      if (endDate && currentDate >= new Date(endDate)) {
        break;
      }

      if (currentDate > oneYearFromNow) {
        break;
      }

      // Safety check for infinite loops
      if (sendCount > 0 && currentDate <= new Date(sendTimes[sendTimes.length - 1])) {
        console.error('Infinite loop detected in send time calculation');
        break;
      }
    }

    return sendTimes;
  }

  // Get next valid occurrence for a given frequency
  getNextValidOccurrence(currentDate, frequency, daysOfWeek, interval) {
    const tomorrow = new Date(Date.now() + (24 * 60 * 60 * 1000));
    
    if (frequency === 'weekly' && daysOfWeek.length > 0) {
      return this.getNextWeeklyOccurrence(tomorrow, daysOfWeek);
    } else if (frequency === 'monthly') {
      const nextMonth = new Date(tomorrow);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(currentDate.getDate());
      return nextMonth;
    } else {
      return tomorrow;
    }
  }

  // Enhanced weekly occurrence calculation
  calculateNextWeeklyOccurrence(currentDate, daysOfWeek, interval = 1) {
    if (!daysOfWeek || daysOfWeek.length === 0) {
      return new Date(currentDate.getTime() + (7 * interval * 24 * 60 * 60 * 1000));
    }

    const nextDate = this.getNextWeeklyOccurrence(currentDate, daysOfWeek);
    
    if (interval > 1) {
      const weeksToAdd = Math.floor((interval - 1) * 7);
      nextDate.setDate(nextDate.getDate() + weeksToAdd);
    }
    
    return nextDate;
  }

  // Enhanced monthly occurrence calculation
  calculateNextMonthlyOccurrence(currentDate, interval = 1) {
    const nextDate = new Date(currentDate);
    nextDate.setMonth(nextDate.getMonth() + interval);
    
    // Handle month-end dates (e.g., Jan 31 -> Feb 28)
    if (nextDate.getDate() !== currentDate.getDate()) {
      nextDate.setDate(0); // Set to last day of previous month
    }
    
    return nextDate;
  }

  // Get next occurrence of selected days of the week
  getNextWeeklyOccurrence(currentDate, daysOfWeek) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = currentDate.getDay();
    
    let daysToAdd = 1;
    let foundNextDay = false;
    
    for (let i = 1; i <= 7; i++) {
      const nextDayIndex = (currentDay + i) % 7;
      const nextDayName = dayNames[nextDayIndex];
      
      if (daysOfWeek.includes(nextDayName)) {
        daysToAdd = i;
        foundNextDay = true;
        break;
      }
    }

    if (!foundNextDay) {
      throw new Error('No valid days of week specified');
    }

    return new Date(currentDate.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
  }

  // Enhanced validation with business-specific rules
  validateScheduleData(scheduleData, businessId) {
    const errors = [];
    const details = {};
    const { type, scheduled_for, timezone, recurring_settings } = scheduleData;

    // Validate schedule type
    if (!['send_now', 'send_later', 'recurring'].includes(type)) {
      errors.push('Invalid schedule type');
    }

    // Validate timezone
    if (timezone && !this.timezones.includes(timezone)) {
      errors.push('Invalid timezone');
      details.validTimezones = this.timezones;
    }

    // Validate business ID
    if (!businessId) {
      errors.push('Business ID is required');
    }

    // Validate future scheduling
    if (type !== 'send_now') {
      if (!scheduled_for) {
        errors.push('Scheduled date/time is required');
      } else {
        const scheduleDate = new Date(scheduled_for);
        const now = new Date();
        
        const minFutureTime = new Date(now.getTime() + (60 * 1000));
        if (scheduleDate <= minFutureTime) {
          errors.push('Schedule time must be at least 1 minute in the future');
          details.minimumTime = minFutureTime.toISOString();
        }

        const oneYearFromNow = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
        if (scheduleDate > oneYearFromNow) {
          errors.push('Schedule time cannot be more than 1 year in the future');
          details.maximumTime = oneYearFromNow.toISOString();
        }
      }
    }

    // Enhanced recurring settings validation
    if (type === 'recurring' && recurring_settings) {
      const recurringValidation = this.validateRecurringSettings(recurring_settings, scheduled_for);
      errors.push(...recurringValidation.errors);
      Object.assign(details, recurringValidation.details);
    }

    return {
      isValid: errors.length === 0,
      errors,
      details
    };
  }

  // Detailed recurring settings validation
  validateRecurringSettings(recurringSettings, scheduledFor) {
    const errors = [];
    const details = {};
    const { frequency, interval, daysOfWeek, endDate, maxSends } = recurringSettings;

    if (!this.recurringFrequencies.includes(frequency)) {
      errors.push('Invalid recurring frequency');
      details.validFrequencies = this.recurringFrequencies;
    }

    if (frequency === 'custom') {
      if (!interval || interval < 1 || interval > 365) {
        errors.push('Custom interval must be between 1 and 365 days');
      }
    }

    if (frequency === 'weekly') {
      if (!daysOfWeek || daysOfWeek.length === 0) {
        errors.push('Weekly recurring campaigns must specify days of week');
        details.validDaysOfWeek = this.daysOfWeek;
      } else {
        const invalidDays = daysOfWeek.filter(day => !this.daysOfWeek.includes(day));
        if (invalidDays.length > 0) {
          errors.push(`Invalid days of week: ${invalidDays.join(', ')}`);
          details.validDaysOfWeek = this.daysOfWeek;
        }
      }
    }

    if (endDate && scheduledFor) {
      const endDateTime = new Date(endDate);
      const startDateTime = new Date(scheduledFor);
      if (endDateTime <= startDateTime) {
        errors.push('End date must be after start date');
      }
    }

    if (!endDate && !maxSends) {
      errors.push('Recurring campaigns must specify either end date or maximum sends');
    }

    if (maxSends && (maxSends < 1 || maxSends > 100)) {
      errors.push('Maximum sends must be between 1 and 100');
    }

    return {
      isValid: errors.length === 0,
      errors,
      details
    };
  }

  // Enhanced immediate send trigger
  async triggerImmediateSend(campaignId, businessId) {
    try {
      const { data: campaign, error: campaignError } = await supabase
        .from('mail_campaigns')
        .select('id, business_id, name, subject_line, content_json, content_html')
        .eq('id', campaignId)
        .eq('business_id', businessId)
        .single();

      if (campaignError || !campaign) {
        throw campaignError || new Error('Campaign not found');
      }

      const queueResult = await this.queueCampaignRecipients(campaign, businessId);
      if (!queueResult?.queued) {
        throw new Error('No recipients were queued for sending');
      }

      const processResult = await this.processQueuedCampaign(businessId);

      let finalStatus = 'failed';
      let success = false;
      let message = 'Campaign send failed';

      if (processResult.sent > 0 && processResult.failed === 0) {
        finalStatus = 'sent';
        success = true;
        message = 'Campaign sent successfully';
      } else if (processResult.sent > 0 && processResult.failed > 0) {
        finalStatus = 'partial_failure';
        message = `Campaign sent partially: ${processResult.sent} sent, ${processResult.failed} failed`;
      } else if (processResult.failed > 0) {
        finalStatus = 'failed';
        message = `Campaign send failed for ${processResult.failed} recipient(s)`;
      } else {
        finalStatus = 'failed';
        message = 'No recipients were processed';
      }

      await supabase
        .from('mail_campaigns')
        .update({ 
          status: finalStatus,
          emails_sent: processResult.sent,
          sent_at: finalStatus === 'sent' ? new Date().toISOString() : null,
          scheduled_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
        .eq('business_id', businessId);

      this.clearCacheForBusiness(businessId);

      await this.logSchedulingEvent('sent', {
        campaign_id: campaignId,
        business_id: businessId,
        sent_at: new Date().toISOString(),
        queued: queueResult.queued,
        sent_count: processResult.sent,
        failed_count: processResult.failed
      });

      return {
        success,
        status: finalStatus,
        message,
        queued: queueResult.queued,
        sent: processResult.sent,
        failed: processResult.failed,
        processed: processResult.processed,
        errors: processResult.errors || []
      };
    } catch (error) {
      console.error('Error triggering immediate send:', error);
      return { success: false, status: 'failed', error: error.message };
    }
  }

  // Enhanced scheduled campaign processing
  async processScheduledCampaigns() {
    try {
      const now = new Date();

      const { data: scheduledCampaigns, error } = await supabase
        .from('mail_campaign_schedules')
        .select(`
          *,
          campaign:mail_campaigns(id, name, status, business_id)
        `)
        .eq('status', 'scheduled')
        .lte('scheduled_for', now.toISOString())
        .order('scheduled_for', { ascending: true });

      if (error) throw error;

      const results = [];
      for (const schedule of scheduledCampaigns || []) {
        try {
          await supabase
            .from('mail_campaign_schedules')
            .update({ status: 'processing', processed_at: new Date().toISOString() })
            .eq('id', schedule.id);

          const sendResult = await this.triggerImmediateSend(schedule.campaign_id, schedule.campaign.business_id);
          if (!sendResult.success) {
            throw new Error(sendResult.error || 'Scheduled send failed');
          }

          await supabase
            .from('mail_campaign_schedules')
            .update({ status: 'completed', updated_at: new Date().toISOString() })
            .eq('id', schedule.id);

          results.push({
            schedule_id: schedule.id,
            campaign_id: schedule.campaign_id,
            status: 'processed'
          });

          if (schedule.schedule_type === 'recurring' && schedule.recurring_settings) {
            const recurrenceResult = await this.scheduleNextRecurrence(schedule);
            if (recurrenceResult?.next_scheduled_for) {
              await supabase
                .from('mail_campaigns')
                .update({
                  status: 'scheduled',
                  scheduled_at: recurrenceResult.next_scheduled_for,
                  updated_at: new Date().toISOString()
                })
                .eq('id', schedule.campaign_id)
                .eq('business_id', schedule.campaign.business_id);
            }
          }

        } catch (error) {
          console.error(`Error processing scheduled campaign ${schedule.id}:`, error);
          
          await supabase
            .from('mail_campaign_schedules')
            .update({ 
              status: 'failed', 
              error_message: error.message,
              processed_at: new Date().toISOString()
            })
            .eq('id', schedule.id);

          results.push({
            schedule_id: schedule.id,
            campaign_id: schedule.campaign_id,
            status: 'failed',
            error: error.message
          });
        }
      }

      return {
        success: true,
        processed: results.length,
        results
      };
    } catch (error) {
      console.error('Error processing scheduled campaigns:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Schedule next recurrence for recurring campaigns
  async scheduleNextRecurrence(schedule) {
    try {
      const { recurring_settings, next_send_times, campaign_id } = schedule;
      
      if (!next_send_times || next_send_times.length <= 1) {
        return;
      }

      const remainingSendTimes = next_send_times.slice(1);
      const nextSendTime = remainingSendTimes[0];

      if (!nextSendTime) {
        return;
      }

      const nextSchedule = {
        id: `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        campaign_id: campaign_id,
        schedule_type: 'recurring',
        scheduled_for: nextSendTime,
        timezone: schedule.timezone,
        recurring_settings: recurring_settings,
        next_send_times: remainingSendTimes,
        status: 'scheduled',
        parent_schedule_id: schedule.id,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('mail_campaign_schedules')
        .insert(nextSchedule);

      if (error) throw error;

      return { success: true, next_schedule_id: nextSchedule.id, next_scheduled_for: nextSendTime };
    } catch (error) {
      console.error('Error scheduling next recurrence:', error);
      return { success: false, error: error.message };
    }
  }

  getFallbackRecommendations() {
    return [
      {
        time: '10:00',
        day: 'tuesday',
        engagement_score: 92,
        reason: 'Strong general engagement window while your account builds history',
        data_points: 0
      },
      {
        time: '14:00',
        day: 'thursday',
        engagement_score: 88,
        reason: 'Reliable afternoon send window for broad audiences',
        data_points: 0
      },
      {
        time: '09:00',
        day: 'wednesday',
        engagement_score: 85,
        reason: 'Good weekday morning visibility for most campaigns',
        data_points: 0
      }
    ];
  }

  async buildRecommendationsFromHistory(businessId) {
    const cacheKey = `${businessId}_optimal_times`;
    const cached = this.getCachedData(cacheKey);
    if (cached) {
      return cached;
    }

    const businessTimezone = await this.getBusinessTimezoneForRecommendations(businessId);

    const { data: campaigns, error: campaignError } = await supabase
      .from('mail_campaigns')
      .select('id')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (campaignError) throw campaignError;

    const campaignIds = (campaigns || []).map((campaign) => campaign.id);
    if (!campaignIds.length) {
      const fallback = this.getFallbackRecommendations();
      this.setCachedData(cacheKey, fallback);
      return fallback;
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { data: sends, error: sendsError } = await supabase
      .from('mail_campaign_sends')
      .select('campaign_id, status, sent_at, delivered_at, opened_at, clicked_at')
      .in('campaign_id', campaignIds)
      .gte('sent_at', sixMonthsAgo.toISOString())
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(5000);

    if (sendsError) throw sendsError;

    if (!sends?.length) {
      const fallback = this.getFallbackRecommendations();
      this.setCachedData(cacheKey, fallback);
      return fallback;
    }

    const bins = new Map();

    for (const send of sends) {
      const zonedParts = this.getZonedDateParts(send.sent_at, businessTimezone);
      if (!zonedParts) continue;

      const day = zonedParts.weekday;
      const hour = zonedParts.hour;
      const key = `${day}-${hour}`;
      const current = bins.get(key) || {
        day,
        hour,
        sends: 0,
        opened: 0,
        clicked: 0,
        delivered: 0,
        score: 0
      };

      current.sends += 1;
      if (send.delivered_at || send.status === 'delivered' || send.status === 'opened' || send.status === 'clicked' || send.status === 'sent') {
        current.delivered += 1;
        current.score += 25;
      }
      if (send.opened_at || send.status === 'opened' || send.status === 'clicked') {
        current.opened += 1;
        current.score += 30;
      }
      if (send.clicked_at || send.status === 'clicked') {
        current.clicked += 1;
        current.score += 45;
      }
      if (send.status === 'failed' || send.status === 'bounced') {
        current.score -= 20;
      }

      bins.set(key, current);
    }

    const recommendations = Array.from(bins.values())
      .filter((bin) => bin.sends >= 3)
      .map((bin) => {
        const openRate = bin.sends > 0 ? (bin.opened / bin.sends) * 100 : 0;
        const clickRate = bin.sends > 0 ? (bin.clicked / bin.sends) * 100 : 0;
        const deliveryRate = bin.sends > 0 ? (bin.delivered / bin.sends) * 100 : 0;
        const engagementScore = Math.max(
          1,
          Math.min(99, Math.round((bin.score / bin.sends) + Math.min(bin.sends / 4, 10)))
        );

        let reason = 'Consistent historical engagement from recent campaigns';
        if (clickRate >= 15) {
          reason = 'Strong click-through performance in recent campaign history';
        } else if (openRate >= 35) {
          reason = 'Strong open rates in recent campaign history';
        } else if (deliveryRate >= 95) {
          reason = 'Consistently reliable delivery performance';
        }

        return {
          time: `${String(bin.hour).padStart(2, '0')}:00`,
          day: bin.day,
          engagement_score: engagementScore,
          reason,
          data_points: bin.sends
        };
      })
      .sort((a, b) => {
        if (b.engagement_score !== a.engagement_score) {
          return b.engagement_score - a.engagement_score;
        }
        return b.data_points - a.data_points;
      })
      .slice(0, 3);

    const finalRecommendations = recommendations.length
      ? recommendations
      : this.getFallbackRecommendations();

    this.setCachedData(cacheKey, finalRecommendations);
    return finalRecommendations;
  }

  // Get optimal send time recommendations
  async getOptimalSendTime(businessId, requestedTime) {
    try {
      const [recommendations, businessTimezone] = await Promise.all([
        this.buildRecommendationsFromHistory(businessId),
        this.getBusinessTimezoneForRecommendations(businessId)
      ]);
      return this.findBestTimeFromRecommendations(recommendations, requestedTime, businessTimezone);
    } catch (error) {
      console.error('Error getting optimal send time:', error);
      return null;
    }
  }

  // Find best time from recommendations
  findBestTimeFromRecommendations(recommendations, requestedTime, businessTimezone = DEFAULT_BUSINESS_TIMEZONE) {
    const timezone = this.getSafeTimezone(businessTimezone);
    const requestedDate = dayjs(requestedTime).tz(timezone);
    if (!requestedDate.isValid()) {
      return null;
    }
    
    // Find recommendation for same day of week
    const requestedDay = requestedDate.format('dddd').toLowerCase();
    const dayRecommendation = recommendations.find(rec => rec.day === requestedDay);
    
    if (dayRecommendation) {
      const [hours, minutes] = dayRecommendation.time.split(':');
      const optimizedDate = requestedDate
        .hour(parseInt(hours, 10))
        .minute(parseInt(minutes, 10))
        .second(0)
        .millisecond(0);
      
      // Only return if it's still in the future
      if (optimizedDate.isAfter(dayjs())) {
        return optimizedDate.utc().toISOString();
      }
    }
    
    return null;
  }

  // Get send time recommendations for UI
  async getSendTimeRecommendations(businessId) {
    try {
      const recommendations = await this.buildRecommendationsFromHistory(businessId);

      return {
        success: true,
        recommendations
      };
    } catch (error) {
      console.error('Error getting send time recommendations:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get scheduled campaigns for a business
  async getScheduledCampaigns(businessId) {
    try {
      const cacheKey = `${businessId}_scheduled_campaigns`;
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return { success: true, schedules: cached };
      }

      const { data, error } = await supabase
        .from('mail_campaign_schedules')
        .select(`
          *,
          campaign:mail_campaigns!inner(id, name, subject_line, business_id)
        `)
        .eq('campaign.business_id', businessId)
        .in('status', ['scheduled', 'processing'])
        .order('scheduled_for', { ascending: true });

      if (error) throw error;

      // Cache the results
      this.setCachedData(cacheKey, data || []);

      return {
        success: true,
        schedules: data || []
      };
    } catch (error) {
      console.error('Error getting scheduled campaigns:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Cancel a scheduled campaign
  async cancelScheduledCampaign(scheduleId, businessId) {
    try {
      // Verify ownership through campaign
      const { data: schedule, error: fetchError } = await supabase
        .from('mail_campaign_schedules')
        .select(`
          *,
          campaign:mail_campaigns!inner(business_id)
        `)
        .eq('id', scheduleId)
        .eq('campaign.business_id', businessId)
        .single();

      if (fetchError || !schedule) {
        return {
          success: false,
          error: 'Schedule not found or access denied'
        };
      }

      if (schedule.status === 'processing') {
        return {
          success: false,
          error: 'Cannot cancel campaign that is currently being processed'
        };
      }

      const { error } = await supabase
        .from('mail_campaign_schedules')
        .update({ 
          status: 'cancelled',
          cancelled_at: new Date().toISOString()
        })
        .eq('id', scheduleId);

      if (error) throw error;

      // Update campaign status back to draft
      await supabase
        .from('mail_campaigns')
        .update({ 
          status: 'draft',
          scheduled_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', schedule.campaign_id);

      // Clear cache
      this.clearCacheForBusiness(businessId);

      // Log cancellation
      await this.logSchedulingEvent('cancelled', {
        schedule_id: scheduleId,
        campaign_id: schedule.campaign_id,
        business_id: businessId
      });

      return {
        success: true,
        message: 'Campaign schedule cancelled successfully'
      };
    } catch (error) {
      console.error('Error cancelling scheduled campaign:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update scheduled campaign
  async updateScheduledCampaign(scheduleId, updates, businessId) {
    try {
      // Verify ownership and current status
      const { data: schedule, error: fetchError } = await supabase
        .from('mail_campaign_schedules')
        .select(`
          *,
          campaign:mail_campaigns!inner(business_id)
        `)
        .eq('id', scheduleId)
        .eq('campaign.business_id', businessId)
        .single();

      if (fetchError || !schedule) {
        return {
          success: false,
          error: 'Schedule not found or access denied'
        };
      }

      if (schedule.status !== 'scheduled') {
        return {
          success: false,
          error: 'Can only update scheduled campaigns'
        };
      }

      // Validate updates
      const validation = this.validateScheduleData({
        ...schedule,
        ...updates,
        type: schedule.schedule_type
      }, businessId);
      
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.errors.join(', ')
        };
      }

      const { error } = await supabase
        .from('mail_campaign_schedules')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', scheduleId);

      if (error) throw error;

      // Clear cache
      this.clearCacheForBusiness(businessId);

      return {
        success: true,
        message: 'Campaign schedule updated successfully'
      };
    } catch (error) {
      console.error('Error updating scheduled campaign:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Log scheduling events for audit
  async logSchedulingEvent(eventType, data) {
    try {
      // This integrates with the existing audit system
      await supabase
        .from('audit_logs')
        .insert({
          action: `mail_schedule_${eventType}`,
          business_id: data.business_id,
          user_id: data.user_id || null,
          details: {
            event_type: eventType,
            ...data
          },
          created_at: new Date().toISOString()
        });
    } catch (error) {
      // Log errors silently - don't fail operations due to audit logging
      console.warn('Failed to log scheduling event:', error);
    }
  }

  // Database setup for scheduling tables
  static async setupSchedulingTables() {
    try {
      // Create campaign schedules table
      const { error: tableError } = await supabase.rpc('execute_sql', {
        query: `
          CREATE TABLE IF NOT EXISTS mail_campaign_schedules (
            id TEXT PRIMARY KEY,
            campaign_id UUID REFERENCES mail_campaigns(id) ON DELETE CASCADE,
            business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
            schedule_type TEXT NOT NULL CHECK (schedule_type IN ('send_now', 'send_later', 'recurring')),
            scheduled_for TIMESTAMP,
            timezone TEXT DEFAULT 'America/Toronto',
            recurring_settings JSONB,
            next_send_times TEXT[],
            optimization_settings JSONB,
            status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'completed', 'failed', 'cancelled')),
            parent_schedule_id TEXT,
            error_message TEXT,
            processed_at TIMESTAMP,
            cancelled_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT timezone('utc'::text, now()),
            updated_at TIMESTAMP DEFAULT timezone('utc'::text, now()),
            created_by UUID REFERENCES users(id),
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3,
            optimization_applied BOOLEAN DEFAULT false,
            original_scheduled_for TIMESTAMP
          );
        `
      });

      if (tableError) throw tableError;

      // Create indexes for performance
      const { error: indexError } = await supabase.rpc('execute_sql', {
        query: `
          CREATE INDEX IF NOT EXISTS idx_campaign_schedules_campaign_id 
          ON mail_campaign_schedules(campaign_id);
          
          CREATE INDEX IF NOT EXISTS idx_campaign_schedules_business_id 
          ON mail_campaign_schedules(business_id);
          
          CREATE INDEX IF NOT EXISTS idx_campaign_schedules_scheduled_for 
          ON mail_campaign_schedules(scheduled_for);
          
          CREATE INDEX IF NOT EXISTS idx_campaign_schedules_status 
          ON mail_campaign_schedules(status);
          
          CREATE INDEX IF NOT EXISTS idx_campaign_schedules_type 
          ON mail_campaign_schedules(schedule_type);
        `
      });

      if (indexError) throw indexError;

      // Add RLS policy
      const { error: rlsError } = await supabase.rpc('execute_sql', {
        query: `
          ALTER TABLE mail_campaign_schedules ENABLE ROW LEVEL SECURITY;
          
          DROP POLICY IF EXISTS "Users can access schedules for their business campaigns" ON mail_campaign_schedules;
          
          CREATE POLICY "Users can access schedules for their business campaigns" 
          ON mail_campaign_schedules
          FOR ALL USING (
            business_id IN (SELECT id FROM businesses WHERE id = auth.uid())
          );
        `
      });

      if (rlsError) throw rlsError;

      console.log('Campaign scheduling tables created successfully');
      return { success: true };
    } catch (error) {
      console.error('Error setting up scheduling tables:', error);
      return { success: false, error: error.message };
    }
  }
}

export default new CampaignSchedulerService();