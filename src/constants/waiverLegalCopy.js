/** Version bump when changing disclaimer wording (stored with each acknowledgment). */
export const ADDITIONAL_ADULT_INTENT_DISCLAIMER_VERSION = '2026-03-29-v1';

/** Full text shown and stored for legal record (intent to add another adult signer). */
export function getAdditionalAdultIntentAcknowledgmentFullText() {
  return [
    'I confirm that I am choosing to add another adult (18+) as a separate signer on this waiver.',
    'I understand that the additional adult must personally read this waiver, enter their own information, and apply their own electronic signature. I am not signing on their behalf.',
    'If I misrepresent who is signing, or if someone signs in place of the additional adult without their knowledge and consent, liability for the waiver may attach to the person who actually signed, and the business may treat the waiver as void or incomplete for that person.',
    'I understand that entering the facility or participating without a valid waiver signed by the actual participant may constitute trespass or other offenses under applicable law, and the additional adult could face charges if they have not personally signed.',
    'I have accurately represented my identity and I will ensure the next steps are completed only by the true additional adult named in the flow.'
  ].join(' ');
}

/** Short banner for emails/PDFs when the waiver includes additional adult signers. */
export const ADDITIONAL_ADULT_EMAIL_BANNER_HTML = `
<div style="background:#FEF3C7;border:2px solid #F59E0B;border-radius:8px;padding:14px 16px;margin:0 0 20px 0;">
  <p style="margin:0 0 8px 0;font-weight:bold;font-size: 13px;color:#92400e;">Additional adult signers</p>
  <p style="margin:0;font-size: 13px;line-height:1.55;color:#451a03;">
    Each additional adult listed on this waiver must have personally read, agreed to, and signed this document.
    Signing for another adult without authority is a serious misrepresentation and may affect the validity of the waiver for that person.
  </p>
</div>`;
