import toast from 'react-hot-toast';
import camperRegistrationService from '../services/Bookings/CamperRegistrationService';
import { generateBlankCamperRegistrationHTMLContent } from './generateBlankCamperRegistrationHTMLContent';
import { supabase } from '../supabaseClient';
import { printHtmlInNewWindow } from './printCamperRegistrationHtml';

/**
 * Open a blank printable camp registration form for handwritten fill-out.
 */
export async function openCamperRegistrationBlankPrint(businessId) {
  if (!businessId) {
    toast.error('Missing business information.');
    return false;
  }

  try {
    camperRegistrationService.setBusinessId(businessId);
    const [template, businessResult] = await Promise.all([
      camperRegistrationService.getFormTemplate(businessId),
      supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    ]);

    const html = generateBlankCamperRegistrationHTMLContent({
      businessName: businessResult?.data?.name || '',
      template,
      generatedByLabel: 'Tavari Bookings',
    });

    const ok = printHtmlInNewWindow(html);
    if (ok) {
      toast.success('Blank form opened. Click Print to finish.');
    }
    return ok;
  } catch (error) {
    console.error('[openCamperRegistrationBlankPrint]', error);
    toast.error(error?.message || 'Could not open blank form.');
    return false;
  }
}
