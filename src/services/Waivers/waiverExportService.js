// Step 70: Create waiverExportService.js
// Service for exporting waiver data
import { supabase } from '../../supabaseClient';

class WaiverExportService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Export waivers to CSV
  async exportToCSV(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: waivers, error } = await supabase
      .from('waiver_signatures')
      .select(`
        id,
        first_name,
        last_name,
        email,
        phone_number,
        date_of_birth,
        signed_at,
        expires_at,
        is_valid,
        waiver_templates:template_id (template_name)
      `)
      .eq('business_id', this.businessId)
      .order('signed_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Convert to CSV
    const headers = ['ID', 'First Name', 'Last Name', 'Email', 'Phone', 'DOB', 'Signed At', 'Expires At', 'Valid', 'Template'];
    const rows = waivers.map(w => [
      w.id,
      w.first_name,
      w.last_name,
      w.email || '',
      w.phone_number || '',
      w.date_of_birth || '',
      w.signed_at || '',
      w.expires_at || '',
      w.is_valid ? 'Yes' : 'No',
      w.waiver_templates?.template_name || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waivers-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    return { exported: waivers.length };
  }

  // Export waiver report to PDF
  async generateWaiverReport(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get waivers data
    const { data: waivers } = await supabase
      .from('waiver_signatures')
      .select('*')
      .eq('business_id', this.businessId)
      .order('signed_at', { ascending: false });

    // Generate report (would use PDF library)
    // For now, return placeholder
    console.log('Generating waiver report for', waivers?.length || 0, 'waivers');

    return { reportGenerated: true };
  }

  // Bulk download PDFs
  async bulkDownloadPDFs(waiverIds) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get PDF URLs for all waivers
    const pdfUrls = [];
    
    for (const waiverId of waiverIds) {
      try {
        const { data: pdfPath } = await supabase
          .rpc('waivers_get_waiver_pdf_url', {
            waiver_uuid: waiverId
          });

        if (pdfPath) {
          const { data: signedUrl } = await supabase
            .storage
            .from('waivers')
            .createSignedUrl(pdfPath, 3600);

          if (signedUrl) {
            pdfUrls.push({ waiverId, url: signedUrl.signedUrl });
          }
        }
      } catch (error) {
        console.error(`Error getting PDF for waiver ${waiverId}:`, error);
      }
    }

    // Download each PDF
    pdfUrls.forEach(({ waiverId, url }) => {
      window.open(url, '_blank');
    });

    return { downloaded: pdfUrls.length };
  }
}

export default new WaiverExportService();




