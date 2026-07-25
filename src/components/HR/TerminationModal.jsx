// components/HR/TerminationModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Save, Mail, FileText, Bookmark, Eye } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import html2pdf from 'html2pdf.js';
import TavariCheckbox from '../UI/TavariCheckbox';
import { updateBusinessEmploymentStatus } from '../../utils/businessEmploymentStatus';

const TerminationModal = ({ 
  isOpen, 
  onClose, 
  businessId, 
  employees = [],
  authUser,
  terminationId = null, // If provided, load existing termination for viewing/editing
  viewMode = false // If true, disable editing (view only)
}) => {
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [employeeData, setEmployeeData] = useState(null);
  const [loadingEmployee, setLoadingEmployee] = useState(false);
  const [businessData, setBusinessData] = useState(null);
  const [terminationType, setTerminationType] = useState('with_cause'); // 'with_cause', 'without_cause', 'layoff'
  const [formData, setFormData] = useState({
    termination_date: new Date().toISOString().split('T')[0],
    cause: '',
    notice_period_weeks: 0,
    termination_pay: 0,
    severance_pay: 0,
    vacation_pay_owed: 0,
    final_pay: 0,
    notes: '',
    send_email: true,
    email_to: '', // Comma-separated emails
    email_cc: '', // Comma-separated emails
    selected_template_id: null,
    // Without cause options
    with_notice: false,
    pay_in_lieu: false,
    effective_termination_date: '', // Calculated or overridden date
    override_notice_period: false,
    override_termination_pay: false,
    override_effective_date: false,
    vacation_pay_included_in_pay: true, // Checkbox: vacation pay is included with normal pay
    // Template fields
    employee_address: '', // Employee address for letter
    manager_name: '', // Manager name for signature
    manager_title: '', // Manager title for signature
    // Notice fields
    subject_line: '', // Subject line for notice and email
    notice_body: '' // Body content of the notice
  });
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [esaCalculations, setEsaCalculations] = useState({
    yearsOfService: 0,
    noticeRequired: 0,
    terminationPayRequired: 0,
    severanceRequired: 0,
    vacationPayOwed: 0,
    totalEntitlement: 0,
    calculationDetails: '',
    effectiveTerminationDate: '',
    daysWorked: 0
  });

  // Helper function to format dates using business timezone
  // When given a date string like "2025-12-05", we want to interpret it as that date
  // in the business timezone, not as UTC. So we create a date at noon UTC (which
  // will be the same calendar day in most timezones) and then format it.
  const formatDateInBusinessTimezone = (dateInput, format = 'long') => {
    const businessTimezone = businessData?.timezone || 'America/Toronto';
    let date;
    
    if (dateInput instanceof Date) {
      date = dateInput;
    } else if (typeof dateInput === 'string') {
      // If it's a date string like "2025-12-05", create a date at noon UTC
      // This ensures the date is interpreted correctly regardless of timezone
      const dateStr = dateInput.includes('T') ? dateInput : `${dateInput}T12:00:00Z`;
      date = new Date(dateStr);
    } else {
      date = new Date(dateInput);
    }
    
    if (format === 'long') {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: businessTimezone,
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(date);
    } else {
      // Short format (YYYY-MM-DD)
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: businessTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    }
  };

  // Load templates and business data when modal opens
  useEffect(() => {
    if (isOpen && businessId) {
      loadTemplates();
      loadBusinessData();
      if (terminationId) {
        loadExistingTermination(terminationId);
      } else {
        // Reset form when opening for new termination
        resetForm();
      }
    }
  }, [isOpen, businessId, terminationId]);

  // Reset form to defaults
  const resetForm = () => {
    setSelectedEmployeeId('');
    setEmployeeData(null);
    setTerminationType('with_cause');
    setFormData({
      termination_date: new Date().toISOString().split('T')[0],
      cause: '',
      notice_period_weeks: 0,
      termination_pay: 0,
      severance_pay: 0,
      vacation_pay_owed: 0,
      final_pay: 0,
      notes: '',
      send_email: true,
      email_to: '',
      email_cc: '',
      selected_template_id: null,
      with_notice: false,
      pay_in_lieu: false,
      effective_termination_date: '',
      override_notice_period: false,
      override_termination_pay: false,
      override_effective_date: false,
      vacation_pay_included_in_pay: true,
      employee_address: '',
      manager_name: '',
      manager_title: '',
      subject_line: '',
      notice_body: ''
    });
    setSelectedTemplate(null);
    setEsaCalculations({
      yearsOfService: 0,
      noticeRequired: 0,
      terminationPayRequired: 0,
      severanceRequired: 0,
      vacationPayOwed: 0,
      totalEntitlement: 0,
      calculationDetails: '',
      effectiveTerminationDate: '',
      daysWorked: 0
    });
  };

  // Load existing termination data
  const loadExistingTermination = async (id) => {
    try {
      const { data, error } = await supabase
        .from('hr_terminations')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      if (data) {
        // Set employee
        setSelectedEmployeeId(data.employee_id);
        await loadEmployeeData(data.employee_id);

        // Set termination type
        setTerminationType(data.termination_type || 'with_cause');

        // Set form data
        setFormData({
          termination_date: data.termination_date || new Date().toISOString().split('T')[0],
          cause: data.cause || '',
          notice_period_weeks: data.notice_period_weeks || 0,
          termination_pay: data.termination_pay || 0,
          severance_pay: data.severance_pay || 0,
          vacation_pay_owed: data.vacation_pay_owed || 0,
          final_pay: data.final_pay || 0,
          notes: data.notes || '',
          send_email: false, // Don't auto-send when viewing
          email_to: data.email_to || '',
          email_cc: data.email_cc || '',
          selected_template_id: data.template_id || null,
          with_notice: data.with_notice || false,
          pay_in_lieu: data.pay_in_lieu || false,
          effective_termination_date: data.effective_termination_date || '',
          override_notice_period: data.override_notice_period || false,
          override_termination_pay: data.override_termination_pay || false,
          override_effective_date: data.override_effective_date || false,
          vacation_pay_included_in_pay: data.vacation_pay_included_in_pay !== undefined ? data.vacation_pay_included_in_pay : true,
          employee_address: data.employee_address || '',
          manager_name: data.manager_name || '',
          manager_title: data.manager_title || '',
          subject_line: data.subject_line || '',
          notice_body: data.notice_body || ''
        });

        // Load template if one was used
        if (data.template_id) {
          const { data: templateData } = await supabase
            .from('hr_termination_templates')
            .select('*')
            .eq('id', data.template_id)
            .single();
          if (templateData) {
            setSelectedTemplate(templateData);
          }
        }
      }
    } catch (error) {
      console.error('Error loading existing termination:', error);
      toast.error('Failed to load termination data');
    }
  };

  const loadBusinessData = async () => {
    if (!businessId) return;
    
    try {
      // Load business data the same way as SettingsScreen.jsx
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Unable to load business data.');
      }

      setBusinessData(data);
    } catch (error) {
      console.error('Error loading business data:', error);
      // Set defaults if error
      setBusinessData({
        business_name: 'Company',
        name: 'Company',
        business_address: '',
        address: '',
        business_city: '',
        city: '',
        business_state: 'ON',
        state: 'ON',
        business_postal: '',
        postal_code: '',
        business_email: '',
        email: '',
        business_phone: '',
        phone: ''
      });
    }
  };

  // Insert placeholder into notice body
  const insertPlaceholder = (placeholder) => {
    const textarea = document.getElementById('notice-body-textarea');
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = formData.notice_body;
      const before = text.substring(0, start);
      const after = text.substring(end);
      const newText = before + placeholder + after;
      setFormData(prev => ({ ...prev, notice_body: newText }));
      
      // Set cursor position after inserted text
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else {
      // Fallback if textarea not found
      setFormData(prev => ({ ...prev, notice_body: (prev.notice_body || '') + placeholder }));
    }
  };

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedEmployeeId('');
      setEmployeeData(null);
      setTerminationType('with_cause');
      setSelectedTemplate(null);
      setFormData({
        termination_date: new Date().toISOString().split('T')[0],
        cause: '',
        notice_period_weeks: 0,
        termination_pay: 0,
        severance_pay: 0,
        vacation_pay_owed: 0,
        final_pay: 0,
        notes: '',
        send_email: true,
        email_to: '',
        email_cc: '',
        selected_template_id: null,
        with_notice: false,
        pay_in_lieu: false,
        effective_termination_date: '',
        override_notice_period: false,
        override_termination_pay: false,
        override_effective_date: false,
        employee_address: '',
        manager_name: '',
        manager_title: '',
        subject_line: '',
        notice_body: ''
      });
      setEsaCalculations({
        yearsOfService: 0,
        noticeRequired: 0,
        terminationPayRequired: 0,
        severanceRequired: 0,
        vacationPayOwed: 0,
        totalEntitlement: 0,
        calculationDetails: '',
        effectiveTerminationDate: '',
        daysWorked: 0
      });
    }
  }, [isOpen]);

  // Load employee data when selected
  useEffect(() => {
    if (selectedEmployeeId && isOpen) {
      loadEmployeeData(selectedEmployeeId);
    }
  }, [selectedEmployeeId, isOpen]);

  // Update email fields when employee data loads
  useEffect(() => {
    if (employeeData && employeeData.email) {
      setFormData(prev => ({
        ...prev,
        email_to: prev.email_to || employeeData.email
      }));
    }
  }, [employeeData]);

  // Load templates
  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase
        .from('hr_termination_templates')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('template_name', { ascending: true });

      if (error) {
        // If table doesn't exist, just continue without templates
        if (error.code === '42P01' || error.message.includes('does not exist')) {
          console.warn('hr_termination_templates table does not exist yet');
          setTemplates([]);
          return;
        }
        throw error;
      }

      setTemplates(data || []);
    } catch (error) {
      console.error('Error loading templates:', error);
      setTemplates([]);
    } finally {
      setLoadingTemplates(false);
    }
  };

  // Load template when selected and populate notice_body
  useEffect(() => {
    if (formData.selected_template_id && templates.length > 0) {
      const template = templates.find(t => t.id === formData.selected_template_id);
      setSelectedTemplate(template);
      
      // Extract body content from template HTML and populate notice_body
      if (template && template.template_content) {
        // Extract the body content from the HTML template
        // The template HTML has the body in a div with class "body-content"
        let bodyText = '';
        
        // Try to extract using regex first (more reliable)
        const bodyMatch = template.template_content.match(/<div[^>]*class=["']body-content["'][^>]*>([\s\S]*?)<\/div>/i);
        if (bodyMatch && bodyMatch[1]) {
          // Extract text from the matched HTML, preserving placeholders and line breaks
          const bodyDiv = document.createElement('div');
          bodyDiv.innerHTML = bodyMatch[1];
          // Preserve line breaks by converting <br> back to newlines
          bodyText = bodyDiv.innerHTML
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
            .trim();
        } else {
          // Fallback: try DOM parsing
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = template.template_content;
          const bodyContentDiv = tempDiv.querySelector('.body-content');
          if (bodyContentDiv) {
            bodyText = bodyContentDiv.innerHTML
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/p>/gi, '\n')
              .replace(/<[^>]+>/g, '')
              .trim();
          }
        }
        
        // Populate notice_body with template content (with placeholders preserved)
        // Only update if notice_body is empty or if user hasn't manually edited it
        if (bodyText.trim() && (!formData.notice_body || formData.notice_body.trim() === '')) {
          setFormData(prev => ({
            ...prev,
            notice_body: bodyText.trim()
          }));
        }
      }
    } else {
      setSelectedTemplate(null);
    }
  }, [formData.selected_template_id, templates]);

  // Calculate ESA entitlements when employee data or termination type changes
  useEffect(() => {
    if (employeeData && terminationType === 'without_cause') {
      calculateESAEntitlements();
    }
  }, [employeeData, terminationType, formData.termination_date, formData.with_notice, formData.pay_in_lieu, formData.override_notice_period, formData.override_termination_pay, formData.override_effective_date, formData.vacation_pay_included_in_pay]);

  const loadEmployeeData = async (employeeId) => {
    setLoadingEmployee(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          email,
          position,
          department,
          hire_date,
          start_date,
          wage,
          employment_status,
          business_users!inner(business_id)
        `)
        .eq('id', employeeId)
        .eq('business_users.business_id', businessId)
        .single();

      if (error) throw error;

      setEmployeeData(data);
      
      // Auto-fill form with employee data
      setFormData(prev => ({
        ...prev,
        // Employee data is now in employeeData state
      }));

    } catch (error) {
      console.error('Error loading employee data:', error);
      toast.error('Failed to load employee data');
    } finally {
      setLoadingEmployee(false);
    }
  };

  const calculateESAEntitlements = async () => {
    if (!employeeData) return;

    try {
      const hireDate = new Date(employeeData.hire_date || employeeData.start_date);
      const terminationDate = new Date(formData.termination_date);
      const daysWorked = (terminationDate - hireDate) / (24 * 60 * 60 * 1000);
      const yearsOfService = daysWorked / 365.25;
      
      // ESA Notice Requirements (Ontario)
      let noticeRequired = 0;
      
      // Check if less than 90 days worked - immediate termination
      if (daysWorked < 90) {
        noticeRequired = 0; // Immediate
      } else {
        // ESA minimum notice periods
        if (yearsOfService < 1) {
          noticeRequired = 1; // 1 week
        } else if (yearsOfService < 3) {
          noticeRequired = 2; // 2 weeks
        } else if (yearsOfService < 4) {
          noticeRequired = 3; // 3 weeks
        } else if (yearsOfService < 5) {
          noticeRequired = 4; // 4 weeks
        } else if (yearsOfService < 6) {
          noticeRequired = 5; // 5 weeks
        } else if (yearsOfService < 7) {
          noticeRequired = 6; // 6 weeks
        } else {
          noticeRequired = 8; // 8 weeks for 7+ years
        }
      }

      // Use override values if set
      const finalNoticeRequired = formData.override_notice_period 
        ? formData.notice_period_weeks 
        : noticeRequired;

      // Get employee's regular wage from payroll data
      let regularWage = parseFloat(employeeData.wage || 0);
      let weeklyWage = regularWage * 40; // Default assumption

      // If pay in lieu, get actual payroll data to calculate average weekly wage
      if (formData.pay_in_lieu) {
        const twelveMonthsAgo = new Date(terminationDate);
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        const { data: payrollData, error: payrollError } = await supabase
          .from('hrpayroll_entries')
          .select(`
            gross_pay,
            regular_pay,
            regular_hours,
            hrpayroll_runs!inner(pay_date, business_id, pay_period_start, pay_period_end)
          `)
          .eq('hrpayroll_runs.business_id', businessId)
          .eq('user_id', employeeData.id)
          .gte('hrpayroll_runs.pay_date', twelveMonthsAgo.toISOString().split('T')[0])
          .lte('hrpayroll_runs.pay_date', terminationDate.toISOString().split('T')[0])
          .order('hrpayroll_runs.pay_date', { ascending: false });

        if (!payrollError && payrollData && payrollData.length > 0) {
          // Calculate average weekly wage from payroll
          let totalGross = 0;
          let totalWeeks = 0;
          const payPeriods = new Set();

          payrollData.forEach(entry => {
            const gross = parseFloat(entry.gross_pay || 0);
            if (gross > 0) {
              totalGross += gross;
              const periodKey = entry.hrpayroll_runs?.pay_period_start || entry.hrpayroll_runs?.pay_date;
              if (periodKey) {
                payPeriods.add(periodKey);
              }
            }
          });

          // Estimate weeks based on pay periods
          if (payPeriods.size > 0) {
            totalWeeks = payPeriods.size * 2; // Assuming bi-weekly pay
            weeklyWage = totalGross / totalWeeks;
          } else {
            // Fallback: use most recent pay period
            const recentEntry = payrollData[0];
            const recentGross = parseFloat(recentEntry.gross_pay || 0);
            const recentHours = parseFloat(recentEntry.regular_hours || 0);
            if (recentHours > 0) {
              const hourlyRate = recentGross / recentHours;
              weeklyWage = hourlyRate * 40;
            }
          }
        }
      }

      // Calculate effective termination date if "with notice" is selected
      let effectiveTerminationDate = terminationDate;
      if (formData.with_notice) {
        if (formData.override_effective_date && formData.effective_termination_date) {
          // Use overridden date
          effectiveTerminationDate = new Date(formData.effective_termination_date);
        } else if (daysWorked >= 90) {
          // Add notice period weeks to termination date
          effectiveTerminationDate = new Date(terminationDate);
          effectiveTerminationDate.setDate(effectiveTerminationDate.getDate() + (finalNoticeRequired * 7));
        } else {
          // Less than 90 days - immediate
          effectiveTerminationDate = terminationDate;
        }
      } else if (formData.override_effective_date && formData.effective_termination_date) {
        effectiveTerminationDate = new Date(formData.effective_termination_date);
      }

      // Termination Pay = Notice Period × Weekly Wage (only if pay in lieu)
      let terminationPayRequired = 0;
      if (formData.pay_in_lieu) {
        terminationPayRequired = formData.override_termination_pay 
          ? formData.termination_pay 
          : finalNoticeRequired * weeklyWage;
      }

      // Severance Pay (Ontario ESA - only if payroll > $2.5M or 50+ employees terminated)
      // For now, we'll calculate based on years of service (5+ years = 1 week per year, max 26 weeks)
      let severanceRequired = 0;
      if (yearsOfService >= 5) {
        severanceRequired = Math.min(yearsOfService, 26) * weeklyWage;
      }

      // Calculate vacation pay owed
      // Check if user has indicated vacation pay is included with normal pay
      let vacationPayOwed = 0;
      
      // If checkbox is checked (vacation pay included in pay), set to 0
      if (formData.vacation_pay_included_in_pay) {
        vacationPayOwed = 0;
      } else {
        // Vacation pay is accrued, so calculate what's owed
        const twelveMonthsAgo = new Date(terminationDate);
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        const { data: payrollData, error: payrollError } = await supabase
          .from('hrpayroll_entries')
          .select(`
            gross_pay,
            vacation_pay,
            hrpayroll_runs!inner(pay_date, business_id)
          `)
          .eq('hrpayroll_runs.business_id', businessId)
          .eq('user_id', employeeData.id)
          .gte('hrpayroll_runs.pay_date', twelveMonthsAgo.toISOString().split('T')[0])
          .lte('hrpayroll_runs.pay_date', terminationDate.toISOString().split('T')[0]);

        if (!payrollError && payrollData) {
          const totalGross = payrollData.reduce((sum, entry) => {
            return sum + parseFloat(entry.gross_pay || 0);
          }, 0);
          // 4% vacation pay on gross earnings
          vacationPayOwed = totalGross * 0.04;
        } else {
          // Fallback: estimate based on current wage
          vacationPayOwed = weeklyWage * 52 * 0.04; // 4% of annual wage
        }
      }

      const totalEntitlement = terminationPayRequired + severanceRequired + vacationPayOwed;

      setEsaCalculations({
        yearsOfService: yearsOfService.toFixed(2),
        noticeRequired: finalNoticeRequired,
        terminationPayRequired,
        severanceRequired,
        vacationPayOwed,
        totalEntitlement,
        effectiveTerminationDate: effectiveTerminationDate.toISOString().split('T')[0],
        daysWorked: Math.floor(daysWorked),
        calculationDetails: daysWorked < 90 
          ? `Less than 90 days worked - immediate termination. ${severanceRequired > 0 ? `Severance: $${severanceRequired.toFixed(2)}. ` : ''}Vacation pay: $${vacationPayOwed.toFixed(2)}.`
          : `Based on ${yearsOfService.toFixed(2)} years of service, ESA requires ${finalNoticeRequired} weeks notice${formData.with_notice ? ` (effective date: ${formatDateInBusinessTimezone(effectiveTerminationDate, 'short')})` : formData.pay_in_lieu ? ` (pay in lieu: $${terminationPayRequired.toFixed(2)})` : ''}. ${severanceRequired > 0 ? `Severance: $${severanceRequired.toFixed(2)}. ` : ''}Vacation pay: $${vacationPayOwed.toFixed(2)}.`
      });

      // Update form data
      setFormData(prev => ({
        ...prev,
        notice_period_weeks: finalNoticeRequired,
        termination_pay: terminationPayRequired,
        severance_pay: severanceRequired,
        vacation_pay_owed: vacationPayOwed,
        final_pay: totalEntitlement,
        effective_termination_date: formData.override_effective_date 
          ? prev.effective_termination_date 
          : effectiveTerminationDate.toISOString().split('T')[0]
      }));

    } catch (error) {
      console.error('Error calculating ESA entitlements:', error);
      toast.error('Failed to calculate ESA entitlements');
    }
  };

  const generateTerminationNoticeHTML = () => {
    if (!employeeData) return '';

    // Format dates using business timezone
    // The "Date:" field at the top should show the notice date (when the notice is given)
    const noticeDate = formatDateInBusinessTimezone(formData.termination_date, 'long');
    const noticeDateShort = formatDateInBusinessTimezone(formData.termination_date, 'short');
    
    // Effective termination date (when employment ends) - used in body content if needed
    const effectiveTermDate = formData.effective_termination_date && formData.effective_termination_date.trim()
      ? formatDateInBusinessTimezone(formData.effective_termination_date, 'long')
      : noticeDate;
    const effectiveTermDateShort = formData.effective_termination_date && formData.effective_termination_date.trim()
      ? formatDateInBusinessTimezone(formData.effective_termination_date, 'short')
      : noticeDateShort;

    // Get business info
    const businessName = businessData?.business_name || businessData?.name || '[THE BUSINESS]';
    const businessAddress = businessData?.business_address || businessData?.address || '';
    const businessCity = businessData?.business_city || businessData?.city || '';
    const businessState = businessData?.business_state || businessData?.state || 'ON';
    const businessPostal = businessData?.business_postal || businessData?.postal_code || '';
    const businessEmail = businessData?.business_email || businessData?.email || '[COMPANY EMAIL]';
    const fullBusinessAddress = businessAddress 
      ? `${businessAddress}${businessCity ? `, ${businessCity}` : ''}${businessState ? `, ${businessState}` : ''}${businessPostal ? ` ${businessPostal}` : ''}`
      : '[BUSINESS ADDRESS]';

    // Get template name (from selected template or default based on termination type)
    let templateName = 'TERMINATION NOTICE';
    if (selectedTemplate && selectedTemplate.template_name) {
      templateName = selectedTemplate.template_name.toUpperCase();
    } else {
      if (terminationType === 'with_cause') {
        templateName = 'TERMINATION NOTICE – WITH CAUSE';
      } else if (terminationType === 'without_cause') {
        templateName = 'TERMINATION NOTICE – WITHOUT CAUSE';
      } else if (terminationType === 'layoff') {
        templateName = 'LAYOFF NOTICE';
      }
    }

    // Get body content - from template or custom notice body
    let bodyContent = '';
    
    if (selectedTemplate && selectedTemplate.template_content) {
      // Extract body content from template HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = selectedTemplate.template_content;
      const bodyContentDiv = tempDiv.querySelector('.body-content');
      if (bodyContentDiv) {
        bodyContent = bodyContentDiv.textContent || bodyContentDiv.innerText || '';
      } else {
        // Fallback: try to extract from HTML
        const bodyMatch = selectedTemplate.template_content.match(/<div[^>]*class=["']body-content["'][^>]*>(.*?)<\/div>/is);
        if (bodyMatch) {
          const bodyDiv = document.createElement('div');
          bodyDiv.innerHTML = bodyMatch[1];
          bodyContent = bodyDiv.textContent || bodyDiv.innerText || '';
        }
      }
    } else if (formData.notice_body && formData.notice_body.trim()) {
      bodyContent = formData.notice_body;
    } else {
      // Default body content based on termination type
      if (terminationType === 'with_cause') {
        bodyContent = `This letter is to inform you that your employment with ${businessName} is terminated effective immediately.\n\nReason for termination: ${formData.cause || 'Termination with cause as per company policy.'}\n\nThis termination is being made with cause in accordance with the Employment Standards Act, 2000 (Ontario).`;
      } else if (terminationType === 'without_cause') {
        bodyContent = `This letter is to inform you that your employment with ${businessName} is terminated effective immediately.\n\nYour employment was still within the probationary period, during which both Ontario's Employment Standards Act, 2000 ("ESA") and your employment agreement permit termination without notice or pay in lieu of notice, except for wages and entitlements earned up to your final day of work.`;
      } else if (terminationType === 'layoff') {
        bodyContent = `This letter is to inform you that your employment with ${businessName} is being temporarily laid off, effective ${effectiveTermDate}.\n\nThis layoff is due to business circumstances and is not a reflection of your performance.`;
      }
    }

    // Replace placeholders in body content
    bodyContent = bodyContent
      .replace(/\{\{EmployeeFirstName\}\}/g, employeeData.first_name || '')
      .replace(/\{\{EmployeeLastName\}\}/g, employeeData.last_name || '')
      .replace(/\{\{EmployeeFullName\}\}/g, `${employeeData.first_name || ''} ${employeeData.last_name || ''}`.trim())
      .replace(/\{\{EmployeePosition\}\}/g, employeeData.position || 'N/A')
      .replace(/\{\{EmployeeAddress\}\}/g, formData.employee_address || 'N/A')
      .replace(/\{\{EmployeeEmail\}\}/g, employeeData.email || 'N/A')
      .replace(/\{\{StartDate\}\}/g, formatDateInBusinessTimezone(employeeData.hire_date || employeeData.start_date, 'short'))
      .replace(/\{\{TerminationDate\}\}/g, effectiveTermDate) // Effective termination date (when employment ends)
      .replace(/\{\{TerminationDateShort\}\}/g, effectiveTermDateShort) // Effective termination date short format
      .replace(/\{\{NoticeDate\}\}/g, noticeDate) // Notice date (when notice is given)
      .replace(/\{\{NoticeDateShort\}\}/g, noticeDateShort) // Notice date short format
      .replace(/\{\{Cause\}\}/g, formData.cause || '')
      .replace(/\{\{NoticePeriodWeeks\}\}/g, esaCalculations?.noticeRequired?.toString() || '0')
      .replace(/\{\{TerminationPay\}\}/g, `$${(esaCalculations?.terminationPayRequired || 0).toFixed(2)}`)
      .replace(/\{\{SeverancePay\}\}/g, `$${(esaCalculations?.severanceRequired || 0).toFixed(2)}`)
      .replace(/\{\{VacationPayOwed\}\}/g, `$${(esaCalculations?.vacationPayOwed || 0).toFixed(2)}`)
      .replace(/\{\{TotalEntitlement\}\}/g, `$${(esaCalculations?.totalEntitlement || 0).toFixed(2)}`)
      .replace(/\{\{YearsOfService\}\}/g, (esaCalculations?.yearsOfService || 0).toString())
      .replace(/\{\{Notes\}\}/g, formData.notes || '')
      .replace(/\{\{BusinessName\}\}/g, businessName)
      .replace(/\{\{BusinessAddress\}\}/g, fullBusinessAddress)
      .replace(/\{\{BusinessEmail\}\}/g, businessEmail)
      .replace(/\{\{THE BUSINESS\}\}/g, businessName)
      .replace(/\{\{COMPANY EMAIL\}\}/g, businessEmail)
      .replace(/\{\{ManagerName\}\}/g, formData.manager_name || '[Manager Name]')
      .replace(/\{\{ManagerTitle\}\}/g, formData.manager_title || '[Manager Title]')
      .replace(/\[Manager Name\]/g, formData.manager_name || '[Manager Name]')
      .replace(/\[Manager Title\]/g, formData.manager_title || '[Manager Title]');

    // Build ESA details section
    let esaDetailsSection = '';
    if (terminationType === 'without_cause' || terminationType === 'with_cause') {
      const finalPay = esaCalculations?.totalEntitlement || 0;
      const vacationPay = esaCalculations?.vacationPayOwed || 0;
      
      esaDetailsSection = `
        <div class="esa-details">
          <p style="font-weight: bold; margin-bottom: 8px;">Final Compensation and Statutory Entitlements</p>
          <p style="margin-bottom: 8px;">In accordance with the ESA, you will receive:</p>
          <ul>
            <li><strong>Final Wages:</strong> Payment for all hours worked up to and including your final shift${finalPay > 0 ? ` ($${finalPay.toFixed(2)})` : ''}.</li>
            <li><strong>Vacation Pay:</strong> ${vacationPay > 0 ? `$${vacationPay.toFixed(2)} in vacation pay owed` : 'As vacation pay is paid with each pay period, no additional vacation pay is owing'}.</li>
            <li><strong>Record of Employment:</strong> Your ROE will be issued electronically through Service Canada.</li>
          </ul>
        </div>
      `;
    }

    // Universal shell structure matching the screenshot
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.5;
            color: #000;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px 40px;
          }
          .header {
            text-align: center;
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            margin-bottom: 25px;
            margin-top: 0;
            padding-top: 0;
            padding-bottom: 10px;
            letter-spacing: 0.5px;
            display: block;
            width: 100%;
          }
          .company-info {
            margin-bottom: 12px;
            margin-top: 0;
            clear: both;
            display: block;
            width: 100%;
          }
          .date {
            margin-bottom: 12px;
          }
          .recipient-info {
            margin-bottom: 12px;
          }
          .salutation {
            margin-bottom: 10px;
          }
          .subject {
            font-weight: bold;
            margin-bottom: 10px;
          }
          .body-content {
            margin-bottom: 12px;
            white-space: pre-wrap;
            line-height: 1.6;
          }
          .esa-details {
            margin-top: 12px;
            margin-bottom: 12px;
          }
          .esa-details p {
            margin-bottom: 8px;
          }
          .esa-details ul {
            margin-top: 8px;
            margin-bottom: 8px;
          }
          .closing {
            margin-top: 20px;
          }
          .signature {
            margin-top: 25px;
          }
          ul {
            margin: 8px 0;
            padding-left: 20px;
          }
          li {
            margin: 4px 0;
          }
          p {
            margin-bottom: 10px;
          }
        </style>
      </head>
      <body>
        <!-- Company Information -->
        <div class="company-info">
          <strong>${businessName}</strong><br>
          ${fullBusinessAddress}<br>
          ${businessEmail}
        </div>
        
        <!-- Date (Notice Date - when the notice is given) -->
        <div class="date">
          <strong>Date:</strong> ${noticeDate}
        </div>
        
        <!-- Employee Information -->
        <div class="recipient-info">
          <strong>To:</strong> ${employeeData.first_name} ${employeeData.last_name}<br>
          <strong>Address:</strong> ${formData.employee_address || 'N/A'}<br>
          <strong>Email:</strong> ${employeeData.email || 'N/A'}
        </div>
        
        <!-- Subject Line -->
        <div class="subject">
          Subject: ${formData.subject_line || 'Termination of Employment'}
        </div>
        
        <!-- Body Content (from template or custom) -->
        <div class="body-content">${bodyContent.replace(/\n/g, '<br>')}</div>
        
        <!-- ESA Details Section -->
        ${esaDetailsSection}
        
        <!-- Closing -->
        <div class="closing">
          Sincerely,
        </div>
        
        <!-- Signature Block -->
        <div class="signature">
          <div style="border-top: 1px solid #000; width: 200px; margin-bottom: 10px;"></div>
          ${formData.manager_name || '[Manager Name]'}<br>
          ${formData.manager_title || '[Manager Title]'}<br>
          ${businessName}
        </div>
      </body>
      </html>
    `;
  };

  const handleSave = async () => {
    if (!selectedEmployeeId || !employeeData) {
      toast.error('Please select an employee');
      return;
    }

    if (terminationType === 'with_cause' && !formData.cause.trim()) {
      toast.error('Please provide the reason for termination');
      return;
    }

    if (!formData.manager_name.trim()) {
      toast.error('Please enter the manager name for the signature');
      return;
    }

    if (!formData.manager_title.trim()) {
      toast.error('Please enter the manager title for the signature');
      return;
    }

    if (!formData.subject_line.trim()) {
      toast.error('Please enter a subject line for the notice');
      return;
    }

    if (!formData.notice_body.trim()) {
      toast.error('Please enter the body of the termination notice');
      return;
    }

    setSaving(true);
    try {
      // If sending email, let sendTerminationEmail handle saving the record
      // This prevents duplicate termination records
      if (formData.send_email && employeeData.email) {
        await sendTerminationEmail(null);
        // sendTerminationEmail will close the modal after successful send
        return;
      }

      // Save termination record to database (only if NOT sending email)
      const { data, error } = await supabase
        .from('hr_terminations')
        .insert({
          business_id: businessId,
          employee_id: selectedEmployeeId,
          termination_type: terminationType,
          termination_date: formData.termination_date,
          cause: terminationType === 'with_cause' ? formData.cause : null,
          notice_period_weeks: formData.notice_period_weeks,
          termination_pay: formData.termination_pay,
          severance_pay: formData.severance_pay,
          vacation_pay_owed: formData.vacation_pay_owed,
          final_pay: formData.final_pay,
          notes: formData.notes,
          created_by: authUser?.id,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Termination record saved successfully');
      onClose();
      
    } catch (error) {
      console.error('Error saving termination:', error);
      toast.error('Failed to save termination: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!formData.subject_line.trim() || !formData.notice_body.trim()) {
      toast.error('Please fill in the subject line and notice body before saving as template');
      return;
    }

    const templateName = prompt('Enter a name for this template:');
    if (!templateName || !templateName.trim()) {
      return; // User cancelled or entered empty name
    }

    setSavingTemplate(true);
    try {
      // Generate HTML template from current form data
      const terminationDate = new Date(formData.termination_date + 'T00:00:00');
      const formattedDate = formatDateInBusinessTimezone(terminationDate, 'long');

      // Get business info
      const businessName = businessData?.business_name || businessData?.name || '{{BusinessName}}';
      const businessAddress = businessData?.business_address || businessData?.address || '';
      const businessCity = businessData?.business_city || businessData?.city || '';
      const businessState = businessData?.business_state || businessData?.state || 'ON';
      const businessPostal = businessData?.business_postal || businessData?.postal_code || '';
      const businessEmail = businessData?.business_email || businessData?.email || '{{BusinessEmail}}';
      const fullBusinessAddress = businessAddress 
        ? `${businessAddress}${businessCity ? `, ${businessCity}` : ''}${businessState ? `, ${businessState}` : ''}${businessPostal ? ` ${businessPostal}` : ''}`
        : '{{BusinessAddress}}';

      // Build template HTML with placeholders
      // IMPORTANT: Only replace actual values, not placeholders that already exist
      // Also escape regex special characters to prevent corruption
      const escapeRegex = (str) => {
        if (!str) return '';
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      };
      
      let templateBody = formData.notice_body || '{{NoticeBody}}';
      
      // First, check if the body already contains placeholders - if so, preserve them
      // Only replace actual employee data values, not existing placeholders
      
      // Replace actual values back to placeholders if they were used
      // Only replace if the value exists and is not empty, and is not already a placeholder
      if (employeeData) {
        // Replace full name first (longest match)
        if (employeeData.first_name && employeeData.last_name) {
          const fullName = `${employeeData.first_name} ${employeeData.last_name}`.trim();
          if (fullName && !templateBody.includes('{{EmployeeFullName}}')) {
            templateBody = templateBody.replace(new RegExp(escapeRegex(fullName), 'g'), '{{EmployeeFullName}}');
          }
        }
        
        // Then replace individual names (but only if full name wasn't found)
        if (employeeData.first_name && !templateBody.includes('{{EmployeeFirstName}}')) {
          templateBody = templateBody.replace(new RegExp(escapeRegex(employeeData.first_name), 'g'), '{{EmployeeFirstName}}');
        }
        if (employeeData.last_name && !templateBody.includes('{{EmployeeLastName}}')) {
          templateBody = templateBody.replace(new RegExp(escapeRegex(employeeData.last_name), 'g'), '{{EmployeeLastName}}');
        }
        if (employeeData.position && !templateBody.includes('{{EmployeePosition}}')) {
          templateBody = templateBody.replace(new RegExp(escapeRegex(employeeData.position), 'g'), '{{EmployeePosition}}');
        }
        if (employeeData.email && !templateBody.includes('{{EmployeeEmail}}')) {
          templateBody = templateBody.replace(new RegExp(escapeRegex(employeeData.email), 'g'), '{{EmployeeEmail}}');
        }
        // Only replace employee address if it exists and is not empty
        if (formData.employee_address && formData.employee_address.trim() && !templateBody.includes('{{EmployeeAddress}}')) {
          templateBody = templateBody.replace(new RegExp(escapeRegex(formData.employee_address), 'g'), '{{EmployeeAddress}}');
        }
      }
      
      // Replace dates with placeholders (only if they exist in the text)
      const shortDate = formatDateInBusinessTimezone(terminationDate, 'short');
      if (formattedDate && !templateBody.includes('{{TerminationDate}}')) {
        templateBody = templateBody.replace(new RegExp(escapeRegex(formattedDate), 'g'), '{{TerminationDate}}');
      }
      if (shortDate && !templateBody.includes('{{TerminationDateShort}}')) {
        templateBody = templateBody.replace(new RegExp(escapeRegex(shortDate), 'g'), '{{TerminationDateShort}}');
      }
      
      if (employeeData) {
        const startDate = formatDateInBusinessTimezone(employeeData.hire_date || employeeData.start_date, 'short');
        if (startDate && !templateBody.includes('{{StartDate}}')) {
          templateBody = templateBody.replace(new RegExp(escapeRegex(startDate), 'g'), '{{StartDate}}');
        }
      }
      
      // Replace business info with placeholders (only if values exist and aren't already placeholders)
      if (businessName && businessName !== '{{BusinessName}}' && !templateBody.includes('{{BusinessName}}')) {
        templateBody = templateBody.replace(new RegExp(escapeRegex(businessName), 'g'), '{{BusinessName}}');
      }
      if (businessEmail && businessEmail !== '{{BusinessEmail}}' && !templateBody.includes('{{BusinessEmail}}')) {
        templateBody = templateBody.replace(new RegExp(escapeRegex(businessEmail), 'g'), '{{BusinessEmail}}');
      }
      if (fullBusinessAddress && fullBusinessAddress !== '{{BusinessAddress}}' && !templateBody.includes('{{BusinessAddress}}')) {
        templateBody = templateBody.replace(new RegExp(escapeRegex(fullBusinessAddress), 'g'), '{{BusinessAddress}}');
      }
      
      // Replace manager info with placeholders (only if values exist)
      if (formData.manager_name && formData.manager_name.trim() && !templateBody.includes('{{ManagerName}}')) {
        templateBody = templateBody.replace(new RegExp(escapeRegex(formData.manager_name), 'g'), '{{ManagerName}}');
      }
      if (formData.manager_title && formData.manager_title.trim() && !templateBody.includes('{{ManagerTitle}}')) {
        templateBody = templateBody.replace(new RegExp(escapeRegex(formData.manager_title), 'g'), '{{ManagerTitle}}');
      }
      
      // Replace subject line with placeholder if it contains actual values
      let templateSubject = formData.subject_line || '{{SubjectLine}}';
      if (employeeData) {
        templateSubject = templateSubject
          .replace(new RegExp(escapeRegex(employeeData.first_name || ''), 'g'), '{{EmployeeFirstName}}')
          .replace(new RegExp(escapeRegex(employeeData.last_name || ''), 'g'), '{{EmployeeLastName}}');
      }

      // Save only the body content in a simple HTML wrapper for extraction later
      // The universal shell will handle all the other parts (header, company info, date, etc.)
      const templateHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body>
  <div class="body-content">
${templateBody}
  </div>
</body>
</html>`;

      // Save template to database
      const { data, error } = await supabase
        .from('hr_termination_templates')
        .insert({
          business_id: businessId,
          template_name: templateName.trim(),
          description: `Template saved from ${terminationType} termination`,
          termination_type: terminationType,
          template_content: templateHTML,
          is_active: true,
          created_by: authUser?.id
        })
        .select()
        .single();

      if (error) {
        if (error.code === '42P01' || error.message.includes('does not exist')) {
          toast.error('Templates table does not exist. Please run the migration first.');
        } else {
          throw error;
        }
        return;
      }

      toast.success(`Template "${templateName}" saved successfully!`);
      
      // Reload templates list
      await loadTemplates();
      
      // Optionally select the newly created template
      setFormData(prev => ({ ...prev, selected_template_id: data.id }));
      setSelectedTemplate(data);

    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template: ' + (error.message || 'Unknown error'));
    } finally {
      setSavingTemplate(false);
    }
  };

  const sendTerminationEmail = async (terminationRecord) => {
    setSendingEmail(true);
    try {
      // Generate PDF
      const htmlContent = generateTerminationNoticeHTML();
      
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      tempDiv.style.cssText = `
        position: absolute;
        top: 0px;
        left: 0px;
        width: 8.5in;
        min-height: 11in;
        background-color: white;
        visibility: visible;
        z-index: -1000;
        font-family: Arial, sans-serif;
      `;
      
      document.body.appendChild(tempDiv);
      tempDiv.offsetHeight;
      tempDiv.scrollHeight;
      await new Promise(resolve => setTimeout(resolve, 500));

      const opt = {
        margin: [0.3, 0.5, 0.3, 0.5], // Reduced top/bottom margins to ensure header/footer visible
        filename: `Termination Notice - ${employeeData.first_name} ${employeeData.last_name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 1.5,
          useCORS: true,
          logging: false,
          letterRendering: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          width: 816,
          height: 1056
        },
        jsPDF: { 
          unit: 'in', 
          format: 'letter', 
          orientation: 'portrait',
          compress: true
        }
      };
      
      const pdfBlob = await html2pdf().set(opt).from(tempDiv).outputPdf('blob');
      
      if (document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }

      // Convert to base64
      const pdfBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      // Use business data already loaded (from loadBusinessData)
      const businessName = businessData?.business_name || businessData?.name || 'Company';

      // Parse email addresses (comma-separated) - same pattern as pay statements
      console.log('[TerminationModal] ========== EMAIL SENDING DEBUG ==========');
      console.log('[TerminationModal] Raw form data:', {
        email_to: formData.email_to,
        email_cc: formData.email_cc,
        hasEmailTo: !!formData.email_to,
        hasEmailCc: !!formData.email_cc
      });

      const toEmails = formData.email_to
        .split(',')
        .map(email => email.trim())
        .filter(email => email && email.includes('@'));
      
      console.log('[TerminationModal] Parsed TO emails:', toEmails);

      const ccEmails = formData.email_cc
        ? formData.email_cc
            .split(',')
            .map(email => email.trim())
            .filter(email => email && email.includes('@'))
        : [];
      
      console.log('[TerminationModal] Parsed CC emails:', ccEmails);
      console.log('[TerminationModal] CC emails count:', ccEmails.length);

      if (toEmails.length === 0) {
        throw new Error('No valid email addresses in TO field');
      }

      // Create email content - use subject line from form
      const emailSubject = formData.subject_line || `Termination Notice - ${employeeData.first_name} ${employeeData.last_name}`;
      // Ensure we use the actual employee's first name, not a placeholder
      const employeeFirstName = employeeData?.first_name?.trim() || 'Employee';
      
      // Simple text version (iPhone Mail shows this if HTML rendering fails)
      const emailBody = `Dear ${employeeFirstName},\n\nPlease find attached your termination notice.\n\nIf you have any questions, please contact HR.\n\nBest regards,\n${businessName} - HR`;

      // HTML version - keep it simple to avoid iPhone duplication issues
      // iPhone Mail sometimes shows both text and HTML parts, so we make them identical
      const emailHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
  <p>Dear ${employeeFirstName},</p>
  <p>Please find attached your termination notice.</p>
  <p>If you have any questions, please contact HR.</p>
  <p>Best regards,<br>${businessName} - HR</p>
</body>
</html>`;

      // Send via mail-send edge function - same pattern as pay statements
      const senderEmail = 'noreply@tavarios.ca';
      const emailPayload = {
        businessId: businessId,
        campaignId: `termination-${selectedEmployeeId}-${Date.now()}`,
        contactId: `termination-${toEmails[0]}`,
        emailType: 'transactional',
        to: toEmails.join(','), // Comma-separated for multiple recipients (same as pay statements)
        fromEmail: senderEmail,
        fromName: `${businessName} - HR`,
        subject: emailSubject,
        html: emailHTML,
        text: emailBody,
        attachments: [{
          filename: `Termination Notice - ${employeeData.first_name} ${employeeData.last_name}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf'
        }]
      };

      // Ensure CC is in the payload if there are CC emails
      const finalPayload = {
        ...emailPayload
      };
      
      console.log('[TerminationModal] Email payload before adding CC:', {
        hasCc: 'cc' in finalPayload,
        ccValue: finalPayload.cc,
        allKeys: Object.keys(finalPayload)
      });

      if (ccEmails.length > 0) {
        finalPayload.cc = ccEmails.join(',');
        console.log('[TerminationModal] ✅ CC emails being added to payload:', ccEmails);
        console.log('[TerminationModal] ✅ CC field value:', finalPayload.cc);
        console.log('[TerminationModal] ✅ CC field type:', typeof finalPayload.cc);
      } else {
        console.log('[TerminationModal] ⚠️ No CC emails to add (ccEmails.length = 0)');
      }

      console.log('[TerminationModal] Final email payload before sending:', {
        to: finalPayload.to,
        cc: finalPayload.cc,
        hasCc: 'cc' in finalPayload,
        ccValue: finalPayload.cc,
        ccType: typeof finalPayload.cc,
        hasAttachments: finalPayload.attachments?.length > 0,
        allKeys: Object.keys(finalPayload),
        payloadStringified: JSON.stringify(finalPayload, null, 2)
      });

      const requestBody = JSON.stringify(finalPayload);
      console.log('[TerminationModal] Request body being sent:', {
        bodyLength: requestBody.length,
        bodyPreview: requestBody.substring(0, 500),
        hasCcInBody: requestBody.includes('"cc"'),
        ccInBody: requestBody.match(/"cc"\s*:\s*"([^"]+)"/)?.[1]
      });

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: requestBody
      });

      console.log('[TerminationModal] Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'Failed to send email');
      }

      const data = await response.json();
      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to send email');
      }

      // Save termination record to database with all details
      // If terminationRecord is provided, update it; otherwise insert a new one
      let savedRecord = terminationRecord;
      
      if (terminationRecord?.id) {
        // Update existing record
        const { data: updatedRecord, error: updateError } = await supabase
          .from('hr_terminations')
          .update({
            termination_type: terminationType,
            termination_date: formData.termination_date || new Date().toISOString().split('T')[0],
            cause: terminationType === 'with_cause' ? formData.cause : null,
            notice_period_weeks: esaCalculations?.noticePeriodWeeks || 0,
            termination_pay: esaCalculations?.terminationPay || 0,
            severance_pay: esaCalculations?.severancePay || 0,
            vacation_pay_owed: esaCalculations?.vacationPayOwed || 0,
            final_pay: esaCalculations?.finalPay || 0,
            manager_name: formData.manager_name,
            manager_title: formData.manager_title,
            notice_body: formData.notice_body,
            subject_line: formData.subject_line,
            employee_address: formData.employee_address,
            email_to: formData.email_to,
            email_cc: formData.email_cc || null,
            email_sent: true,
            email_sent_at: new Date().toISOString()
          })
          .eq('id', terminationRecord.id)
          .select()
          .single();

        if (updateError) {
          console.error('Error updating termination record:', updateError);
          toast.error('Email sent, but failed to update termination record. Please update manually.');
        } else {
          savedRecord = updatedRecord;
          console.log('Termination record updated successfully:', savedRecord);
        }
      } else {
        // Insert new record (only if one doesn't already exist)
        const { data: newRecord, error: saveError } = await supabase
          .from('hr_terminations')
          .insert({
            business_id: businessId,
            employee_id: selectedEmployeeId,
            termination_type: terminationType,
            termination_date: formData.termination_date || new Date().toISOString().split('T')[0],
            cause: terminationType === 'with_cause' ? formData.cause : null,
            notice_period_weeks: esaCalculations?.noticePeriodWeeks || 0,
            termination_pay: esaCalculations?.terminationPay || 0,
            severance_pay: esaCalculations?.severancePay || 0,
            vacation_pay_owed: esaCalculations?.vacationPayOwed || 0,
            final_pay: esaCalculations?.finalPay || 0,
            manager_name: formData.manager_name,
            manager_title: formData.manager_title,
            notice_body: formData.notice_body,
            subject_line: formData.subject_line,
            employee_address: formData.employee_address,
            email_to: formData.email_to,
            email_cc: formData.email_cc || null,
            email_sent: true,
            email_sent_at: new Date().toISOString(),
            created_by: (await supabase.auth.getUser()).data?.user?.id || null
          })
          .select()
          .single();

        if (saveError) {
          console.error('Error saving termination record:', saveError);
          // Don't throw - email was sent successfully, just log the error
          toast.error('Email sent, but failed to save termination record. Please save manually.');
        } else {
          savedRecord = newRecord;
          console.log('Termination record saved successfully:', savedRecord);
        }
      }

      // If CC emails are provided, send copies to all CC recipients (same pattern as contracts)
      if (ccEmails.length > 0) {
        console.log('[TerminationModal] Sending separate emails to CC recipients:', ccEmails);
        
        const ccPromises = ccEmails.map(async (ccEmailAddress) => {
          const ccPayload = {
            ...finalPayload,
            contactId: `termination-cc-${ccEmailAddress}`,
            to: ccEmailAddress,
            subject: `[CC] ${emailSubject}`
          };
          // Remove CC field from individual CC emails to avoid recursion
          delete ccPayload.cc;

          try {
            const ccResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
              },
              body: JSON.stringify(ccPayload)
            });

            if (!ccResponse.ok) {
              const errorBody = await ccResponse.text();
              console.warn(`[TerminationModal] Failed to send CC email to ${ccEmailAddress}:`, errorBody);
            } else {
              const ccData = await ccResponse.json();
              if (!ccData?.ok) {
                console.warn(`[TerminationModal] CC email to ${ccEmailAddress} failed:`, ccData?.error);
              } else {
                console.log(`[TerminationModal] ✅ CC email sent successfully to ${ccEmailAddress}`);
              }
            }
          } catch (ccError) {
            console.warn(`[TerminationModal] Failed to send CC email to ${ccEmailAddress}:`, ccError);
            // Don't fail the whole operation if CC fails
          }
        });

        // Wait for all CC emails to be sent (but don't fail if some fail)
        await Promise.allSettled(ccPromises);
        console.log('[TerminationModal] All CC emails processed');
      }

      // Automatically terminate the employee in the system
      let employeeTerminated = false;
      try {
        console.log('[TerminationModal] Attempting to terminate employee:', {
          selectedEmployeeId,
          termination_date: formData.termination_date || new Date().toISOString().split('T')[0],
          employee_email: employeeData?.email
        });

        // First, verify the employee exists and get their public.users.id
        // selectedEmployeeId might be auth.users.id, so we need to find the correct public.users.id
        let publicUserId = selectedEmployeeId;
        
        // If we have employee email, try to find the correct ID
        if (employeeData?.email) {
          const { data: userByEmail, error: emailError } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', employeeData.email)
            .maybeSingle();
          
          if (!emailError && userByEmail) {
            publicUserId = userByEmail.id;
            console.log('[TerminationModal] Found public.users.id by email:', publicUserId);
          } else {
            console.warn('[TerminationModal] Could not find user by email, using selectedEmployeeId:', emailError);
          }
        }

        const terminationDay = formData.termination_date || new Date().toISOString().split('T')[0];
        const { data: updateResult, error: updateError } = await updateBusinessEmploymentStatus(supabase, {
          userId: publicUserId,
          businessId,
          employment_status: 'terminated',
          termination_date: terminationDay,
        });

        if (updateError) {
          console.error('[TerminationModal] Error updating employee status:', {
            error: updateError,
            selectedEmployeeId,
            publicUserId,
            employee_email: employeeData?.email,
          });
          toast.error(`Email sent, but failed to update employee status: ${updateError.message || 'Unknown error'}. Please update manually.`);
        } else if (updateResult) {
          console.log('[TerminationModal] Employee status updated successfully:', updateResult);
          employeeTerminated = true;
        } else {
          console.warn('[TerminationModal] Update returned no rows. Employee ID may not exist:', publicUserId);
          toast.error('Email sent, but employee record not found. Please verify the employee ID and update manually.');
        }
      } catch (statusError) {
        console.error('[TerminationModal] Exception terminating employee:', {
          error: statusError,
          message: statusError.message,
          stack: statusError.stack,
          selectedEmployeeId,
          employee_email: employeeData?.email
        });
        // Don't throw - email was sent successfully
        toast.error(`Email sent, but failed to update employee status: ${statusError.message || 'Unknown error'}. Please update manually.`);
      }

      // Show success message
      if (employeeTerminated) {
        toast.success(`Termination notice emailed and employee status updated to terminated.`);
      } else {
        toast.success(`Termination notice emailed to ${toEmails.join(', ')}${ccEmails.length > 0 ? ` (CC: ${ccEmails.join(', ')})` : ''}`);
      }
      
      // Close modal after successful email send
      onClose();
      
    } catch (error) {
      console.error('Error sending termination email:', error);
      toast.error('Failed to send email: ' + (error.message || 'Unknown error'));
    } finally {
      setSendingEmail(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
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
      overflowY: 'auto'
    }}
    // Removed onClick handler - modal should only close via X button or after email is sent
    >
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '800px',
        width: '90%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
        margin: '20px auto'
      }}
      onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
          paddingBottom: '16px'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#111827',
            margin: 0
          }}>
            Record Termination
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6b7280',
              padding: '0',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Termination Type Tabs */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', gap: '2px', backgroundColor: '#e5e7eb', borderRadius: '8px', padding: '4px' }}>
            <button
              type="button"
              onClick={() => !viewMode && setTerminationType('with_cause')}
              disabled={viewMode}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: terminationType === 'with_cause' ? 'white' : 'transparent',
                color: terminationType === 'with_cause' ? '#14B8A6' : '#6b7280',
                fontWeight: terminationType === 'with_cause' ? '600' : '400',
                cursor: 'pointer',
                boxShadow: terminationType === 'with_cause' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              With Cause
            </button>
            <button
              type="button"
              onClick={() => !viewMode && setTerminationType('without_cause')}
              disabled={viewMode}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: terminationType === 'without_cause' ? 'white' : 'transparent',
                color: terminationType === 'without_cause' ? '#14B8A6' : '#6b7280',
                fontWeight: terminationType === 'without_cause' ? '600' : '400',
                cursor: 'pointer',
                boxShadow: terminationType === 'without_cause' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Without Cause
            </button>
            <button
              type="button"
              onClick={() => !viewMode && setTerminationType('layoff')}
              disabled={viewMode}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: terminationType === 'layoff' ? 'white' : 'transparent',
                color: terminationType === 'layoff' ? '#14B8A6' : '#6b7280',
                fontWeight: terminationType === 'layoff' ? '600' : '400',
                cursor: 'pointer',
                boxShadow: terminationType === 'layoff' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Layoff
            </button>
          </div>
        </div>

        {/* Employer Information */}
        {businessData && (
          <div style={{
            backgroundColor: '#f0fdfa',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '24px',
            border: `1px solid ${TavariStyles.colors.primary}`
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#111827' }}>
              Employer Information
            </h3>
            <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
              <div><strong>Business Name:</strong> {businessData.business_name || businessData.name || 'N/A'}</div>
              <div><strong>Address:</strong> {[
                businessData.business_address || businessData.address,
                businessData.business_city || businessData.city,
                businessData.business_state || businessData.state,
                businessData.business_postal || businessData.postal_code
              ].filter(Boolean).join(', ') || 'N/A'}</div>
              <div><strong>Email:</strong> {businessData.business_email || businessData.email || 'N/A'}</div>
              <div><strong>Phone:</strong> {businessData.business_phone || businessData.phone || 'N/A'}</div>
            </div>
          </div>
        )}

        {/* Employee Selection */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '600',
            color: '#374151',
            marginBottom: '8px'
          }}>
            Select Employee *
          </label>
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            disabled={viewMode || loadingEmployee}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: `2px solid ${TavariStyles.colors.gray300}`,
              borderRadius: '8px',
              fontSize: '16px',
              outline: 'none'
            }}
          >
            <option value="">-- Select Employee --</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.last_name}, {emp.first_name} {emp.employee_number ? `(#${emp.employee_number})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Employee Information Display (Editable) */}
        {employeeData && (
          <div style={{
            backgroundColor: '#f9fafb',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '24px',
            border: `1px solid ${TavariStyles.colors.gray200}`
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#111827' }}>
              Employee Information
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px',
              fontSize: '14px'
            }}>
              <div>
                <strong>First Name:</strong> {employeeData.first_name || 'N/A'}
              </div>
              <div>
                <strong>Last Name:</strong> {employeeData.last_name || 'N/A'}
              </div>
              <div>
                <strong>Position:</strong> {employeeData.position || 'N/A'}
              </div>
              <div>
                <strong>Start Date:</strong> {formatDateInBusinessTimezone(employeeData.hire_date || employeeData.start_date, 'short')}
              </div>
              <div>
                <strong>Email:</strong> {employeeData.email || 'N/A'}
              </div>
              <div>
                <strong>Address:</strong> {formData.employee_address || 'Not provided'}
              </div>
            </div>
          </div>
        )}

        {/* Termination Date */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '600',
            color: '#374151',
            marginBottom: '8px'
          }}>
            Date of Notice *
          </label>
          <input
            type="date"
            value={formData.termination_date}
            onChange={(e) => setFormData(prev => ({ ...prev, termination_date: e.target.value }))}
            disabled={viewMode}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: `2px solid ${TavariStyles.colors.gray300}`,
              borderRadius: '8px',
              fontSize: '16px',
              outline: 'none'
            }}
          />
        </div>

        {/* Template Selection */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '600',
            color: '#374151',
            marginBottom: '8px'
          }}>
            Termination Letter Template
          </label>
          <select
            value={formData.selected_template_id || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, selected_template_id: e.target.value || null }))}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: `2px solid ${TavariStyles.colors.gray300}`,
              borderRadius: '8px',
              fontSize: '16px',
              outline: 'none'
            }}
          >
            <option value="">-- Use Default Template --</option>
            {templates.map(template => (
              <option key={template.id} value={template.id}>
                {template.template_name} {template.termination_type ? `(${template.termination_type})` : ''}
              </option>
            ))}
          </select>
          {selectedTemplate && (
            <div style={{
              marginTop: '8px',
              padding: '12px',
              backgroundColor: '#f0fdfa',
              border: '1px solid #14B8A6',
              borderRadius: '6px',
              fontSize: '13px',
              color: '#0f766e'
            }}>
              <strong>Template Selected:</strong> {selectedTemplate.template_name}
              {selectedTemplate.description && (
                <div style={{ marginTop: '4px' }}>{selectedTemplate.description}</div>
              )}
            </div>
          )}
        </div>

        {/* Subject Line */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '600',
            color: '#374151',
            marginBottom: '8px'
          }}>
            Subject Line *
            <span style={{ fontSize: '13px', fontWeight: '400', color: '#6b7280', marginLeft: '4px' }}>
              (Appears in notice and email)
            </span>
          </label>
          <input
            type="text"
            value={formData.subject_line}
            onChange={(e) => setFormData(prev => ({ ...prev, subject_line: e.target.value }))}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: `2px solid ${TavariStyles.colors.gray300}`,
              borderRadius: '8px',
              fontSize: '16px',
              outline: 'none'
            }}
            placeholder="e.g., Termination of Employment – Probationary Period"
          />
        </div>

        {/* Notice Body Editor */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '600',
            color: '#374151',
            marginBottom: '8px'
          }}>
            Body of Notice *
          </label>
          
          {/* Placeholder Insert Buttons */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '8px',
            padding: '8px',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: `1px solid ${TavariStyles.colors.gray200}`
          }}>
            <span style={{ fontSize: '13px', color: '#6b7280', marginRight: '8px', alignSelf: 'center' }}>Insert:</span>
            {[
              { label: 'First Name', value: '{{EmployeeFirstName}}' },
              { label: 'Last Name', value: '{{EmployeeLastName}}' },
              { label: 'Full Name', value: '{{EmployeeFullName}}' },
              { label: 'Business Name', value: '{{BusinessName}}' },
              { label: 'Position', value: '{{EmployeePosition}}' },
              { label: 'Start Date', value: '{{StartDate}}' },
              { label: 'Termination Date', value: '{{TerminationDate}}' },
              { label: 'Business Email', value: '{{BusinessEmail}}' }
            ].map(placeholder => (
              <button
                key={placeholder.value}
                type="button"
                onClick={() => insertPlaceholder(placeholder.value)}
                style={{
                  padding: '4px 8px',
                  fontSize: '13px',
                  backgroundColor: 'white',
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: '#374151'
                }}
              >
                {placeholder.label}
              </button>
            ))}
          </div>
          
          <textarea
            id="notice-body-textarea"
            value={formData.notice_body}
            onChange={(e) => setFormData(prev => ({ ...prev, notice_body: e.target.value }))}
            rows={12}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: `2px solid ${TavariStyles.colors.gray300}`,
              borderRadius: '8px',
              fontSize: '16px',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit'
            }}
            placeholder="Enter the body of the termination notice..."
          />
        </div>

        {/* Employee Address (for letter) */}
        {employeeData && (
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '8px'
            }}>
              Employee Address (for letter)
            </label>
            <textarea
              value={formData.employee_address}
              onChange={(e) => setFormData(prev => ({ ...prev, employee_address: e.target.value }))}
              rows={2}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `2px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '8px',
                fontSize: '16px',
                outline: 'none',
                resize: 'vertical'
              }}
              placeholder="Enter employee's full address (e.g., 242 St. Arnaud Street, Amherstburg, ON N9V 2P3)"
            />
          </div>
        )}

        {/* Manager Information (for signature) */}
        <div style={{
          backgroundColor: '#f9fafb',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '24px',
          border: `1px solid ${TavariStyles.colors.gray200}`
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: '600',
            color: '#111827',
            marginBottom: '16px'
          }}>
            Signature Information
          </h3>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '8px'
            }}>
              Manager Name *
            </label>
            <input
              type="text"
              value={formData.manager_name}
              onChange={(e) => setFormData(prev => ({ ...prev, manager_name: e.target.value }))}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `2px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '8px',
                fontSize: '16px',
                outline: 'none'
              }}
              placeholder="e.g., Bob Shaw"
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '8px'
            }}>
              Manager Title *
            </label>
            <input
              type="text"
              value={formData.manager_title}
              onChange={(e) => setFormData(prev => ({ ...prev, manager_title: e.target.value }))}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `2px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '8px',
                fontSize: '16px',
                outline: 'none'
              }}
              placeholder="e.g., General Manager"
            />
          </div>
        </div>

        {/* Without Cause Options */}
        {terminationType === 'without_cause' && employeeData && (
          <div style={{
            backgroundColor: '#f0fdfa',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '24px',
            border: `1px solid ${TavariStyles.colors.primary}`
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#111827',
              marginBottom: '16px'
            }}>
              Termination Method
            </h3>
            
            <div style={{ marginBottom: '16px' }}>
              <TavariCheckbox
                checked={formData.with_notice}
                onChange={(checked) => {
                  setFormData(prev => ({
                    ...prev,
                    with_notice: checked,
                    pay_in_lieu: checked ? false : prev.pay_in_lieu
                  }));
                }}
                label="With notice"
                size="md"
                id="with-notice-checkbox"
              />
              <div style={{
                fontSize: '13px',
                color: '#6b7280',
                marginTop: '4px',
                marginLeft: '28px'
              }}>
                Employee will work through the notice period. Effective termination date will be calculated based on ESA rules.
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <TavariCheckbox
                checked={formData.pay_in_lieu}
                onChange={(checked) => {
                  setFormData(prev => ({
                    ...prev,
                    pay_in_lieu: checked,
                    with_notice: checked ? false : prev.with_notice
                  }));
                }}
                label="Pay in lieu of notice"
                size="md"
                id="pay-in-lieu-checkbox"
              />
              <div style={{
                fontSize: '13px',
                color: '#6b7280',
                marginTop: '4px',
                marginLeft: '28px'
              }}>
                Employee will be paid termination pay instead of working notice. Amount calculated from payroll data.
              </div>
            </div>

            {/* Effective Termination Date (for with notice) */}
            {formData.with_notice && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <label style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#374151'
                  }}>
                    Effective Termination Date
                  </label>
                  <TavariCheckbox
                    checked={formData.override_effective_date}
                    onChange={(checked) => setFormData(prev => ({ ...prev, override_effective_date: checked }))}
                    label="Override"
                    size="sm"
                    id="override-effective-date-checkbox"
                  />
                </div>
                <input
                  type="date"
                  value={formData.effective_termination_date || esaCalculations.effectiveTerminationDate || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, effective_termination_date: e.target.value }))}
                  disabled={!formData.override_effective_date}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: `2px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none',
                    backgroundColor: formData.override_effective_date ? 'white' : '#f3f4f6',
                    cursor: formData.override_effective_date ? 'text' : 'not-allowed'
                  }}
                />
                {!formData.override_effective_date && esaCalculations.daysWorked !== undefined && (
                  <div style={{
                    fontSize: '13px',
                    color: '#6b7280',
                    marginTop: '4px'
                  }}>
                    {esaCalculations.daysWorked < 90 
                      ? 'Less than 90 days worked - immediate termination (no notice required)'
                      : `Calculated: ${formatDateInBusinessTimezone(esaCalculations.effectiveTerminationDate || formData.termination_date, 'short')} (${esaCalculations.noticeRequired} weeks from termination date)`
                    }
                  </div>
                )}
              </div>
            )}

            {/* Override Notice Period */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px'
              }}>
                <label style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  Notice Period (weeks)
                </label>
                <TavariCheckbox
                  checked={formData.override_notice_period}
                  onChange={(checked) => setFormData(prev => ({ ...prev, override_notice_period: checked }))}
                  label="Override"
                  size="sm"
                  id="override-notice-period-checkbox"
                />
              </div>
              <input
                type="number"
                min="0"
                step="0.5"
                value={formData.notice_period_weeks || esaCalculations.noticeRequired || 0}
                onChange={(e) => setFormData(prev => ({ ...prev, notice_period_weeks: parseFloat(e.target.value) || 0 }))}
                disabled={!formData.override_notice_period}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: `2px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: '8px',
                  fontSize: '16px',
                  outline: 'none',
                  backgroundColor: formData.override_notice_period ? 'white' : '#f3f4f6',
                  cursor: formData.override_notice_period ? 'text' : 'not-allowed'
                }}
              />
              {!formData.override_notice_period && (
                <div style={{
                  fontSize: '13px',
                  color: '#6b7280',
                  marginTop: '4px'
                }}>
                  ESA calculated: {esaCalculations.noticeRequired || 0} weeks
                </div>
              )}
            </div>

            {/* Override Termination Pay (for pay in lieu) */}
            {formData.pay_in_lieu && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <label style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#374151'
                  }}>
                    Termination Pay (Pay in Lieu)
                  </label>
                  <TavariCheckbox
                    checked={formData.override_termination_pay}
                    onChange={(checked) => setFormData(prev => ({ ...prev, override_termination_pay: checked }))}
                    label="Override"
                    size="sm"
                    id="override-termination-pay-checkbox"
                  />
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.override_termination_pay ? formData.termination_pay : (esaCalculations.terminationPayRequired || 0)}
                  onChange={(e) => setFormData(prev => ({ ...prev, termination_pay: parseFloat(e.target.value) || 0 }))}
                  disabled={!formData.override_termination_pay}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: `2px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none',
                    backgroundColor: formData.override_termination_pay ? 'white' : '#f3f4f6',
                    cursor: formData.override_termination_pay ? 'text' : 'not-allowed'
                  }}
                />
                {!formData.override_termination_pay && (
                  <div style={{
                    fontSize: '13px',
                    color: '#6b7280',
                    marginTop: '4px'
                  }}>
                    Calculated from payroll: ${(esaCalculations.terminationPayRequired || 0).toFixed(2)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Cause (for with_cause) */}
        {terminationType === 'with_cause' && (
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '8px'
            }}>
              Reason for Termination *
            </label>
            <textarea
              value={formData.cause}
              onChange={(e) => setFormData(prev => ({ ...prev, cause: e.target.value }))}
              rows={4}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `2px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '8px',
                fontSize: '16px',
                outline: 'none',
                resize: 'vertical'
              }}
              placeholder="Describe the reason for termination..."
            />
          </div>
        )}

        {/* ESA Calculations (for without_cause) */}
        {terminationType === 'without_cause' && employeeData && esaCalculations.yearsOfService > 0 && (
          <div style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '24px'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#1e40af' }}>
              ESA Entitlements (Calculated)
            </h3>
            <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
              <div><strong>Years of Service:</strong> {esaCalculations.yearsOfService}</div>
              <div><strong>Notice Required:</strong> {esaCalculations.noticeRequired} weeks</div>
              <div><strong>Termination Pay:</strong> ${esaCalculations.terminationPayRequired.toFixed(2)}</div>
              {esaCalculations.severanceRequired > 0 && (
                <div><strong>Severance Pay:</strong> ${esaCalculations.severanceRequired.toFixed(2)}</div>
              )}
              <div><strong>Vacation Pay Owed:</strong> ${esaCalculations.vacationPayOwed.toFixed(2)}</div>
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #bfdbfe' }}>
                <TavariCheckbox
                  checked={formData.vacation_pay_included_in_pay}
                  onChange={(checked) => {
                    setFormData(prev => ({ ...prev, vacation_pay_included_in_pay: checked }));
                  }}
                  label="Vacation pay is included with normal pay (no vacation pay owed)"
                  size="sm"
                  id="vacation-pay-included-checkbox"
                />
              </div>
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #bfdbfe' }}>
                <strong>Total Entitlement:</strong> ${esaCalculations.totalEntitlement.toFixed(2)}
              </div>
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#64748b' }}>
                {esaCalculations.calculationDetails}
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '600',
            color: '#374151',
            marginBottom: '8px'
          }}>
            Additional Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={4}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: `2px solid ${TavariStyles.colors.gray300}`,
              borderRadius: '8px',
              fontSize: '16px',
              outline: 'none',
              resize: 'vertical'
            }}
            placeholder="Any additional notes or information..."
          />
        </div>

        {/* Save as Template Button */}
        {formData.subject_line.trim() && formData.notice_body.trim() && (
          <div style={{ marginBottom: '24px' }}>
            <button
              type="button"
              onClick={handleSaveAsTemplate}
              disabled={savingTemplate}
              style={{
                width: '100%',
                padding: '12px 20px',
                backgroundColor: savingTemplate ? '#9ca3af' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: savingTemplate ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {savingTemplate ? (
                <>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid white',
                    borderTop: '2px solid transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                  Saving Template...
                </>
              ) : (
                <>
                  <Bookmark size={16} />
                  Save as Template
                </>
              )}
            </button>
            <p style={{
              fontSize: '13px',
              color: '#6b7280',
              marginTop: '8px',
              textAlign: 'center'
            }}>
              Save this termination notice as a reusable template for future terminations
            </p>
          </div>
        )}

        {/* Email Configuration */}
        <div style={{
          backgroundColor: '#f9fafb',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '24px',
          border: `1px solid ${TavariStyles.colors.gray200}`
        }}>
          <div style={{ marginBottom: '16px' }}>
            <TavariCheckbox
              checked={formData.send_email}
              onChange={(checked) => setFormData(prev => ({ ...prev, send_email: checked }))}
              label="Send termination notice via email"
              size="md"
              id="send-email-checkbox"
            />
          </div>

          {formData.send_email && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  To (Recipients) *
                  <span style={{ fontSize: '13px', fontWeight: '400', color: '#6b7280', marginLeft: '4px' }}>
                    (comma-separated for multiple)
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.email_to}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_to: e.target.value }))}
                  placeholder={employeeData?.email || "Enter email address(es)"}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: `2px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none'
                  }}
                />
                {employeeData?.email && formData.email_to !== employeeData.email && (
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ 
                      ...prev, 
                      email_to: prev.email_to ? `${prev.email_to}, ${employeeData.email}` : employeeData.email 
                    }))}
                    style={{
                      marginTop: '6px',
                      padding: '4px 8px',
                      fontSize: '13px',
                      backgroundColor: '#e0f2fe',
                      color: '#0369a1',
                      border: '1px solid #bae6fd',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    + Add {employeeData.email}
                  </button>
                )}
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  CC (Carbon Copy)
                  <span style={{ fontSize: '13px', fontWeight: '400', color: '#6b7280', marginLeft: '4px' }}>
                    (comma-separated for multiple)
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.email_cc}
                  onChange={(e) => setFormData(prev => ({ ...prev, email_cc: e.target.value }))}
                  placeholder="manager@company.com, hr@company.com"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: `2px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none'
                  }}
                />
                <div style={{
                  marginTop: '6px',
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap'
                }}>
                  <button
                    type="button"
                    onClick={async () => {
                      // Get active managers/owners/HR emails (exclude terminated)
                      const { data: managers } = await supabase
                        .from('business_users')
                        .select('employment_status, users!inner(email, first_name, last_name)')
                        .eq('business_id', businessId)
                        .in('role', ['owner', 'manager', 'hr_admin', 'admin']);
                      
                      if (managers && managers.length > 0) {
                        const activeManagers = managers.filter(
                          (m) => m.employment_status !== 'terminated' && m.users?.email
                        );
                        
                        if (activeManagers.length > 0) {
                          const managerEmails = activeManagers
                            .map(m => m.users.email)
                            .join(', ');
                          setFormData(prev => ({
                            ...prev,
                            email_cc: prev.email_cc ? `${prev.email_cc}, ${managerEmails}` : managerEmails
                          }));
                        } else {
                          toast.info('No active managers found');
                        }
                      }
                    }}
                    style={{
                      padding: '4px 8px',
                      fontSize: '13px',
                      backgroundColor: '#e0f2fe',
                      color: '#0369a1',
                      border: '1px solid #bae6fd',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    + Add Managers/Owners
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex',
          gap: '12px',
          justifyContent: 'flex-end',
          borderTop: `1px solid ${TavariStyles.colors.gray200}`,
          paddingTop: '16px'
        }}>
          <button
            onClick={onClose}
            disabled={saving || sendingEmail}
            style={{
              padding: '10px 20px',
              backgroundColor: '#e5e7eb',
              color: '#374151',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: saving || sendingEmail ? 'not-allowed' : 'pointer',
              opacity: saving || sendingEmail ? 0.6 : 1
            }}
          >
            Cancel
          </button>
          {viewMode ? (
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                backgroundColor: '#14B8A6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          ) : (
            <>
              {selectedEmployeeId && employeeData && (
                <button
                  onClick={() => setShowPreview(true)}
                  disabled={saving || sendingEmail}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: (saving || sendingEmail) ? '#9ca3af' : '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: (saving || sendingEmail) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Eye size={16} />
                  Preview Notice
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || sendingEmail || !selectedEmployeeId}
                style={{
                  padding: '10px 20px',
                  backgroundColor: saving || sendingEmail ? '#9ca3af' : '#14B8A6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: saving || sendingEmail || !selectedEmployeeId ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {saving || sendingEmail ? (
                  <>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid white',
                      borderTop: '2px solid transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    {sendingEmail ? 'Sending...' : 'Saving...'}
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Save & {formData.send_email ? 'Send Email' : 'Record'}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          padding: '20px'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowPreview(false);
          }
        }}
        >
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
            position: 'relative'
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
              borderBottom: '2px solid #e5e7eb',
              paddingBottom: '16px'
            }}>
              <h2 style={{
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#111827',
                margin: 0
              }}>
                Preview Termination Notice
              </h2>
              <button
                onClick={() => setShowPreview(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#6b7280',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div 
              dangerouslySetInnerHTML={{ __html: generateTerminationNoticeHTML() }}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '20px',
                backgroundColor: '#f9fafb'
              }}
            />
            
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end',
              marginTop: '20px',
              paddingTop: '20px',
              borderTop: '2px solid #e5e7eb'
            }}>
              <button
                onClick={() => setShowPreview(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#e5e7eb',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default TerminationModal;

