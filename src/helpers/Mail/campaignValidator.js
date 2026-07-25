// helpers/Mail/campaignValidator.js - Production Ready Version (FIXED)

// Core validation function
export const validateCampaign = (campaign, contacts = [], segments = []) => {
  const errors = [];
  const warnings = [];
  
  // Basic required fields
  if (!campaign.name?.trim()) {
    errors.push('Campaign name is required');
  } else if (campaign.name.length < 3) {
    errors.push('Campaign name must be at least 3 characters');
  } else if (campaign.name.length > 100) {
    errors.push('Campaign name must be less than 100 characters');
  }
  
  if (!campaign.subject_line?.trim()) {
    errors.push('Subject line is required');
  } else if (campaign.subject_line.length > 78) {
    warnings.push('Subject line over 78 characters may be truncated in some email clients');
  }
  
  // Content validation
  if (!campaign.content_blocks || campaign.content_blocks.length === 0) {
    errors.push('Campaign must have at least one content block');
  } else {
    // Validate content blocks
    const contentValidation = validateContentBlocks(campaign.content_blocks);
    errors.push(...contentValidation.errors);
    warnings.push(...contentValidation.warnings);
  }
  
  // Compliance validation (UPDATED - no manual unsubscribe check)
  const complianceValidation = validateCompliance(campaign);
  errors.push(...complianceValidation.errors);
  warnings.push(...complianceValidation.warnings);
  
  // Recipient validation
  const recipientValidation = validateRecipients(campaign, contacts, segments);
  errors.push(...recipientValidation.errors);
  warnings.push(...recipientValidation.warnings);
  
  // Technical validation
  const technicalValidation = validateTechnicalRequirements(campaign);
  errors.push(...technicalValidation.errors);
  warnings.push(...technicalValidation.warnings);
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    score: calculateCampaignScore(campaign, errors, warnings)
  };
};

// Validate content blocks structure and content
export const validateContentBlocks = (contentBlocks) => {
  const errors = [];
  const warnings = [];
  
  if (!Array.isArray(contentBlocks)) {
    errors.push('Content blocks must be an array');
    return { errors, warnings };
  }
  
  let hasContent = false;
  let totalContentLength = 0;
  
  contentBlocks.forEach((block, index) => {
    // Block structure validation
    if (!block.type) {
      errors.push(`Content block ${index + 1} is missing a type`);
      return;
    }
    
    if (!block.content) {
      errors.push(`Content block ${index + 1} is missing content`);
      return;
    }
    
    // Type-specific validation
    switch (block.type) {
      case 'text':
        if (typeof block.content !== 'string' || !block.content.trim()) {
          errors.push(`Text block ${index + 1} must have text content`);
        } else {
          hasContent = true;
          totalContentLength += block.content.length;
          
          // Check for excessive length
          if (block.content.length > 5000) {
            warnings.push(`Text block ${index + 1} is very long (${block.content.length} characters)`);
          }
        }
        break;
        
      case 'image':
        if (!block.content.src) {
          errors.push(`Image block ${index + 1} must have a source URL`);
        } else {
          hasContent = true;
          // Validate image URL format
          if (!isValidImageUrl(block.content.src)) {
            warnings.push(`Image block ${index + 1} may have an invalid image URL`);
          }
        }
        
        if (!block.content.alt) {
          warnings.push(`Image block ${index + 1} should have alt text for accessibility`);
        }
        break;
        
      case 'button':
        if (!block.content.text?.trim()) {
          errors.push(`Button block ${index + 1} must have button text`);
        }
        
        if (!block.content.url) {
          errors.push(`Button block ${index + 1} must have a URL`);
        } else if (!isValidUrl(block.content.url)) {
          warnings.push(`Button block ${index + 1} may have an invalid URL`);
        }
        
        hasContent = true;
        break;
        
      case 'divider':
        hasContent = true; // Dividers count as content
        break;
        
      case 'social':
        if (!block.content.links || Object.keys(block.content.links).length === 0) {
          warnings.push(`Social block ${index + 1} has no social media links`);
        } else {
          hasContent = true;
          // Validate social media URLs
          Object.entries(block.content.links).forEach(([platform, url]) => {
            if (url && !isValidUrl(url)) {
              warnings.push(`Social block ${index + 1} has invalid ${platform} URL`);
            }
          });
        }
        break;
        
      default:
        warnings.push(`Content block ${index + 1} has unknown type: ${block.type}`);
    }
  });
  
  if (!hasContent) {
    errors.push('Campaign must have at least one content block with actual content');
  }
  
  // Content length warnings
  if (totalContentLength > 15000) {
    warnings.push('Campaign content is very long and may be truncated by some email clients');
  } else if (totalContentLength < 100) {
    warnings.push('Campaign content is very short - consider adding more value for subscribers');
  }
  
  return { errors, warnings };
};

