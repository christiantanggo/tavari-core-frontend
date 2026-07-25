import toast from 'react-hot-toast';
import camperRegistrationService from '../services/Bookings/CamperRegistrationService';
import { generateCamperRegistrationHTMLContent } from './generateCamperRegistrationHTMLContent';
import { supabase } from '../supabaseClient';
import { printHtmlInNewWindow } from './printCamperRegistrationHtml';

/**
 * Load a submitted camper registration and open the browser print dialog.
 */
export async function openCamperRegistrationPrint(businessId, documentId) {
  if (!businessId || !documentId) {
    toast.error('Missing registration information.');
    return false;
  }

  try {
    camperRegistrationService.setBusinessId(businessId);
    const [doc, template] = await Promise.all([
      camperRegistrationService.getDocumentById(documentId),
      camperRegistrationService.getFormTemplate(businessId),
    ]);

    const { data: businessRow } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .maybeSingle();

    const html = generateCamperRegistrationHTMLContent({
      document: doc,
      businessName: businessRow?.name || '',
      formTitle: template?.form_title || 'Camp Registration & Medical Form',
      authorizationTexts: template?.fields_config?.authorization_texts || {},
      generatedByLabel: 'Tavari Bookings',
    });

    const name = [doc.first_name, doc.last_name].filter(Boolean).join(' ').trim() || 'Camper';
    const ok = printHtmlInNewWindow(html);
    if (ok) {
      toast.success(`Print dialog opened for ${name}. Click Print to finish.`);
    }
    return ok;
  } catch (error) {
    console.error('[openCamperRegistrationPrint]', error);
    toast.error(error?.message || 'Could not open print dialog.');
    return false;
  }
}
