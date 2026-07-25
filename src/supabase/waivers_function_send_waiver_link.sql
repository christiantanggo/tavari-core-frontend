-- Step 17: Create function waivers_send_waiver_link
-- Purpose: Send waiver link via email/SMS/app
-- Uses existing mail_contacts, mail_campaign_sends, mail_contact_communications tables

CREATE OR REPLACE FUNCTION waivers_send_waiver_link(
  waiver_uuid UUID,
  recipient_email TEXT DEFAULT NULL,
  recipient_phone TEXT DEFAULT NULL,
  delivery_methods TEXT[] DEFAULT ARRAY['email']::TEXT[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_waiver_record RECORD;
  v_business_id UUID;
  v_contact_id UUID;
  v_signature_token TEXT;
  v_waiver_url TEXT;
  v_email_body TEXT;
  v_sms_body TEXT;
BEGIN
  -- Get waiver information
  SELECT 
    ws.id,
    ws.business_id,
    ws.signature_token,
    ws.first_name,
    ws.last_name,
    ws.customer_id,
    wt.template_name
  INTO v_waiver_record
  FROM waiver_signatures ws
  JOIN waiver_templates wt ON ws.template_id = wt.id
  WHERE ws.id = waiver_uuid;
  
  -- If waiver not found, return
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Waiver not found: %', waiver_uuid;
  END IF;
  
  v_business_id := v_waiver_record.business_id;
  v_signature_token := v_waiver_record.signature_token;
  
  -- Generate waiver URL (this would be the frontend URL)
  v_waiver_url := '/waivers/sign/' || v_signature_token;
  
  -- Get or create contact in mail_contacts
  IF recipient_email IS NOT NULL THEN
    -- Try to find existing contact
    SELECT id INTO v_contact_id
    FROM mail_contacts
    WHERE business_id = v_business_id
      AND email = recipient_email
    LIMIT 1;
    
    -- If not found, create new contact
    IF v_contact_id IS NULL THEN
      INSERT INTO mail_contacts (
        business_id,
        email,
        first_name,
        last_name,
        phone,
        subscribed
      ) VALUES (
        v_business_id,
        recipient_email,
        v_waiver_record.first_name,
        v_waiver_record.last_name,
        recipient_phone,
        true
      )
      RETURNING id INTO v_contact_id;
    END IF;
    
    -- Update contact with phone if provided
    IF recipient_phone IS NOT NULL THEN
      UPDATE mail_contacts
      SET phone = recipient_phone
      WHERE id = v_contact_id AND phone IS NULL;
    END IF;
  END IF;
  
  -- Send via email if 'email' is in delivery_methods
  IF 'email' = ANY(delivery_methods) AND recipient_email IS NOT NULL THEN
    -- Create email content
    v_email_body := 'Hello ' || v_waiver_record.first_name || ',
    
Please sign your waiver by clicking the link below:

' || v_waiver_url || '

Thank you,
' || v_business_id::TEXT;
    
    -- Log communication (mail_contact_communications table)
    INSERT INTO mail_contact_communications (
      contact_id,
      communication_type,
      direction,
      subject,
      content,
      status
    ) VALUES (
      v_contact_id,
      'email',
      'outbound',
      'Waiver Signing Link',
      v_email_body,
      'sent'
    );
    
    -- Note: Actual email sending would be handled by the mail service
    -- This function just logs the communication
  END IF;
  
  -- Send via SMS if 'sms' is in delivery_methods
  IF 'sms' = ANY(delivery_methods) AND recipient_phone IS NOT NULL THEN
    -- Create SMS content
    v_sms_body := 'Please sign your waiver: ' || v_waiver_url;
    
    -- Log SMS communication
    IF v_contact_id IS NOT NULL THEN
      INSERT INTO mail_contact_communications (
        contact_id,
        communication_type,
        direction,
        content,
        status
      ) VALUES (
        v_contact_id,
        'sms',
        'outbound',
        v_sms_body,
        'sent'
      );
    END IF;
    
    -- Note: Actual SMS sending would be handled by the SMS service
  END IF;
  
  -- App notification would be handled separately via push notification service
  -- This function just logs the communication intent
  
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_send_waiver_link IS 'Send waiver signing link via email/SMS/app - logs to mail_contact_communications table';