// FIXED: Validate compliance requirements (NO MANUAL UNSUBSCRIBE CHECK)
export const validateCompliance = (campaign) => {
  const errors = [];
  const warnings = [];
  
  // REMOVED: Manual unsubscribe link check - system auto-injects compliant footers
  // The email sending service automatically adds CASL-compliant unsubscribe links to every email
  
  // Check for business address info message (optional)
  const hasBusinessAddress = campaign.content_blocks?.some(block => {
    if (block.type === 'text' && typeof block.content === 'string') {
      return block.content.includes('{BusinessAddress}') ||
             /\d+\s+\w+/.test(block.content); // Basic address pattern
    }
    return false;
  });
  
  if (!hasBusinessAddress) {
    // This is now just an info message, not a warning
    // The system will auto-inject the business address from settings
  }
  
  // Check for sender identification (optional improvement)
  const hasSenderInfo = campaign.content_blocks?.some(block => {
    if (block.type === 'text' && typeof block.content === 'string') {
      return block.content.includes('{BusinessName}') ||
             block.content.includes('{FromName}');
    }
    return false;
  });
  
  if (!hasSenderInfo) {
    warnings.push('Consider adding sender identification (use {BusinessName} or {FromName} tokens)');
  }
  
  return { errors, warnings };
};

