// Certificate Expiration Notification System
// This function checks for expiring certificates and sends notification emails
// Should be scheduled to run daily (e.g., via pg_cron or external cron service)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = Deno.env.toObject();

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

interface CertificateNotification {
  employee_id: string;
  employee_email: string;
  employee_name: string;
  certificate_id: string;
  certificate_name: string;
  expiry_date: string;
  days_until_expiry: number;
  business_id: string;
  business_name: string;
  notification_emails: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("[Certificate] Function started, connecting to Supabase...");
    console.log("[Certificate] SUPABASE_URL:", SUPABASE_URL ? "SET" : "MISSING");
    
    // Get all active certificates with expiration notifications enabled
    // Add timeout handling
    const queryPromise = supabase
      .from("hr_certificates")
      .select("*")
      .eq("is_active", true)
      .eq("enable_notifications", true)
      .not("notify_days_before_expiry", "is", null);

    // Add 30 second timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Database query timeout after 30 seconds")), 30000)
    );

    const { data: certificateTypes, error: certTypesError } = await Promise.race([
      queryPromise,
      timeoutPromise
    ]) as any;

    if (certTypesError) {
      console.error("[Certificate] Error fetching certificate types:", certTypesError);
      
      // Check if it's a timeout/connection error
      if (certTypesError.message?.includes("522") || certTypesError.message?.includes("timeout") || certTypesError.message?.includes("Connection timed out")) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "Supabase connection timeout. This is a network/infrastructure issue. Please check your Supabase instance status and try again later." 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
        );
      }
      
      throw certTypesError;
    }

    console.log(`[Certificate] Found ${certificateTypes?.length || 0} certificate types with notifications enabled`);

    if (!certificateTypes || certificateTypes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, notifications_found: 0, emails_sent: 0, emails_failed: 0, results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const notifications: CertificateNotification[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check each certificate type
    for (const certType of certificateTypes) {
      const notifyDays = certType.notify_days_before_expiry || 30;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + notifyDays);

      console.log(`[Certificate] Checking ${certType.name}: notifyDays=${notifyDays}, today=${today.toISOString().split("T")[0]}, targetDate=${targetDate.toISOString().split("T")[0]}`);

      // Find employee certificates for this certificate type
      const { data: employeeCerts, error: empCertsError } = await supabase
        .from("employee_certificates")
        .select("id, employee_id, expiry_date, certificate_id")
        .eq("certificate_id", certType.id)
        .eq("status", "active")
        .not("expiry_date", "is", null)
        .gte("expiry_date", today.toISOString().split("T")[0]);

      console.log(`[Certificate] Found ${employeeCerts?.length || 0} employee certificates for ${certType.name}`);

      if (empCertsError) {
        console.error(`[Certificate] Error fetching employee certificates for ${certType.name}:`, empCertsError);
        continue;
      }

      if (!employeeCerts || employeeCerts.length === 0) {
        continue;
      }

      // Get business data
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("id, name")
        .eq("id", certType.business_id)
        .single();

      if (businessError || !business) {
        console.error(`[Certificate] Error fetching business for ${certType.name}:`, businessError);
        continue;
      }

      // Get user data
      const employeeIds = [...new Set(employeeCerts.map((ec) => ec.employee_id))];
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, email, full_name, first_name, last_name")
        .in("id", employeeIds);

      if (usersError) {
        console.error(`[Certificate] Error fetching users:`, usersError);
        continue;
      }

      const usersMap = new Map((users || []).map((u) => [u.id, u]));

      // Process each expiring certificate
      for (const empCert of employeeCerts) {
        if (!empCert.expiry_date) continue;

        const user = usersMap.get(empCert.employee_id);
        if (!user) continue;

        const expiryDate = new Date(empCert.expiry_date);
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        const shouldNotifyBefore = daysUntilExpiry === notifyDays || (daysUntilExpiry < notifyDays && daysUntilExpiry > 0);
        const shouldNotifyOnExpiry = certType.notify_on_expiry_date && daysUntilExpiry === 0;

        // Check for "before_expiry" notification
        if (shouldNotifyBefore) {
          const { data: existingLog } = await supabase
            .from("certificate_notification_log")
            .select("id")
            .eq("employee_certificate_id", empCert.id)
            .eq("notification_type", "before_expiry")
            .eq("email_sent", true)
            .limit(1);

          if (!existingLog || existingLog.length === 0) {
            const additionalEmails = (certType.notification_recipient_emails || [])
              .filter((email) => email && email.trim().toLowerCase() !== user.email.toLowerCase());

            notifications.push({
              employee_id: empCert.employee_id,
              employee_email: user.email,
              employee_name: user.full_name || `${user.first_name} ${user.last_name}`,
              certificate_id: empCert.id,
              certificate_name: certType.name,
              expiry_date: empCert.expiry_date,
              days_until_expiry: daysUntilExpiry,
              business_id: business.id,
              business_name: business.name,
              notification_emails: additionalEmails,
            });
          }
        }

        // Check for "on_expiry" notification
        if (shouldNotifyOnExpiry) {
          const { data: existingLog } = await supabase
            .from("certificate_notification_log")
            .select("id")
            .eq("employee_certificate_id", empCert.id)
            .eq("notification_type", "on_expiry")
            .eq("email_sent", true)
            .limit(1);

          if (!existingLog || existingLog.length === 0) {
            const additionalEmails = (certType.notification_recipient_emails || [])
              .filter((email) => email && email.trim().toLowerCase() !== user.email.toLowerCase());

            notifications.push({
              employee_id: empCert.employee_id,
              employee_email: user.email,
              employee_name: user.full_name || `${user.first_name} ${user.last_name}`,
              certificate_id: empCert.id,
              certificate_name: certType.name,
              expiry_date: empCert.expiry_date,
              days_until_expiry: daysUntilExpiry,
              business_id: business.id,
              business_name: business.name,
              notification_emails: additionalEmails,
            });
          }
        }
      }
    }

    // Send notification emails
    const emailResults: Array<{ employee_id: string; certificate_id: string; success: boolean; error: string | null }> = [];

    for (const notification of notifications) {
      try {
        const notificationType = notification.days_until_expiry === 0 ? "on_expiry" : "before_expiry";
        const todayStr = today.toISOString().split("T")[0];

        // Send email via mail-send function
        const emailResult = await sendEmail(notification);

        // Log the notification
        const recipients = [notification.employee_email, ...notification.notification_emails].filter((e) => e && e.trim());

        await supabase.from("certificate_notification_log").insert({
          employee_certificate_id: notification.certificate_id,
          notification_type: notificationType,
          notification_date: todayStr,
          days_before_expiry: notification.days_until_expiry,
          email_recipients: recipients,
          email_sent: emailResult.success,
          email_error: emailResult.error,
        });

        emailResults.push({
          employee_id: notification.employee_id,
          certificate_id: notification.certificate_id,
          success: emailResult.success,
          error: emailResult.error,
        });
      } catch (error: any) {
        console.error(`[Certificate] Error processing notification:`, error);
        emailResults.push({
          employee_id: notification.employee_id,
          certificate_id: notification.certificate_id,
          success: false,
          error: error?.message || String(error),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        notifications_found: notifications.length,
        emails_sent: emailResults.filter((r) => r.success).length,
        emails_failed: emailResults.filter((r) => !r.success).length,
        results: emailResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    console.error("[Certificate] Error in function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

async function sendEmail(notification: CertificateNotification): Promise<{ success: boolean; error: string | null }> {
  const subject =
    notification.days_until_expiry === 0
      ? `URGENT: ${notification.certificate_name} Certificate Expired Today - ${notification.business_name}`
      : `${notification.certificate_name} Certificate Expiring Soon - ${notification.business_name}`;

  const expiryText =
    notification.days_until_expiry === 0
      ? "has expired today"
      : notification.days_until_expiry === 1
      ? "expires tomorrow"
      : `expires in ${notification.days_until_expiry} days`;

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #3b82f6; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9fafb; }
        .alert { background-color: ${notification.days_until_expiry === 0 ? "#ef4444" : "#f59e0b"}; color: white; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Certificate Expiration Notice</h1>
        </div>
        <div class="content">
          <p>Hello ${notification.employee_name},</p>
          <div class="alert">
            <strong>Your ${notification.certificate_name} certificate ${expiryText}.</strong>
          </div>
          <p><strong>Certificate Details:</strong></p>
          <ul>
            <li><strong>Certificate:</strong> ${notification.certificate_name}</li>
            <li><strong>Expiration Date:</strong> ${new Date(notification.expiry_date).toLocaleDateString()}</li>
            <li><strong>Days Remaining:</strong> ${notification.days_until_expiry === 0 ? "EXPIRED" : notification.days_until_expiry}</li>
          </ul>
          ${notification.days_until_expiry === 0 ? `<p><strong style="color: #ef4444;">⚠️ ACTION REQUIRED:</strong> This certificate has expired. Please renew immediately to maintain compliance and avoid any impact on your employment status or payroll.</p>` : `<p>Please ensure you renew this certificate before it expires to maintain compliance and avoid any impact on your employment status or payroll.</p>`}
          <p>If you have any questions, please contact your HR department.</p>
          <p>Best regards,<br>${notification.business_name} - HR Department</p>
        </div>
        <div class="footer">
          <p>This is an automated notification from ${notification.business_name}'s HR system.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textBody = `
Certificate Expiration Notice

Hello ${notification.employee_name},

Your ${notification.certificate_name} certificate ${expiryText}.

Certificate Details:
- Certificate: ${notification.certificate_name}
- Expiration Date: ${new Date(notification.expiry_date).toLocaleDateString()}
- Days Remaining: ${notification.days_until_expiry === 0 ? "EXPIRED" : notification.days_until_expiry}

${notification.days_until_expiry === 0 ? "⚠️ ACTION REQUIRED: This certificate has expired. Please renew immediately to maintain compliance and avoid any impact on your employment status or payroll." : "Please ensure you renew this certificate before it expires to maintain compliance and avoid any impact on your employment status or payroll."}

If you have any questions, please contact your HR department.

Best regards,
${notification.business_name} - HR Department

This is an automated notification from ${notification.business_name}'s HR system.
  `;

  // Validate and prepare email addresses
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const allRecipients = [notification.employee_email, ...(notification.notification_emails || [])];

  const validRecipients = allRecipients
    .filter((email) => email && typeof email === "string")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0 && emailRegex.test(email))
    .filter((email, index, self) => self.indexOf(email) === index);

  if (validRecipients.length === 0) {
    return { success: false, error: "No valid email addresses found" };
  }

  const toEmails = validRecipients.join(",");
  const safeBusinessName = (notification.business_name || "Company")
    .replace(/"/g, "'")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .trim();

  // Call mail-send function (EXACT SAME PATTERN as PayStatementsTab)
  const emailPayload = {
    businessId: notification.business_id,
    campaignId: `cert-expiry-${notification.certificate_id}-${Date.now()}`,
    contactId: `cert-${notification.employee_id}`,
    to: toEmails,
    fromEmail: "noreply@tavarios.ca",
    fromName: `${safeBusinessName} - HR`,
    subject: subject,
    html: htmlBody,
    text: textBody,
  };

  console.log(`[Certificate] Calling mail-send with:`, {
    to: emailPayload.to,
    fromEmail: emailPayload.fromEmail,
    fromName: emailPayload.fromName,
    subject: emailPayload.subject.substring(0, 50),
    businessId: emailPayload.businessId,
  });

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      body: JSON.stringify(emailPayload),
    });

    console.log(`[Certificate] mail-send response status:`, response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Certificate] mail-send HTTP error:`, response.status, errorBody);
      return { success: false, error: errorBody || `HTTP ${response.status}` };
    }

    const data = await response.json();
    console.log(`[Certificate] mail-send response data:`, data);

    if (!data?.ok) {
      console.error(`[Certificate] mail-send returned error:`, data?.error);
      return { success: false, error: data?.error || "mail-send returned error" };
    }

    console.log(`[Certificate] Email sent successfully!`);
    return { success: true, error: null };
  } catch (error: any) {
    console.error(`[Certificate] Exception calling mail-send:`, error);
    return { success: false, error: error?.message || String(error) };
  }
}
