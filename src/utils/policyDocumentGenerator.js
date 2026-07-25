/**
 * Shared policy document HTML / plain-text generation (Policy Center + PolicyCreationModal).
 * Keeps PDF layout in sync with stored category data.
 */

/**
 * Normalize hr_policies.policy_categories JSONB to editor shape.
 * @param {unknown} categoriesRaw
 * @returns {Array<{ categoryId: string, categoryContent: string, subContents: Array<{ id: string, content: string }> }>}
 */
export function normalizePolicyCategoriesFromDb(categoriesRaw) {
  let parsed = categoriesRaw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  const raw = Array.isArray(parsed) ? parsed : [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        return { categoryId: item, categoryContent: '', subContents: [] };
      }
      const categoryId = item && (item.categoryId || item.id);
      if (item && categoryId) {
        let subContents = [];
        if (item.subContents && Array.isArray(item.subContents)) {
          subContents = item.subContents;
        } else if (item.subContent && typeof item.subContent === 'string') {
          const lines = item.subContent.trim().split('\n').filter((line) => line.trim());
          subContents = lines.map((line, index) => ({
            id: `sub-${Date.now()}-${index}`,
            content: line.trim()
          }));
        }
        return {
          categoryId: String(categoryId),
          categoryContent: item.categoryContent || '',
          subContents
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * @param {Array<{ categoryId: string, categoryContent?: string, subContents?: Array<{ content?: string }> }>} selectedCategories
 * @param {Array<{ id: string, category_name: string }>} policyCategories
 */
export function buildPolicyPlainTextContent(selectedCategories, policyCategories) {
  if (!selectedCategories || selectedCategories.length === 0) return '';

  let content = '';
  selectedCategories.forEach((categoryItem, index) => {
    const category = policyCategories.find((cat) => cat.id === categoryItem.categoryId);
    if (!category) return;

    const categoryNumber = index + 1;
    content += `${categoryNumber}. ${category.category_name}\n\n`;

    if (categoryItem.categoryContent && categoryItem.categoryContent.trim()) {
      content += `${categoryItem.categoryContent.trim()}\n\n`;
    }

    if (categoryItem.subContents && Array.isArray(categoryItem.subContents) && categoryItem.subContents.length > 0) {
      categoryItem.subContents.forEach((subItem, subIndex) => {
        if (subItem.content && subItem.content.trim()) {
          content += `${categoryNumber}.${subIndex + 1}. ${subItem.content.trim()}\n`;
        }
      });
      content += '\n';
    }
  });

  return content.trim();
}

/**
 * @param {object} opts
 * @param {string} opts.policyName
 * @param {string} opts.businessName
 * @param {{ primary_color?: string, logo_url?: string } | null} [opts.brandingData]
 * @param {{ signature_image: string, signed_by_name: string, signed_at: string } | null} [opts.digitalSignature]
 * @param {string | null} [opts.policyNumber]
 * @param {string | null} [opts.versionNumber]
 * @param {string} [opts.effectiveDate] YYYY-MM-DD
 * @param {string} [opts.revisedDate] YYYY-MM-DD
 * @param {Array<{ categoryId: string, categoryContent?: string, subContents?: Array<{ content?: string }> }>} opts.selectedCategories
 * @param {Array<{ id: string, category_name: string, display_order?: number }>} opts.policyCategories
 * @returns {string} Full HTML document
 */
export function generatePolicyHtmlDocument({
  policyName,
  businessName,
  brandingData = null,
  digitalSignature = null,
  policyNumber: _policyNumber = null,
  versionNumber = null,
  effectiveDate = '',
  revisedDate = '',
  selectedCategories = [],
  policyCategories = []
}) {
  const primaryColor = brandingData?.primary_color || '#3B82F6';
  const logoUrl = brandingData?.logo_url || '';
  const effectiveDateLabel = effectiveDate
    ? new Date(effectiveDate + 'T12:00:00').toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : 'the date of issuance';
  const revisedDateLabel = revisedDate
    ? new Date(revisedDate + 'T12:00:00').toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '';
  const updatedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const displayVersion = versionNumber || '1.0';

  const buildCategoryHtml = () => {
    if (!selectedCategories || selectedCategories.length === 0) {
      return '';
    }

    const selectedCategoryDetails = selectedCategories
      .map((categoryItem) => {
        const category = policyCategories.find((cat) => cat.id === categoryItem.categoryId);
        if (!category) return null;
        return {
          ...category,
          categoryContent: categoryItem.categoryContent || '',
          subContents: categoryItem.subContents || []
        };
      })
      .filter(Boolean);

    if (selectedCategoryDetails.length === 0) {
      return '';
    }

    let categoryContentHtml = '';
    selectedCategoryDetails.forEach((category, index) => {
      const categoryNumber = index + 1;
      const escapedName = category.category_name
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      categoryContentHtml += `<div class="category-section" style="margin-top: ${index === 0 ? '0' : '24px'}; margin-bottom: 24px;">`;
      categoryContentHtml += `<h3 style="font-size: 18px; font-weight: bold; color: ${primaryColor}; margin: 0 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid ${primaryColor};">
          ${categoryNumber}. ${escapedName}
        </h3>`;

      if (category.categoryContent && category.categoryContent.trim()) {
        const escapedCategoryContent = category.categoryContent
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        categoryContentHtml += `<div class="category-content" style="margin-bottom: 8px; line-height: 1.5; font-size: 6pt;">
            ${escapedCategoryContent
              .split('\n')
              .map((line) => (line.trim() ? `<p style="margin-bottom: 6px;">${line}</p>` : '<br>'))
              .join('')}
          </div>`;
      }

      if (category.subContents && Array.isArray(category.subContents) && category.subContents.length > 0) {
        category.subContents.forEach((subItem, subIndex) => {
          if (subItem.content && subItem.content.trim()) {
            const subNumber = `${categoryNumber}.${subIndex + 1}`;
            const escapedLine = subItem.content
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
            categoryContentHtml += `<div class="sub-content" style="margin-left: 30px; margin-bottom: 6px; line-height: 1.5;">
                <span style="font-weight: bold; margin-right: 8px;">${subNumber}.</span>
                <span>${escapedLine
                  .split('\n')
                  .map((line) => (line.trim() ? line : '<br>'))
                  .join('')}</span>
              </div>`;
          }
        });
      }

      categoryContentHtml += `</div>`;
    });

    return categoryContentHtml;
  };

  const categoryContent = buildCategoryHtml();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${policyName}</title>
  <style>
    @page {
      size: letter;
      margin: 0;
    }
    body {
      font-family: 'Times New Roman', Times, serif;
      line-height: 1.5;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #fff;
      position: relative;
      width: 8.5in;
      min-height: 11in;
    }
    .top-border {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 20px;
      background-color: ${primaryColor};
      z-index: 1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }
    .right-border {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 80px;
      background-color: ${primaryColor};
      z-index: 1;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 30px;
      writing-mode: vertical-rl;
      text-orientation: sideways;
      color: white;
      font-weight: bold;
      font-size: 16px;
      letter-spacing: 3px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }
    .page-container {
      position: relative;
      width: 8.5in;
      min-height: 11in;
      margin: 0;
      background-color: #fff;
      padding: 0.75in;
      padding-right: 1.5in;
      padding-top: 1in;
      box-sizing: border-box;
    }
    .logo-container {
      position: absolute;
      top: 0;
      right: 0;
      width: 80px;
      height: 120px;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 15px;
      box-sizing: border-box;
    }
    .logo-container img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .header {
      position: relative;
      margin-bottom: 30px;
      padding-top: 20px;
      z-index: 0;
    }
    .header-title-row {
      display: flex;
      align-items: baseline;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid ${primaryColor};
    }
    .policy-label {
      font-size: 14px;
      font-weight: bold;
      color: ${primaryColor};
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 1px;
      flex-shrink: 0;
    }
    .policy-title {
      font-size: 14px;
      font-weight: bold;
      margin: 0;
      color: ${primaryColor};
      letter-spacing: 1px;
      flex: 1;
      min-width: 0;
    }
    .policy-meta-footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      font-size: 6px;
      color: #666;
      display: flex;
      flex-wrap: wrap;
      gap: 24px 32px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-weight: bold;
      margin-bottom: 2px;
    }
    .content {
      font-size: 6pt;
      line-height: 1.5;
      margin-top: 20px;
      margin-bottom: 40px;
    }
    .numbered-section {
      margin-bottom: 6px;
      line-height: 1.5;
    }
    .section-number {
      font-weight: bold;
      margin-right: 8px;
    }
    .section-content {
      display: inline;
    }
    .signature-section {
      margin-top: 60px;
      padding-top: 30px;
      border-top: 1px solid #e5e7eb;
      page-break-inside: avoid;
    }
    .signature-title {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 20px;
      color: #111827;
    }
    .signature-line {
      margin-top: 60px;
      margin-bottom: 8px;
      border-bottom: 2px solid #333;
      width: 300px;
      height: 2px;
    }
    .signature-label {
      font-size: 6px;
      color: #666;
      margin-top: 4px;
    }
    .digital-signature {
      margin-top: 20px;
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      background-color: #f9fafb;
    }
    .digital-signature img {
      max-width: 200px;
      max-height: 60px;
    }
    .signature-info {
      font-size: 6px;
      color: #666;
      margin-top: 4px;
    }
    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      body {
        margin: 0;
        padding: 0;
        width: 8.5in;
        min-height: 11in;
        position: relative;
      }
      .top-border {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 20px;
        background-color: ${primaryColor} !important;
      }
      .right-border {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 80px;
        background-color: ${primaryColor} !important;
        text-orientation: sideways !important;
      }
      .logo-container {
        position: absolute;
        top: 0;
        right: 0;
        width: 80px;
        height: 120px;
      }
      .page-container {
        page-break-after: auto;
        margin: 0;
        padding: 0.75in;
        padding-right: 1.5in;
        padding-top: 1in;
      }
      .signature-section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="top-border"></div>
  <div class="right-border"></div>
  ${logoUrl ? `<div class="logo-container"><img src="${logoUrl}" alt="${businessName} Logo" /></div>` : ''}
  
  <div class="page-container">
    <div class="header">
      <div class="header-title-row">
        <span class="policy-title">Policy: ${policyName}</span>
      </div>
    </div>

    <div class="content">
      ${categoryContent}
    </div>

    <div class="signature-section" style="page-break-inside:avoid;break-inside:avoid;margin-top:28px;padding-top:20px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;">
      <div class="signature-title" style="font-size: 14px;font-weight:bold;margin-bottom:14px;color:#111827;">Acknowledgment</div>
      ${
        digitalSignature
          ? `
        <div class="digital-signature">
          <img src="${digitalSignature.signature_image}" alt="Digital Signature" />
          <div class="signature-info">
            Signed by: ${digitalSignature.signed_by_name}<br>
            Date: ${new Date(digitalSignature.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      `
          : `
        <div>
          <div class="signature-line" style="display:block;width:280px;max-width:100%;height:2px;background-color:#333333;margin-top:16px;border:none;padding:0;" aria-hidden="true"></div>
          <div class="signature-label" style="display:block;font-size: 11px;color:#555555;margin-top:8px;">Employee Signature</div>
        </div>
        <div style="margin-top: 28px;">
          <div class="signature-line" style="display:block;width:280px;max-width:100%;height:2px;background-color:#333333;margin-top:16px;border:none;padding:0;" aria-hidden="true"></div>
          <div class="signature-label" style="display:block;font-size: 11px;color:#555555;margin-top:8px;">Date</div>
        </div>
      `
      }
    </div>

    <div class="policy-meta-footer">
      <div class="meta-item">
        <span class="meta-label">Effective Date:</span>
        <span>${effectiveDateLabel}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Revised Date:</span>
        <span>${revisedDateLabel}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Last Updated:</span>
        <span>${updatedDate}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Version:</span>
        <span>${displayVersion}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}