// Validate recipient selection and contact data
export const validateRecipients = (campaign, contacts, segments) => {
  const errors = [];
  const warnings = [];
  
  if (!contacts || contacts.length === 0) {
    errors.push('No contacts available to send to');
    return { errors, warnings };
  }
  
  const subscribedContacts = contacts.filter(c => c.subscribed && !c.bounced);
  
  if (subscribedContacts.length === 0) {
    errors.push('No subscribed contacts available to send to');
    return { errors, warnings };
  }
  
  // Validate segment selection if applicable
  if (campaign.target_segment) {
    const selectedSegment = segments.find(s => s.id === campaign.target_segment);
    
    if (!selectedSegment) {
      errors.push('Selected segment no longer exists');
    } else if (selectedSegment.contact_count === 0) {
      errors.push(`Selected segment "${selectedSegment.name}" has no contacts`);
    } else if (selectedSegment.contact_count < 5) {
      warnings.push(`Selected segment "${selectedSegment.name}" has very few contacts (${selectedSegment.contact_count})`);
    }
  }
  
  // Check for bounced email rate
  const bouncedCount = contacts.filter(c => c.bounced).length;
  const bounceRate = contacts.length > 0 ? (bouncedCount / contacts.length) * 100 : 0;
  
  if (bounceRate > 10) {
    warnings.push(`High bounce rate detected (${bounceRate.toFixed(1)}%) - consider cleaning your contact list`);
  }
  
  // Check for recent engagement
  const engagedContacts = contacts.filter(c => c.last_engagement_at && 
    new Date(c.last_engagement_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  );
  
  const engagementRate = subscribedContacts.length > 0 ? 
    (engagedContacts.length / subscribedContacts.length) * 100 : 0;
  
  if (engagementRate < 10 && subscribedContacts.length > 50) {
    warnings.push('Low recent engagement rate - consider segmenting to more engaged subscribers');
  }
  
  return { errors, warnings };
};

// Validate technical requirements
export const validateTechnicalRequirements = (campaign) => {
  const errors = [];
  const warnings = [];
  
  // Check for dynamic field usage
  const dynamicFields = [
    '{FirstName}',
    '{{FirstName}}',
    '{{First Name}}',
    '{LastName}',
    '{{LastName}}',
    '{{Last Name}}',
    '{Email}',
    '{{Email}}',
    '{{Email Address}}',
    '{BusinessName}',
    '{{BusinessName}}',
    '{{Business Name}}'
  ];
  const contentString = JSON.stringify(campaign.content_blocks || []);
  
  let usesDynamicFields = false;
  dynamicFields.forEach(field => {
    if (contentString.includes(field)) {
      usesDynamicFields = true;
    }
  });
  
  if (!usesDynamicFields) {
    warnings.push('Consider using merge fields like {{First Name}} to personalize your emails');
  }
  
  // Check for mobile responsiveness indicators
  const hasResponsiveBlocks = campaign.content_blocks?.some(block => {
    return block.type === 'image' && block.content?.responsive !== false;
  });
  
  if (!hasResponsiveBlocks && campaign.content_blocks?.some(b => b.type === 'image')) {
    warnings.push('Ensure images are optimized for mobile devices');
  }
  
  // Check for accessibility
  const hasAltText = campaign.content_blocks?.every(block => {
    if (block.type === 'image') {
      return block.content?.alt && block.content.alt.trim().length > 0;
    }
    return true;
  });
  
  if (!hasAltText) {
    warnings.push('Add alt text to all images for better accessibility');
  }
  
  return { errors, warnings };
};

// Calculate campaign quality score
export const calculateCampaignScore = (campaign, errors, warnings) => {
  if (errors.length > 0) return 0;
  
  let score = 100;
  
  // Deduct points for warnings
  score -= warnings.length * 5;
  
  // Bonus points for good practices
  const contentString = JSON.stringify(campaign.content_blocks || []);
  
  // Personalization bonus
  if (
    contentString.includes('{FirstName}') ||
    contentString.includes('{{FirstName}}') ||
    contentString.includes('{{First Name}}') ||
    contentString.includes('{LastName}') ||
    contentString.includes('{{LastName}}') ||
    contentString.includes('{{Last Name}}')
  ) {
    score += 10;
  }
  
  // Content variety bonus
  const blockTypes = new Set(campaign.content_blocks?.map(b => b.type) || []);
  if (blockTypes.size >= 3) {
    score += 5;
  }
  
  // Subject line optimization bonus
  if (campaign.subject_line && campaign.subject_line.length >= 30 && campaign.subject_line.length <= 50) {
    score += 5;
  }
  
  // Preheader bonus
  if (campaign.preheader_text && campaign.preheader_text.trim().length > 0) {
    score += 5;
  }
  
  // Auto-compliance bonus (since system handles it automatically)
  score += 10;
  
  return Math.max(0, Math.min(100, score));
};

// Utility functions
export const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const isValidImageUrl = (url) => {
  if (!isValidUrl(url)) return false;
  
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  const urlLower = url.toLowerCase();
  
  return imageExtensions.some(ext => urlLower.includes(ext)) ||
         urlLower.includes('image') ||
         urlLower.includes('img') ||
         urlLower.includes('unsplash') ||
         urlLower.includes('cloudinary');
};

// UPDATED: Pre-send validation (stricter than draft validation, no manual unsubscribe check)
export const validateForSending = (campaign, contacts, segments, businessSettings) => {
  const baseValidation = validateCampaign(campaign, contacts, segments);
  const errors = [...baseValidation.errors];
  const warnings = [...baseValidation.warnings];
  
  // Additional sending requirements
  if (!businessSettings?.from_email) {
    errors.push('Business sender email is not configured');
  }
  
  if (!businessSettings?.business_address || businessSettings.business_address.includes('Required')) {
    errors.push('Business address must be configured in Mail Settings for CASL compliance');
  }
  
  // Check for test sends
  if (!campaign.test_sent) {
    warnings.push('Consider sending a test email before sending to all contacts');
  }
  
  // Validate sending limits
  const recipientCount = campaign.target_segment ? 
    (segments.find(s => s.id === campaign.target_segment)?.contact_count || 0) :
    contacts.filter(c => c.subscribed && !c.bounced).length;
  
  if (recipientCount > 10000) {
    warnings.push('Large recipient count - consider segmenting for better deliverability');
  }
  
  if (recipientCount === 0) {
    errors.push('No recipients to send to');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    canSend: errors.length === 0,
    score: baseValidation.score,
    autoCompliance: true // System handles compliance automatically
  };
};

// Quick validation for UI updates
export const quickValidate = (campaign) => {
  const hasName = campaign.name?.trim().length > 0;
  const hasSubject = campaign.subject_line?.trim().length > 0;
  const hasContent = campaign.content_blocks?.length > 0;
  
  return {
    hasName,
    hasSubject,
    hasContent,
    isBasicallyValid: hasName && hasSubject && hasContent,
    completionPercentage: ((hasName ? 1 : 0) + (hasSubject ? 1 : 0) + (hasContent ? 1 : 0)) / 3 * 100,
    autoCompliant: true // System handles compliance automatically
  };
};