// components/Mail/EmailPreview.jsx
import React from 'react';
import { styles } from '../../styles/Mail/CampaignBuilder.styles';
import { FiSmartphone, FiMonitor } from 'react-icons/fi';

const EmailPreview = ({ campaign, previewMode, onPreviewModeChange, business }) => {
  const preserveLineBreaks = (content) => String(content || '').replace(/\r\n|\r|\n/g, '<br />');

  const generateEmailHTML = (contentBlocks) => {
    if (!contentBlocks || contentBlocks.length === 0) {
      return `
        <div style="padding: 40px 20px; text-align: center; color: #999; font-style: italic;">
          <p>No content blocks added yet.</p>
          <p>Add content blocks to see your email preview here.</p>
        </div>
      `;
    }

    const blockHTML = contentBlocks.map(block => {
      switch (block.type) {
        case 'text':
          const textContent = preserveLineBreaks(block.content);
          return `
            <p style="
              font-size: ${block.settings.fontSize}; 
              color: ${block.settings.color}; 
              text-align: ${block.settings.textAlign}; 
              line-height: ${block.settings.lineHeight};
              margin: 15px 0;
            ">
              ${textContent}
            </p>
          `;
          
        case 'heading':
          return `
            <${block.settings.level} style="
              font-size: ${block.settings.fontSize}; 
              color: ${block.settings.color}; 
              text-align: ${block.settings.textAlign}; 
              font-weight: ${block.settings.fontWeight};
              margin: 20px 0 10px 0;
            ">
              ${block.content}
            </${block.settings.level}>
          `;
          
        case 'button':
          return `
            <div style="text-align: ${block.settings.textAlign}; margin: 20px 0;">
              <a href="${block.content.url}" style="
                background-color: ${block.settings.backgroundColor}; 
                color: ${block.settings.color}; 
                padding: ${block.settings.padding}; 
                border-radius: ${block.settings.borderRadius}; 
                text-decoration: none; 
                display: inline-block;
                font-weight: bold;
              ">
                ${block.content.text}
              </a>
            </div>
          `;
          
        case 'image':
          const imageHtml = `
            <img src="${block.content.src}" alt="${block.content.alt}" style="
              max-width: ${block.content.width}; 
              width: ${block.content.width}; 
              height: auto; 
              border-radius: ${block.settings.borderRadius};
              display: block;
            " />
          `;
          const imageContent = block.content.url ? 
            `<a href="${block.content.url}">${imageHtml}</a>` : 
            imageHtml;
          return `
            <div style="text-align: ${block.content.alignment}; margin: ${block.settings.margin};">
              ${imageContent}
            </div>
          `;
          
        case 'divider':
          return `
            <hr style="
              border: none; 
              border-top: 1px ${block.content.style} ${block.content.color}; 
              width: ${block.content.width}; 
              margin: ${block.settings.margin};
            " />
          `;
          
        case 'spacer':
          return `
            <div style="
              height: ${block.content.height}; 
              background-color: ${block.settings.backgroundColor};
            "></div>
          `;
          
        case 'social':
          const socialButtons = block.content.platforms
            .filter(platform => platform.enabled && platform.url)
            .map(platform => {
              const socialIcons = {
                facebook: '🔘',
                twitter: '🦆', 
                instagram: '📷',
                linkedin: '💼',
                youtube: '📺',
                website: '🌐'
              };
              return `
                <a href="${platform.url}" style="
                  display: inline-block; 
                  margin: 0 ${parseInt(block.settings.spacing)/2}px; 
                  text-decoration: none; 
                  font-size: ${block.settings.size};
                " title="Visit our ${platform.name}">
                  ${socialIcons[platform.name] || '🔗'}
                </a>
              `;
            }).join('');
          return `
            <div style="text-align: ${block.settings.alignment}; margin: 20px 0;">
              ${socialButtons}
            </div>
          `;
          
        case 'columns':
          return `
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="
                  width: 50%; 
                  padding-right: ${parseInt(block.settings.gap)/2}px; 
                  vertical-align: top;
                ">
                  ${block.content.column1 || 'Left column content...'}
                </td>
                <td style="
                  width: 50%; 
                  padding-left: ${parseInt(block.settings.gap)/2}px; 
                  vertical-align: top;
                ">
                  ${block.content.column2 || 'Right column content...'}
                </td>
              </tr>
            </table>
          `;
          
        default:
          return `
            <div style="
              padding: 20px; 
              text-align: center; 
              color: #999; 
              font-style: italic;
              border: 2px dashed #ddd;
              margin: 10px 0;
            ">
              ${block.type} block preview coming soon...
            </div>
          `;
      }
    }).join('');

    // Replace dynamic fields with sample data
    const processedHTML = blockHTML
      .replace(/\{FirstName\}/g, 'John')
      .replace(/\{\{FirstName\}\}/g, 'John')
      .replace(/\{\{First Name\}\}/g, 'John')
      .replace(/\{LastName\}/g, 'Doe')
      .replace(/\{\{LastName\}\}/g, 'Doe')
      .replace(/\{\{Last Name\}\}/g, 'Doe')
      .replace(/\{FullName\}/g, 'John Doe')
      .replace(/\{\{FullName\}\}/g, 'John Doe')
      .replace(/\{\{Full Name\}\}/g, 'John Doe')
      .replace(/\{Email\}/g, 'john@example.com')
      .replace(/\{\{Email\}\}/g, 'john@example.com')
      .replace(/\{\{Email Address\}\}/g, 'john@example.com')
      .replace(/\{\{LoyaltyPoints\}\}/g, '245')
      .replace(/\{\{Loyalty Points\}\}/g, '245');

    return processedHTML;
  };

  const getEmailHTML = () => {
    const contentHTML = generateEmailHTML(campaign.content_blocks);
    const businessName = business?.name || 'Your Business Name';
    const businessAddress = 'Your Business Address - Required for CASL Compliance';

    return `
      <div style="
        max-width: 600px; 
        margin: 0 auto; 
        background-color: white; 
        font-family: Arial, sans-serif;
        line-height: 1.6;
      ">
        <!-- Email Header -->
        <div style="
          background-color: #f8f8f8; 
          padding: 10px 20px; 
          border-bottom: 1px solid #ddd;
          text-align: center;
          font-size: 12px;
          color: #666;
        ">
          ${campaign.preheader_text || 'Email preview text appears here...'}
        </div>

        <!-- Email Content -->
        <div style="padding: 30px 20px;">
          ${contentHTML}
        </div>

        <!-- Email Footer -->
        <div style="
          background-color: #f8f8f8; 
          padding: 20px; 
          border-top: 1px solid #ddd;
          font-size: 12px; 
          color: #666; 
          text-align: center;
        ">
          <p style="margin: 0 0 10px 0;">
            You received this email because you subscribed to our mailing list.
          </p>
          <p style="margin: 0 0 10px 0;">
            <strong>${businessName}</strong><br>
            ${businessAddress}
          </p>
          <p style="margin: 0;">
            <a href="#" style="color: #666; text-decoration: underline;">Unsubscribe</a> | 
            <a href="#" style="color: #666; text-decoration: underline;">Update Preferences</a>
          </p>
        </div>
      </div>
    `;
  };

  return (
    <div style={styles.emailPreview}>
      {/* Preview Header - Changed to show title above toggle buttons */}
      <div style={styles.previewHeader}>
        <h3 style={styles.sectionTitle}>
          Preview ({previewMode === 'desktop' ? 'Desktop' : 'Mobile'})
        </h3>
        <div style={styles.previewToggle}>
          <button
            style={{
              ...styles.toggleButton,
              ...(previewMode === 'desktop' ? styles.activeToggle : {})
            }}
            onClick={() => onPreviewModeChange('desktop')}
          >
            <FiMonitor style={styles.buttonIcon} />
            Desktop
          </button>
          <button
            style={{
              ...styles.toggleButton,
              ...(previewMode === 'mobile' ? styles.activeToggle : {})
            }}
            onClick={() => onPreviewModeChange('mobile')}
          >
            <FiSmartphone style={styles.buttonIcon} />
            Mobile
          </button>
        </div>
      </div>

      {/* Subject Line Preview */}
      {campaign.subject_line && (
        <div style={styles.subjectPreview}>
          <div style={styles.subjectLabel}>Subject:</div>
          <div style={styles.subjectText}>{campaign.subject_line}</div>
        </div>
      )}

      {/* Email Preview Container */}
      <div style={styles.previewContainer}>
        <div 
          style={{
            ...styles.emailPreviewFrame,
            ...(previewMode === 'mobile' ? styles.mobilePreview : {})
          }}
          dangerouslySetInnerHTML={{ __html: getEmailHTML() }}
        />
      </div>

      {/* Preview Info */}
      <div style={styles.previewInfo}>
        <div style={styles.infoItem}>
          <strong>Content Blocks:</strong> {campaign.content_blocks?.length || 0}
        </div>
        <div style={styles.infoItem}>
          <strong>Preview Mode:</strong> {previewMode === 'mobile' ? 'Mobile (320px)' : 'Desktop (600px)'}
        </div>
        {campaign.preheader_text && (
          <div style={styles.infoItem}>
            <strong>Preheader:</strong> {campaign.preheader_text.substring(0, 50)}
            {campaign.preheader_text.length > 50 ? '...' : ''}
          </div>
        )}
      </div>
    </div>
  );
};

// Additional styles for EmailPreview
const additionalStyles = {
  subjectPreview: {
    backgroundColor: '#f8f8f8',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  subjectLabel: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
    minWidth: '60px',
  },
  subjectText: {
    fontSize: '14px',
    color: '#333',
    flex: 1,
  },
  emailPreviewFrame: {
    backgroundColor: 'white',
    borderRadius: '4px',
    overflow: 'hidden',
    width: '100%',
    maxWidth: '600px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    margin: '0 auto',
  },
  previewInfo: {
    marginTop: '15px',
    padding: '12px',
    backgroundColor: '#f8f8f8',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#666',
  },
  infoItem: {
    marginBottom: '5px',
  },
  // Modified previewHeader to stack elements vertically
  previewHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '20px',
    alignItems: 'flex-start',
  },
};

// Merge additional styles with existing styles
Object.assign(styles, additionalStyles);

export default EmailPreview;