// components/HR/PolicyCreationModal.jsx
import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Plus, Trash2, Upload } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  generatePolicyHtmlDocument,
  buildPolicyPlainTextContent,
  normalizePolicyCategoriesFromDb
} from '../../utils/policyDocumentGenerator';

const PolicyCreationModal = ({ isOpen, onClose, onSave, policy, businessId, authUser, isNewVersion = false, policyTypes = [], policyCategories = [], onCategoriesUpdated }) => {
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [autoSaveTimeout, setAutoSaveTimeout] = useState(null);
  const [autoSavedPolicyId, setAutoSavedPolicyId] = useState(null); // Track policy ID from auto-save
  const [showVersionUpdateModal, setShowVersionUpdateModal] = useState(false);
  const [versionUpdateData, setVersionUpdateData] = useState({
    updateDescription: '',
    isMajorUpdate: false
  });
  const [pendingSaveData, setPendingSaveData] = useState(null); // Store save data while showing version modal
  const txtFileInputRef = useRef(null);
  const [txtUploadFileName, setTxtUploadFileName] = useState(null);
  const [newlyCreatedCategories, setNewlyCreatedCategories] = useState([]); // Categories created from .txt upload (so we can resolve by id)
  const allCategories = React.useMemo(
    () => [...(policyCategories || []), ...(newlyCreatedCategories || [])],
    [policyCategories, newlyCreatedCategories]
  );
  const [formData, setFormData] = useState({
    policy_name: '',
    policy_version: '1.0',
    policy_type: '',
    selected_categories: [], // Array of objects: { categoryId: 'uuid', categoryContent: 'text', subContents: [{ id: 'uuid', content: 'text' }] }
    status: 'draft',
    effective_date: '',
    revised_date: '',
    expiry_date: '',
    requires_acknowledgment: true,
    acknowledgment_deadline_days: 30
  });

  // Reset auto-saved policy ID when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setTxtUploadFileName(null);
      setNewlyCreatedCategories([]);
      // Reset auto-saved policy ID when opening modal
      setAutoSavedPolicyId(policy?.id || null);
      // Reset version update data
      setVersionUpdateData({ updateDescription: '', isMajorUpdate: false });
      setPendingSaveData(null);
    } else {
      // Clear when modal closes
      setAutoSavedPolicyId(null);
      setVersionUpdateData({ updateDescription: '', isMajorUpdate: false });
      setPendingSaveData(null);
    }
  }, [isOpen, policy?.id]);

  // Load policy data if editing
  useEffect(() => {
    if (isOpen) {
      if (policy) {
        const categories = normalizePolicyCategoriesFromDb(policy.policy_categories);

        setFormData({
          policy_name: policy.policy_name || '',
          policy_version: policy.policy_version || '1.0',
          policy_type: policy.policy_type || '',
          selected_categories: categories,
          status: policy.status || 'draft',
          effective_date: policy.effective_date ? policy.effective_date.split('T')[0] : '',
          revised_date: policy.revised_date ? policy.revised_date.split('T')[0] : '',
          expiry_date: policy.expiry_date ? policy.expiry_date.split('T')[0] : '',
          requires_acknowledgment: policy.requires_acknowledgment !== false,
          acknowledgment_deadline_days: policy.acknowledgment_deadline_days || 30
        });
      } else {
        // Reset form for new policy
        setFormData({
          policy_name: '',
          policy_version: '1.0',
          policy_type: '',
          selected_categories: [],
          status: 'draft',
          effective_date: '',
          revised_date: '',
          expiry_date: '',
          requires_acknowledgment: true,
          acknowledgment_deadline_days: 30
        });
      }
    }
  }, [isOpen, policy]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    triggerAutoSave();
  };

  const isRevisedDateColumnMissing = (err) => err?.code === 'PGRST204' && String(err?.message || '').includes('revised_date');

  // Auto-save functionality (debounced, not aggressive)
  const triggerAutoSave = () => {
    // Clear existing timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    // Auto-save works for both new and existing policies
    // For new policies, we need at least a policy name
    if (!formData.policy_name.trim() || !businessId) {
      return;
    }

    // Set new timeout - wait 3 seconds after user stops typing
    const timeout = setTimeout(async () => {
      await performAutoSave();
    }, 3000);

    setAutoSaveTimeout(timeout);
  };

  const performAutoSave = async (isDraft = true) => {
    if (!businessId || !formData.policy_name.trim()) {
      return;
    }

    setAutoSaving(true);
    try {
      // Get business name and branding for HTML generation
      // Select all fields to avoid column name issues
      const { data: businessData } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .single();

      const businessName = businessData?.business_name || businessData?.name || 'Company';

      const { data: brandingData } = await supabase
        .from('app_branding')
        .select('primary_color, logo_url')
        .eq('business_id', businessId)
        .maybeSingle();

      // Generate policy content and HTML (even if incomplete)
      const policyContent = buildPolicyPlainTextContent(formData.selected_categories || [], allCategories);
      const policyHTML = generatePolicyHtmlDocument({
        policyName: formData.policy_name,
        businessName,
        brandingData,
        digitalSignature: null,
        policyNumber: policy?.policy_number || null,
        versionNumber: policy?.policy_version || formData.policy_version,
        effectiveDate: formData.effective_date,
        revisedDate: formData.revised_date,
        selectedCategories: formData.selected_categories || [],
        policyCategories: allCategories
      });

      // Use policy ID from prop, or from auto-save if we've already created one
      const currentPolicyId = policy?.id || autoSavedPolicyId;

      if (currentPolicyId) {
        const updatePayload = {
          policy_name: formData.policy_name.trim(),
          policy_content: policyContent,
          policy_html: policyHTML,
          policy_categories: formData.selected_categories || [],
          status: isDraft ? 'draft' : formData.status,
          effective_date: formData.effective_date || null,
          revised_date: formData.revised_date || null,
          expiry_date: formData.expiry_date || null,
          updated_by: authUser?.id || null,
          updated_at: new Date().toISOString()
        };
        let { error } = await supabase.from('hr_policies').update(updatePayload).eq('id', currentPolicyId);
        if (error && isRevisedDateColumnMissing(error)) {
          const { revised_date: _r, ...payloadWithoutRevised } = updatePayload;
          const res = await supabase.from('hr_policies').update(payloadWithoutRevised).eq('id', currentPolicyId);
          if (res.error) throw res.error;
        } else if (error) throw error;
      } else {
        // Create new policy as draft
        // Generate policy number using format: [category_number].[policy_number].[version]
        // Format: 01.01.01 where:
        //   First number = category number (from first category's display_order)
        //   Second number = policy number within that category (sequential)
        //   Third number = version number (from policy_version)
        let policyNumber = null;
        
        // Get first category from selected_categories
        const firstCategory = formData.selected_categories && formData.selected_categories.length > 0
          ? formData.selected_categories[0]
          : null;
        
        if (firstCategory && firstCategory.categoryId) {
          try {
            // Find the category to get its display_order
            const category = policyCategories.find(cat => cat.id === firstCategory.categoryId);
            if (category) {
              const categoryNumber = category.display_order || 1;
              
              // Get version number from policy_version (default to 1)
              const versionMatch = formData.policy_version?.match(/^(\d+)/);
              const versionNumber = versionMatch ? parseInt(versionMatch[1], 10) : 1;
              
              // Count existing policies with the same first category
              const { data: existingPolicies, error: policyNumError } = await supabase
                .from('hr_policies')
                .select('policy_number, policy_categories')
                .eq('business_id', businessId)
                .not('policy_number', 'is', null);
              
              // If column doesn't exist, skip policy number generation
              if (policyNumError && policyNumError.code === 'PGRST204') {
                console.warn('policy_number column does not exist yet, skipping policy number generation');
              } else if (!policyNumError && existingPolicies) {
                // Filter policies that have the same first category
                const sameCategoryPolicies = existingPolicies.filter(p => {
                  if (!p.policy_categories || !Array.isArray(p.policy_categories) || p.policy_categories.length === 0) {
                    return false;
                  }
                  const firstCat = Array.isArray(p.policy_categories) 
                    ? (p.policy_categories[0]?.categoryId || p.policy_categories[0])
                    : null;
                  return firstCat === firstCategory.categoryId;
                });
                
                // Get the highest policy number sequence for this category
                let nextSequence = 1;
                if (sameCategoryPolicies.length > 0) {
                  const sequences = sameCategoryPolicies
                    .map(p => {
                      if (!p.policy_number) return 0;
                      // Parse format: category.policy.version
                      const parts = p.policy_number.split('.');
                      if (parts.length >= 2) {
                        return parseInt(parts[1], 10) || 0;
                      }
                      return 0;
                    })
                    .filter(s => s > 0);
                  
                  if (sequences.length > 0) {
                    nextSequence = Math.max(...sequences) + 1;
                  }
                }
                
                // Format: category.policy.version (all padded to 2 digits)
                policyNumber = `${String(categoryNumber).padStart(2, '0')}.${String(nextSequence).padStart(2, '0')}.${String(versionNumber).padStart(2, '0')}`;
              }
            }
          } catch (err) {
            // Column doesn't exist or error, skip policy number
            console.warn('Could not generate policy number:', err);
          }
        } else {
          // No category selected - use category 00
          try {
            const versionMatch = formData.policy_version?.match(/^(\d+)/);
            const versionNumber = versionMatch ? parseInt(versionMatch[1], 10) : 1;
            
            // Count policies without categories
            const { data: existingPolicies, error: policyNumError } = await supabase
              .from('hr_policies')
              .select('policy_number, policy_categories')
              .eq('business_id', businessId)
              .or('policy_categories.is.null,policy_categories.eq.[]');
            
            if (!policyNumError && existingPolicies) {
              const nextSequence = existingPolicies.length + 1;
              policyNumber = `00.${String(nextSequence).padStart(2, '0')}.${String(versionNumber).padStart(2, '0')}`;
            }
          } catch (err) {
            console.warn('Could not generate policy number for uncategorized policy:', err);
          }
        }

        const insertData = {
          business_id: businessId,
          policy_name: formData.policy_name.trim(),
          policy_version: formData.policy_version.trim(),
          policy_type: formData.policy_type.trim() || null,
          policy_content: policyContent,
          policy_html: policyHTML,
          policy_categories: formData.selected_categories || [],
          status: 'draft',
          effective_date: formData.effective_date || null,
          revised_date: formData.revised_date || null,
          expiry_date: formData.expiry_date || null,
          requires_acknowledgment: formData.requires_acknowledgment,
          acknowledgment_deadline_days: formData.acknowledgment_deadline_days,
          created_by: authUser?.id || null,
          updated_by: authUser?.id || null,
          is_current_version: true
        };

        // Only include policy_number if it's not null (column may not exist yet)
        if (policyNumber !== null) {
          insertData.policy_number = policyNumber;
        }

        const { data: newPolicy, error } = await supabase
          .from('hr_policies')
          .insert(insertData)
          .select()
          .single();

        if (error) throw error;
        
        // Store the policy ID so future auto-saves will update instead of create
        // Don't call onSave for auto-save as it might close the modal
        if (newPolicy?.id) {
          setAutoSavedPolicyId(newPolicy.id);
        }
      }

      setLastSaved(new Date());
    } catch (error) {
      console.error('Error auto-saving policy:', error);
      // Don't show error toast for auto-save failures to avoid being annoying
    } finally {
      setAutoSaving(false);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }
    };
  }, [autoSaveTimeout]);

  // Parse uploaded .txt: only "N. Title" starts a section; any "N.M. Title" or "N.M Title" is a sub-section of N (never a top-level section).
  const parsePolicyTxt = (text) => {
    const sections = [];
    const lines = text.split(/\r?\n/);
    const isSubSectionLine = (line) => /^\d+\.\d+\.?\s+/.test(line); // e.g. 1.1. or 1.1 (optional dot, then space)
    const matchSubSection = (line) => line.match(/^(\d+)\.(\d+)\.?\s+(.*)$/); // N.M. or N.M then rest
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isSubSectionLine(line)) {
        const subMatch = matchSubSection(line);
        if (subMatch) {
          const subNum = parseInt(subMatch[1], 10);
          const subTitle = subMatch[3].trim();
          const subItem = { id: `sub-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`, content: subTitle };
          const existing = sections.find((s) => s.number === subNum);
          if (existing) {
            existing.subItems.push(subItem);
          } else {
            sections.push({ number: subNum, title: '', content: '', subItems: [subItem] });
          }
        }
        i++;
        continue;
      }
      const headerMatch = line.match(/^(\d+)\.\s+(.+)$/);
      if (!headerMatch) { i++; continue; }
      const num = parseInt(headerMatch[1], 10);
      const title = headerMatch[2].trim();
      i++;
      const contentLines = [];
      const subItems = [];
      while (i < lines.length) {
        const curr = lines[i];
        const subMatch = matchSubSection(curr);
        if (subMatch && parseInt(subMatch[1], 10) === num) {
          subItems.push({ id: `sub-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`, content: subMatch[3].trim() });
          i++;
          continue;
        }
        if (isSubSectionLine(curr)) break;
        const nextSection = curr.match(/^(\d+)\.\s+(.+)$/);
        if (nextSection) break;
        contentLines.push(curr);
        i++;
      }
      const existing = sections.find((s) => s.number === num);
      const content = contentLines.join('\n').trim();
      if (existing) {
        existing.title = title;
        existing.content = content;
        existing.subItems = [...existing.subItems, ...subItems];
      } else {
        sections.push({ number: num, title, content, subItems });
      }
    }
    sections.sort((a, b) => a.number - b.number);
    return sections;
  };

  const handleTxtUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      toast.error('Please upload a .txt file (same format as the policy TXT download).');
      e.target.value = '';
      return;
    }
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'UTF-8');
    });
    try {
      const sections = parsePolicyTxt(text);
      if (sections.length === 0) {
        toast.error('No sections found. Use format: "1. Section Title" then content, and optional "1.1. Sub item" lines.');
        e.target.value = '';
        return;
      }
      const current = formData.selected_categories || [];
      const categoriesToUse = [...allCategories];

      if (current.length === 0) {
        // Brand new policy: create or match categories from section titles, then build selected_categories with content and sub-contents
        const created = [];
        const selected = [];
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const title = (section.title || '').trim() || `Section ${section.number}`;
          let category = categoriesToUse.find(c => (c.category_name || '').toLowerCase() === title.toLowerCase());
          if (!category && businessId) {
            const { data: newCat, error } = await supabase
              .from('hr_policy_categories')
              .insert({
                business_id: businessId,
                category_name: title,
                is_active: true,
                display_order: (categoriesToUse.length + created.length) + 1
              })
              .select()
              .single();
            if (error) {
              if (error.code === '23505') {
                const { data: existing } = await supabase
                  .from('hr_policy_categories')
                  .select('*')
                  .eq('business_id', businessId)
                  .ilike('category_name', title)
                  .limit(1)
                  .maybeSingle();
                if (existing) {
                  category = existing;
                  categoriesToUse.push(existing);
                }
              }
              if (!category) {
                toast.error(`Could not create category "${title}": ${error.message}`);
                e.target.value = '';
                return;
              }
            } else if (newCat) {
              category = newCat;
              created.push(newCat);
              categoriesToUse.push(newCat);
            }
          }
          if (!category) {
            toast.error(`No category found or created for "${title}". Add a category in Manage Categories or use an existing one.`);
            e.target.value = '';
            return;
          }
          selected.push({
            categoryId: category.id,
            categoryContent: section.content,
            subContents: (section.subItems || []).map((sub, idx) => ({
              id: sub.id || `sub-${Date.now()}-${i}-${idx}`,
              content: sub.content || ''
            }))
          });
        }
        if (created.length > 0) {
          setNewlyCreatedCategories(prev => [...prev, ...created]);
          if (onCategoriesUpdated) onCategoriesUpdated();
        }
        handleInputChange('selected_categories', selected);
        setTxtUploadFileName(file.name);
        toast.success(`Imported ${sections.length} section(s) from ${file.name}. ${created.length > 0 ? `Created ${created.length} new categor${created.length === 1 ? 'y' : 'ies'}.` : ''}`);
      } else {
        // Existing selection: fill content in order
        const updated = current.map((item, idx) => {
          const section = sections[idx];
          if (!section) return item;
          return {
            ...item,
            categoryContent: section.content,
            subContents: section.subItems.length > 0 ? section.subItems.map((sub, si) => ({ id: sub.id || `sub-${Date.now()}-${idx}-${si}`, content: sub.content || '' })) : (item.subContents || [])
          };
        });
        handleInputChange('selected_categories', updated);
        setTxtUploadFileName(file.name);
        toast.success(`Imported ${sections.length} section(s) from ${file.name}`);
      }
    } catch (err) {
      toast.error('Failed to parse .txt file. Use the same format as the downloaded policy TXT.');
    }
    e.target.value = '';
  };


  const handleSave = async (saveAsDraft = false) => {
    // Basic validation - policy name is always required
    if (!formData.policy_name.trim()) {
      toast.error('Policy name is required');
      return;
    }

    if (!businessId) {
      toast.error('Business ID is required');
      return;
    }

    // If not saving as draft, validate completeness
    if (!saveAsDraft) {
      // Validate that at least one category is selected with content
      if (!formData.selected_categories || formData.selected_categories.length === 0) {
        toast.error('Please select at least one category');
        return;
      }

      // Validate that each selected category has content
      const categoriesWithoutContent = formData.selected_categories.filter(item => {
        const hasCategoryContent = item.categoryContent && item.categoryContent.trim();
        const hasSubContents = item.subContents && Array.isArray(item.subContents) && item.subContents.some(sub => sub.content && sub.content.trim());
        return !hasCategoryContent && !hasSubContents;
      });

      if (categoriesWithoutContent.length > 0) {
        const categoryNames = categoriesWithoutContent.map(item => {
          const category = policyCategories.find(cat => cat.id === item.categoryId);
          return category ? category.category_name : 'Unknown';
        }).join(', ');
        toast.error(`Please add content to the following categories: ${categoryNames}`);
        return;
      }
    }

    // Check if policy is active - if so, must create new version
    console.log('🔍 Policy status check:', {
      policyStatus: policy?.status,
      saveAsDraft,
      isNewVersion,
      policyId: policy?.id,
      shouldShowModal: policy?.status === 'active' && !saveAsDraft && !isNewVersion
    });
    
    if (policy?.status === 'active' && !saveAsDraft && !isNewVersion) {
      console.log('✅ Showing version update modal');
      // Store the save data and show version update modal
      setPendingSaveData({ saveAsDraft });
      setShowVersionUpdateModal(true);
      return;
    }
    
    console.log('➡️ Proceeding with normal save');

    // Proceed with save
    await performSave(saveAsDraft);
  };

  const handleVersionUpdateConfirm = async () => {
    if (!versionUpdateData.updateDescription.trim()) {
      toast.error('Please describe what was updated');
      return;
    }

    setShowVersionUpdateModal(false);
    await performSave(pendingSaveData?.saveAsDraft || false);
  };

  const performSave = async (saveAsDraft = false) => {
    setSaving(true);
    try {
      // Get business name and branding for HTML generation
      // Select all fields to avoid column name issues
      const { data: businessData } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .single();

      const businessName = businessData?.business_name || businessData?.name || 'Company';

      // Get branding data (logo and colors)
      const { data: brandingData } = await supabase
        .from('app_branding')
        .select('primary_color, logo_url')
        .eq('business_id', businessId)
        .maybeSingle();

      // If policy is active, we must create a new version
      // Note: This check should have been caught earlier in handleSave, but we keep it here as a safety check
      const isActivePolicy = policy?.status === 'active' && !saveAsDraft && !isNewVersion;
      const shouldCreateNewVersion = isActivePolicy || isNewVersion;
      
      // If we're here and policy is active, it means we're creating a new version (modal was shown)
      // Use the version update data if available

      // Generate policy number if creating new policy (not editing existing)
      let policyNumber = policy?.policy_number || null;
      let newVersionNumber = formData.policy_version;
      
      if (shouldCreateNewVersion && policy) {
        // Calculate new version number based on major/minor update
        const currentVersion = policy.policy_version || '1.0';
        const versionParts = currentVersion.split('.');
        const major = parseInt(versionParts[0] || '1', 10);
        const minor = parseInt(versionParts[1] || '0', 10);
        
        // Use versionUpdateData if available (from modal), otherwise default to minor
        const isMajor = versionUpdateData.updateDescription ? versionUpdateData.isMajorUpdate : false;
        
        if (isMajor) {
          // Major update: increment major version, reset minor
          newVersionNumber = `${major + 1}.0`;
        } else {
          // Minor update: increment minor version
          newVersionNumber = `${major}.${minor + 1}`;
        }
      }
      
      // Generate policy number using category-based format if not already set
      if (!policyNumber && !policy?.id) {
        // Get first category from selected_categories
        const firstCategory = formData.selected_categories && formData.selected_categories.length > 0
          ? formData.selected_categories[0]
          : null;
        
        if (firstCategory && firstCategory.categoryId) {
          try {
            // Find the category to get its display_order
            const category = policyCategories.find(cat => cat.id === firstCategory.categoryId);
            if (category) {
              const categoryNumber = category.display_order || 1;
              
              // Get version number from policy_version (default to 1)
              const versionMatch = newVersionNumber?.match(/^(\d+)/);
              const versionNumber = versionMatch ? parseInt(versionMatch[1], 10) : 1;
              
              // Count existing policies with the same first category
              const { data: existingPolicies, error: policyNumError } = await supabase
                .from('hr_policies')
                .select('policy_number, policy_categories')
                .eq('business_id', businessId)
                .not('policy_number', 'is', null);
              
              if (!policyNumError && existingPolicies) {
                // Filter policies that have the same first category
                const sameCategoryPolicies = existingPolicies.filter(p => {
                  if (!p.policy_categories || !Array.isArray(p.policy_categories) || p.policy_categories.length === 0) {
                    return false;
                  }
                  const firstCat = Array.isArray(p.policy_categories) 
                    ? (p.policy_categories[0]?.categoryId || p.policy_categories[0])
                    : null;
                  return firstCat === firstCategory.categoryId;
                });
                
                // Get the highest policy number sequence for this category
                let nextSequence = 1;
                if (sameCategoryPolicies.length > 0) {
                  const sequences = sameCategoryPolicies
                    .map(p => {
                      if (!p.policy_number) return 0;
                      // Parse format: category.policy.version
                      const parts = p.policy_number.split('.');
                      if (parts.length >= 2) {
                        return parseInt(parts[1], 10) || 0;
                      }
                      return 0;
                    })
                    .filter(s => s > 0);
                  
                  if (sequences.length > 0) {
                    nextSequence = Math.max(...sequences) + 1;
                  }
                }
                
                // Format: category.policy.version (all padded to 2 digits)
                policyNumber = `${String(categoryNumber).padStart(2, '0')}.${String(nextSequence).padStart(2, '0')}.${String(versionNumber).padStart(2, '0')}`;
              }
            }
          } catch (err) {
            console.warn('Could not generate policy number:', err);
          }
        } else {
          // No category selected - use category 00
          try {
            const versionMatch = newVersionNumber?.match(/^(\d+)/);
            const versionNumber = versionMatch ? parseInt(versionMatch[1], 10) : 1;
            
            // Count policies without categories
            const { data: existingPolicies, error: policyNumError } = await supabase
              .from('hr_policies')
              .select('policy_number, policy_categories')
              .eq('business_id', businessId)
              .or('policy_categories.is.null,policy_categories.eq.[]');
            
            if (!policyNumError && existingPolicies) {
              const nextSequence = existingPolicies.length + 1;
              policyNumber = `00.${String(nextSequence).padStart(2, '0')}.${String(versionNumber).padStart(2, '0')}`;
            }
          } catch (err) {
            console.warn('Could not generate policy number for uncategorized policy:', err);
          }
        }
      } else if (policy?.id && !isNewVersion) {
        // Keep existing policy number when editing
        policyNumber = policy.policy_number;
      } else if (policy?.id && isNewVersion) {
        // New version: update version number but keep category and policy number
        if (policy.policy_number) {
          const parts = policy.policy_number.split('.');
          if (parts.length >= 3) {
            // Format: category.policy.version
            const versionMatch = newVersionNumber?.match(/^(\d+)/);
            const versionNumber = versionMatch ? parseInt(versionMatch[1], 10) : 1;
            policyNumber = `${parts[0]}.${parts[1]}.${String(versionNumber).padStart(2, '0')}`;
          } else {
            policyNumber = policy.policy_number;
          }
        }
      }

      // Generate HTML version - use new version number if creating new version
      const versionToDisplay = shouldCreateNewVersion ? newVersionNumber : (policy?.policy_version || formData.policy_version);
      const policyHTML = generatePolicyHtmlDocument({
        policyName: formData.policy_name,
        businessName,
        brandingData,
        digitalSignature: null,
        policyNumber,
        versionNumber: versionToDisplay,
        effectiveDate: formData.effective_date,
        revisedDate: formData.revised_date,
        selectedCategories: formData.selected_categories || [],
        policyCategories: allCategories
      });

      const policyContent = buildPolicyPlainTextContent(formData.selected_categories || [], allCategories);

      const policyData = {
        business_id: businessId,
        policy_name: formData.policy_name.trim(),
        policy_version: shouldCreateNewVersion ? newVersionNumber : formData.policy_version.trim(),
        policy_type: formData.policy_type.trim() || null,
        policy_content: policyContent,
        policy_html: policyHTML,
        policy_categories: formData.selected_categories || [], // Array of objects: { categoryId: 'uuid', categoryContent: 'text', subContents: [{ id: 'uuid', content: 'text' }] }
        status: saveAsDraft ? 'draft' : formData.status,
        effective_date: formData.effective_date || null,
        revised_date: formData.revised_date || null,
        expiry_date: formData.expiry_date || null,
        requires_acknowledgment: formData.requires_acknowledgment,
        acknowledgment_deadline_days: formData.acknowledgment_deadline_days,
        created_by: authUser?.id || null,
        updated_by: authUser?.id || null
      };

      // Only include policy_number if it's not null (column may not exist yet)
      if (policyNumber !== null) {
        policyData.policy_number = policyNumber;
      }

      let savedPolicy;
      let payload = policyData;
      const trySave = async () => {
        if (policy?.id && shouldCreateNewVersion) {
          const { error: archiveError } = await supabase.from('hr_policies').update({
            is_current_version: false,
            status: 'archived',
            archived_at: new Date().toISOString(),
            archived_by: authUser?.id || null
          }).eq('id', policy.id);
          if (archiveError) throw archiveError;
          const { data, error } = await supabase.from('hr_policies').insert({
            ...payload,
            parent_policy_id: policy.id,
            is_current_version: true
          }).select().single();
          if (error) throw error;
          return data;
        }
        if (policy?.id) {
          const { data, error } = await supabase.from('hr_policies').update(payload).eq('id', policy.id).select().single();
          if (error) throw error;
          return data;
        }
        const { data, error } = await supabase.from('hr_policies').insert({
          ...payload,
          is_current_version: true,
          parent_policy_id: null
        }).select().single();
        if (error) throw error;
        return data;
      };

      try {
        savedPolicy = await trySave();
      } catch (err) {
        if (isRevisedDateColumnMissing(err)) {
          const { revised_date: _r, ...payloadWithoutRevised } = policyData;
          payload = payloadWithoutRevised;
          savedPolicy = await trySave();
        } else {
          throw err;
        }
      }

      if (policy?.id && shouldCreateNewVersion) {
        const versionType = versionUpdateData.isMajorUpdate ? 'major' : 'minor';
        toast.success(saveAsDraft ? 'New policy version saved as draft' : `New ${versionType} version (${newVersionNumber}) created successfully`);
      } else {
        toast.success(saveAsDraft ? 'Policy saved as draft' : (policy?.id ? 'Policy updated successfully' : 'Policy created successfully'));
      }

      if (onSave) {
        onSave(savedPolicy);
      }

      onClose();
    } catch (error) {
      console.error('Error saving policy:', error);
      toast.error('Failed to save policy: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    },
    modal: {
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      width: '100%',
      maxWidth: '900px',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 24px',
      borderBottom: '1px solid #e5e7eb'
    },
    title: {
      fontSize: '20px',
      fontWeight: 'bold',
      margin: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center'
    },
    content: {
      padding: '24px',
      overflowY: 'auto',
      flex: 1
    },
    formGroup: {
      marginBottom: '20px'
    },
    label: {
      display: 'block',
      marginBottom: '6px',
      fontWeight: '500',
      fontSize: '14px',
      color: '#374151'
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      boxSizing: 'border-box'
    },
    textarea: {
      width: '100%',
      padding: '12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      minHeight: '300px',
      resize: 'vertical',
      fontFamily: 'inherit',
      boxSizing: 'border-box',
      lineHeight: '1.6'
    },
    select: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      boxSizing: 'border-box',
      backgroundColor: 'white'
    },
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      padding: '20px 24px',
      borderTop: '1px solid #e5e7eb',
      backgroundColor: '#f8f9fa'
    },
    cancelButton: {
      padding: '12px 24px',
      backgroundColor: 'white',
      color: '#374151',
      border: '2px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer'
    },
    saveButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '12px 24px',
      backgroundColor: '#14B8A6',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer'
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ flex: 1 }}>
            <h2 style={styles.title}>
              {isNewVersion ? 'Create New Version' : policy ? 'Edit Policy' : 'Create New Policy'}
            </h2>
            {policy?.id && (
              <div style={{ 
                fontSize: '13px', 
                color: autoSaving ? '#f59e0b' : lastSaved ? '#16a34a' : '#6b7280',
                marginTop: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                {autoSaving ? (
                  <>
                    <span style={{ 
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#f59e0b',
                      animation: 'pulse 1.5s ease-in-out infinite'
                    }}></span>
                    Auto-saving...
                  </>
                ) : lastSaved ? (
                  <>
                    <span style={{ 
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#16a34a'
                    }}></span>
                    Saved {lastSaved.toLocaleTimeString()}
                  </>
                ) : null}
              </div>
            )}
          </div>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Policy Name *</label>
            <input
              type="text"
              value={formData.policy_name}
              onChange={(e) => handleInputChange('policy_name', e.target.value)}
              style={styles.input}
              placeholder="e.g., Employee Handbook, Code of Conduct"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Policy Version</label>
              <input
                type="text"
                value={formData.policy_version}
                onChange={(e) => handleInputChange('policy_version', e.target.value)}
                style={styles.input}
                placeholder="1.0"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Policy Type *</label>
              <select
                value={formData.policy_type}
                onChange={(e) => handleInputChange('policy_type', e.target.value)}
                style={styles.select}
                required
              >
                <option value="">Select Type</option>
                {policyTypes.map((type) => (
                  <option key={type.id} value={type.display_name}>
                    {type.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Import from .txt</label>
            <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#6b7280' }}>
              Upload a .txt file in the same format as the policy TXT download. Select at least one category below first, then upload to fill content in order.
            </p>
            <input
              ref={txtFileInputRef}
              type="file"
              accept=".txt,text/plain"
              onChange={handleTxtUpload}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => txtFileInputRef.current?.click()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: '500',
                color: '#14B8A6',
                backgroundColor: '#f0fdfa',
                border: '1px solid #14B8A6',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              <Upload size={18} />
              Upload .txt
            </button>
            {txtUploadFileName && (
              <span style={{ marginLeft: '12px', fontSize: '13px', color: '#6b7280' }}>
                Last: {txtUploadFileName}
              </span>
            )}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Policy Categories (Optional)</label>
            <div style={{ 
              border: '1px solid #d1d5db', 
              borderRadius: '6px', 
              padding: '12px',
              backgroundColor: '#f9fafb'
            }}>
              {allCategories.length === 0 ? (
                <div style={{ fontSize: '14px', color: '#6b7280', fontStyle: 'italic' }}>
                  No categories available. Use "Manage Categories" to add categories.
                </div>
              ) : (
                allCategories.map((category) => {
                  const isSelected = formData.selected_categories.some(item => item.categoryId === category.id);
                  const categoryItem = formData.selected_categories.find(item => item.categoryId === category.id);
                  
                  return (
                    <div key={category.id} style={{ 
                      marginBottom: '16px',
                      padding: '12px',
                      border: isSelected ? '2px solid #14B8A6' : '1px solid #e5e7eb',
                      borderRadius: '6px',
                      backgroundColor: isSelected ? '#f0fdfa' : 'white'
                    }}>
                      <TavariCheckbox
                        checked={isSelected}
                        onChange={(checked) => {
                          if (checked) {
                            handleInputChange('selected_categories', [
                              ...formData.selected_categories,
                              { categoryId: category.id, categoryContent: '', subContents: [] }
                            ]);
                          } else {
                            handleInputChange('selected_categories', 
                              formData.selected_categories.filter(item => item.categoryId !== category.id)
                            );
                          }
                        }}
                        label={category.category_name}
                        size="md"
                      />
                      {category.description && (
                        <div style={{ fontSize: '13px', color: '#6b7280', marginLeft: '28px', marginTop: '2px' }}>
                          {category.description}
                        </div>
                      )}
                      {isSelected && (
                        <div style={{ marginTop: '12px', marginLeft: '28px' }}>
                          <label style={{ 
                            display: 'block',
                            fontSize: '13px',
                            fontWeight: '500',
                            color: '#374151',
                            marginBottom: '6px'
                          }}>
                            Category Content *
                          </label>
                          <textarea
                            value={categoryItem?.categoryContent || ''}
                            onChange={(e) => {
                              const updated = formData.selected_categories.map(item =>
                                item.categoryId === category.id
                                  ? { ...item, categoryContent: e.target.value }
                                  : item
                              );
                              handleInputChange('selected_categories', updated);
                            }}
                            placeholder="Enter the main content for this category. This will appear directly under the category heading."
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '14px',
                              minHeight: '120px',
                              resize: 'vertical',
                              fontFamily: 'inherit',
                              boxSizing: 'border-box',
                              lineHeight: '1.6'
                            }}
                            required
                          />
                          
                          <div style={{ marginTop: '16px' }}>
                            <div style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center',
                              marginBottom: '8px'
                            }}>
                              <label style={{ 
                                fontSize: '13px',
                                fontWeight: '500',
                                color: '#374151',
                                margin: 0
                              }}>
                                Sub-Content Sections (Optional)
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = formData.selected_categories.map(item =>
                                    item.categoryId === category.id
                                      ? { 
                                          ...item, 
                                          subContents: [
                                            ...(item.subContents || []),
                                            { id: `sub-${Date.now()}-${Math.random()}`, content: '' }
                                          ]
                                        }
                                      : item
                                  );
                                  handleInputChange('selected_categories', updated);
                                }}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: '13px',
                                  backgroundColor: '#14B8A6',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontWeight: '500'
                                }}
                              >
                                <Plus size={14} />
                                Add Sub-Content
                              </button>
                            </div>
                            
                            {categoryItem?.subContents && categoryItem.subContents.length > 0 ? (
                              categoryItem.subContents.map((subItem, subIndex) => {
                                const categoryIndex = formData.selected_categories.findIndex(item => item.categoryId === category.id);
                                const categoryNumber = categoryIndex + 1;
                                const subNumber = `${categoryNumber}.${subIndex + 1}`;
                                
                                return (
                                  <div key={subItem.id} style={{
                                    marginBottom: '12px',
                                    padding: '12px',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '6px',
                                    backgroundColor: 'white'
                                  }}>
                                    <div style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      marginBottom: '6px'
                                    }}>
                                      <span style={{
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        color: '#6b7280'
                                      }}>
                                        {subNumber}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const updated = formData.selected_categories.map(item =>
                                            item.categoryId === category.id
                                              ? { 
                                                  ...item, 
                                                  subContents: (item.subContents || []).filter(sub => sub.id !== subItem.id)
                                                }
                                              : item
                                          );
                                          handleInputChange('selected_categories', updated);
                                        }}
                                        style={{
                                          padding: '4px 8px',
                                          fontSize: '13px',
                                          backgroundColor: '#ef4444',
                                          color: 'white',
                                          border: 'none',
                                          borderRadius: '4px',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '4px'
                                        }}
                                      >
                                        <Trash2 size={12} />
                                        Remove
                                      </button>
                                    </div>
                                    <textarea
                                      value={subItem.content || ''}
                                      onChange={(e) => {
                                        const updated = formData.selected_categories.map(item =>
                                          item.categoryId === category.id
                                            ? { 
                                                ...item, 
                                                subContents: (item.subContents || []).map(sub =>
                                                  sub.id === subItem.id
                                                    ? { ...sub, content: e.target.value }
                                                    : sub
                                                )
                                              }
                                            : item
                                        );
                                        handleInputChange('selected_categories', updated);
                                      }}
                                      placeholder="Enter sub-content text. This will be numbered and indented in the policy."
                                      style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        minHeight: '60px',
                                        resize: 'vertical',
                                        fontFamily: 'inherit',
                                        boxSizing: 'border-box',
                                        lineHeight: '1.6'
                                      }}
                                    />
                                  </div>
                                );
                              })
                            ) : (
                              <div style={{ 
                                fontSize: '13px', 
                                color: '#9ca3af', 
                                fontStyle: 'italic',
                                padding: '8px',
                                textAlign: 'center',
                                border: '1px dashed #d1d5db',
                                borderRadius: '6px',
                                backgroundColor: '#f9fafb'
                              }}>
                                No sub-content sections. Click "Add Sub-Content" to add one.
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '6px' }}>
              Categories will be numbered dynamically (1, 2, 3...) based on the order selected. Sub-content will be numbered (2.1, 2.2, etc.) and indented.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Effective Date</label>
              <input
                type="date"
                value={formData.effective_date}
                onChange={(e) => handleInputChange('effective_date', e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Revised Date</label>
              <input
                type="date"
                value={formData.revised_date}
                onChange={(e) => handleInputChange('revised_date', e.target.value)}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Expiry Date (Optional)</label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => handleInputChange('expiry_date', e.target.value)}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Status</label>
              <select
                value={formData.status}
                onChange={(e) => handleInputChange('status', e.target.value)}
                style={styles.select}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Acknowledgment Deadline (Days)</label>
              <input
                type="number"
                value={formData.acknowledgment_deadline_days}
                onChange={(e) => handleInputChange('acknowledgment_deadline_days', parseInt(e.target.value) || 30)}
                style={styles.input}
                min="1"
                max="365"
              />
            </div>
          </div>

          <div style={styles.formGroup}>
            <TavariCheckbox
              checked={formData.requires_acknowledgment}
              onChange={(checked) => handleInputChange('requires_acknowledgment', checked)}
              label="Requires Employee Acknowledgment"
              size="md"
            />
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              style={{
                ...styles.saveButton,
                backgroundColor: '#6b7280',
                opacity: saving ? 0.6 : 1
              }}
              onMouseOver={(e) => !saving && (e.target.style.backgroundColor = '#4b5563')}
              onMouseOut={(e) => !saving && (e.target.style.backgroundColor = '#6b7280')}
            >
              <Save size={18} />
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              style={{
                ...styles.saveButton,
                opacity: saving ? 0.6 : 1
              }}
            >
              <Save size={18} />
              {saving ? 'Saving...' : policy ? 'Update Policy' : 'Create Policy'}
            </button>
          </div>
        </div>
      </div>

      {/* Version Update Modal - shown when editing active policies */}
      {showVersionUpdateModal && (
        <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && setShowVersionUpdateModal(false)}>
          <div style={{
            ...styles.modal,
            maxWidth: '600px',
            maxHeight: '90vh',
            overflow: 'auto'
          }}>
            <div style={styles.header}>
              <h2 style={styles.title}>Create New Version</h2>
              <button onClick={() => setShowVersionUpdateModal(false)} style={styles.closeButton}>
                <X size={20} />
              </button>
            </div>

            <div style={styles.content}>
              <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#fef3c7', borderRadius: '8px', border: '1px solid #fbbf24' }}>
                <p style={{ margin: 0, color: '#92400e', fontWeight: '500' }}>
                  ⚠️ This policy is currently <strong>Active</strong>. Any changes will create a new version.
                </p>
                <p style={{ margin: '8px 0 0 0', color: '#78350f', fontSize: '14px' }}>
                  The current version will be archived and the new version will become active.
                </p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Describe the update <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <textarea
                  value={versionUpdateData.updateDescription}
                  onChange={(e) => setVersionUpdateData({ ...versionUpdateData, updateDescription: e.target.value })}
                  placeholder="e.g., Fixed spelling errors, Updated vacation policy section, Added new compliance category..."
                  style={{
                    ...styles.textarea,
                    minHeight: '100px'
                  }}
                />
                <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                  This description will be saved with the version history.
                </p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Update Type</label>
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="updateType"
                      checked={!versionUpdateData.isMajorUpdate}
                      onChange={() => setVersionUpdateData({ ...versionUpdateData, isMajorUpdate: false })}
                      style={{ cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: '500', color: '#374151' }}>Minor Update</div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>
                        Spelling, wording, or small text changes
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                        Version: {policy?.policy_version ? (() => {
                          const parts = policy.policy_version.split('.');
                          const major = parseInt(parts[0] || '1', 10);
                          const minor = parseInt(parts[1] || '0', 10);
                          return `${major}.${minor + 1}`;
                        })() : '1.1'}
                      </div>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="updateType"
                      checked={versionUpdateData.isMajorUpdate}
                      onChange={() => setVersionUpdateData({ ...versionUpdateData, isMajorUpdate: true })}
                      style={{ cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: '500', color: '#374151' }}>Major Update</div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>
                        Adding/removing categories, changing clauses, significant content changes
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                        Version: {policy?.policy_version ? (() => {
                          const parts = policy.policy_version.split('.');
                          const major = parseInt(parts[0] || '1', 10);
                          return `${major + 1}.0`;
                        })() : '2.0'}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div style={styles.footer}>
              <button
                onClick={() => {
                  setShowVersionUpdateModal(false);
                  setVersionUpdateData({ updateDescription: '', isMajorUpdate: false });
                  setPendingSaveData(null);
                }}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={handleVersionUpdateConfirm}
                disabled={!versionUpdateData.updateDescription.trim()}
                style={{
                  ...styles.saveButton,
                  opacity: !versionUpdateData.updateDescription.trim() ? 0.6 : 1
                }}
              >
                <Save size={18} />
                Create New Version
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PolicyCreationModal;

