import { buildReminderEmailHtml } from "./reminderEmail.ts";

export function buildShiftPremiumApprovalEmailHtml(input: {
  businessName: string;
  title: string;
  body: string;
  approveUrl: string;
  rejectUrl: string;
  viewCertificateUrl?: string | null;
}) {
  const buttons = [
    ...(input.viewCertificateUrl
      ? [{ label: "View uploaded certificate", url: input.viewCertificateUrl }]
      : []),
    { label: "Approve shift premium", url: input.approveUrl },
    { label: "Reject", url: input.rejectUrl },
  ];

  const html = buildReminderEmailHtml({
    businessName: input.businessName,
    title: input.title,
    body: input.body,
    buttons,
  });
  return html.replace("Tavari Reminder", "Tavari HR");
}
