// screens/HR/ContractManagement.jsx - TABBED VERSION
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText, Plus, Search, Filter, Eye, Edit, Trash2, AlertCircle, X, History, FileEdit, Shield, UserPlus, Upload, Save, ChevronUp, ChevronDown, Settings, LayoutDashboard, Clock, CheckCircle2, Send, Calendar, PenTool, Download } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import ContractFileUpload from '../../components/HR/ContractFileUpload';
import ContractAmendmentModal from '../../components/HR/ContractAmendmentModal';
import ContractAmendmentHistory from '../../components/HR/ContractAmendmentHistory';
import ComplianceTrackingModal from '../../components/HR/ComplianceTrackingModal';
import AddEmployeeModal from '../../components/HR/AddEmployeeModal';
import ContractEditorModal from '../../components/HR/ContractEditorModal';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { KeyTermsModal, SpecialConsiderationsModal, SelectTermsModal, ReviewContractModal } from '../../components/HR/ContractModals';
import SendContractModal from '../../components/HR/SendContractModal';
import toast from 'react-hot-toast';
import { createEmployeeFromContract } from '../../utils/contractEmployeeCreation';
import {
  buildSerializableContractData,
  enrichContractRowWithDisplayEmployee,
  formatContractHrFromName,
  getContractEmployeeDisplay,
  loadContractFlowDataFromRow,
  normalizeContractEmail,
  parseContractWageAmount,
  pickBusinessDisplayName,
  resolveBusinessDisplayName,
  resolveContractEmployeeId,
  saveContractSections,
} from '../../utils/contractPersistence';
import { formatDateForBusiness, formatDateNumeric, formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  buildContractTemplateExportPayload,
  downloadJsonPayload,
  parseContractTemplateImportPayload,
  sanitizeSectionForInsert,
  slugifyFilename,
} from '../../utils/contractTemplateTransfer';

function ContractManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const businessContext = useBusinessContext();
  const contextBusinessId = businessContext?.selectedBusinessId ?? null;

  // Active Tab
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Authentication state
  const [authUser, setAuthUser] = useState(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [businessData, setBusinessData] = useState(null);

  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // View Contracts Tab State
  const [contracts, setContracts] = useState([]);
  const [contractFiles, setContractFiles] = useState({});
  const [complianceRecords, setComplianceRecords] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedContract, setSelectedContract] = useState(null);
  const [showFileModal, setShowFileModal] = useState(false);
  const [error, setError] = useState(null);
  
  // Drafts Tab State
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  
  // Create Contract Tab State
  const [contractSections, setContractSections] = useState([]);
  const [contractTitle, setContractTitle] = useState('Employment Agreement');
  const [contractType, setContractType] = useState('employment');
  const [editingSection, setEditingSection] = useState(null);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Modal states
  const [showAmendmentModal, setShowAmendmentModal] = useState(false);
  const [showAmendmentHistory, setShowAmendmentHistory] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedContractFile, setSelectedContractFile] = useState(null);
  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const [selectedEmployeeForCompliance, setSelectedEmployeeForCompliance] = useState(null);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [showContractEditor, setShowContractEditor] = useState(false);
  
  // Dashboard state
  const [contractStats, setContractStats] = useState({
    completed: 0,
    completedContracts: [],
    ending: [],
    awaiting: [],
    awaitingSignature: [],
    awaitingAuthRep: []
  });
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [showEndingModal, setShowEndingModal] = useState(false);
  const [showAwaitingModal, setShowAwaitingModal] = useState(false);
  const [showAwaitingAuthRepModal, setShowAwaitingAuthRepModal] = useState(false);
  
  // Contract Creation Flow State
  const [contractFlowStep, setContractFlowStep] = useState(1);
  const [contractFlowData, setContractFlowData] = useState({
    keyTerms: {
      firstName: '',
      lastName: '',
      positionTitle: '',
      employeeAddress: '',
      employeePhone: '',
      managerId: '',
      managerName: '',
      employmentType: 'permanent',
      employmentStatus: 'full-time',
      contractStartDate: '',
      contractEndDate: '',
      probationaryPeriod: 90,
      baseHourlyWage: '',
      vacationPayRate: '',
      primaryWorkLocation: '',
      employerContactEmail: '',
      employeeEmail: ''
    },
    contractPreamble: '', // Editable contract header/preamble
    specialConsiderations: {
      notApplicable: false,
      profitSharing: {
        enabled: false,
        title: 'Profit Sharing',
        sections: []
      },
      shiftPremium: {
        enabled: false,
        title: 'Shift Premium',
        sections: []
      },
      signingBonus: {
        enabled: false,
        title: 'Signing Bonus',
        sections: []
      },
      other: {
        enabled: false,
        title: 'Other Considerations',
        sections: []
      }
    },
    selectedTerms: [],
    finalContract: null
  });
  const [showKeyTermsModal, setShowKeyTermsModal] = useState(false);
  const [showSpecialConsiderationsModal, setShowSpecialConsiderationsModal] = useState(false);
  const [showSelectTermsModal, setShowSelectTermsModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showSendContractModal, setShowSendContractModal] = useState(false);
  
  // Bulk portal access creation state
  const [creatingBulkPortalAccess, setCreatingBulkPortalAccess] = useState(false);

  // Save contract as draft
  const handleSaveDraft = async (contractData) => {
    if (!selectedBusinessId || !authUser) {
      toast.error('Missing required information to save draft');
      return;
    }

    try {
      const { keyTerms, selectedTerms, specialConsiderations, contractPreamble } = contractData;
      
      // Siloed: contract stores employee info on the row only. Link employee_id only if
      // they are already on THIS business roster (never from global email lookup).
      const employeeId = keyTerms.employeeEmail
        ? await resolveContractEmployeeId(selectedBusinessId, keyTerms)
        : null;

      // Generate signing tokens (required even for drafts)
      const signingToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      const authorizedRepSigningToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Prepare contract data for draft - save full contract data as JSON
      const draftData = {
        business_id: selectedBusinessId,
        employee_id: employeeId,
        manager_id: authUser.id,
        contract_type: keyTerms.employmentType || 'permanent',
        employment_status: keyTerms.employmentStatus || 'full-time',
        status: 'draft', // Use 'draft' status instead of 'pending'
        start_date: keyTerms.contractStartDate || null,
        end_date: keyTerms.contractEndDate || null,
        wage_amount: parseContractWageAmount(keyTerms),
        wage_type: 'hourly',
        position_title: keyTerms.positionTitle || null,
        employee_address: keyTerms.employeeAddress || null,
        employee_email: keyTerms.employeeEmail || null,
        employee_first_name: keyTerms.firstName || null,
        employee_last_name: keyTerms.lastName || null,
        signing_token: signingToken, // Required field - generate even for drafts
        authorized_representative_signing_token: authorizedRepSigningToken, // Generate for consistency
        contract_data: buildSerializableContractData({
          keyTerms,
          selectedTerms: selectedTerms || [],
          specialConsiderations: specialConsiderations || {},
          contractPreamble: contractPreamble || '',
        }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Check if this is an update to existing draft
      let contractId;
      if (contractData.finalContract?.id && contractData.finalContract?.status === 'draft') {
        // Update existing draft - don't regenerate tokens if they already exist
        const { data: existingContract, error: fetchError } = await supabase
          .from('hr_contracts')
          .select('signing_token, authorized_representative_signing_token')
          .eq('id', contractData.finalContract.id)
          .single();
        
        if (!fetchError && existingContract) {
          // Preserve existing tokens
          draftData.signing_token = existingContract.signing_token || draftData.signing_token;
          draftData.authorized_representative_signing_token = existingContract.authorized_representative_signing_token || draftData.authorized_representative_signing_token;
        }
        
        // Update existing draft
        const { data: updateData, error: updateError } = await supabase
          .from('hr_contracts')
          .update({
            ...draftData,
            updated_at: new Date().toISOString()
          })
          .eq('id', contractData.finalContract.id)
          .select()
          .single();
        
        if (updateError) throw updateError;
        contractId = updateData.id;
      } else {
        // Insert new draft
        const { data, error } = await supabase
          .from('hr_contracts')
          .insert(draftData)
          .select()
          .single();

        if (error) throw error;
        contractId = data.id;
      }

      await saveContractSections(contractId, selectedTerms);

      toast.success('Contract saved as draft successfully');
      
      // Update contractFlowData with the saved draft ID
      setContractFlowData(prev => ({
        ...prev,
        finalContract: { id: contractId, status: 'draft' }
      }));
      
      // Close the review modal and mark step 4 as complete
      setShowReviewModal(false);
      setContractFlowStep(5);
      
      // Reload contracts list if on view or drafts tab
      if (activeTab === 'view' || activeTab === 'drafts') {
        loadContracts();
        if (activeTab === 'drafts') {
          loadDrafts();
        }
      }
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error('Failed to save draft: ' + error.message);
      throw error;
    }
  };

  // Save contract with status
  const handleSaveContract = async (contractData, status = 'pending') => {
    if (!selectedBusinessId || !authUser) {
      toast.error('Missing required information to save contract');
      return;
    }

    try {
      const { keyTerms, selectedTerms, specialConsiderations } = contractData;
      
      const employeeId = keyTerms.employeeEmail
        ? await resolveContractEmployeeId(selectedBusinessId, keyTerms)
        : null;

      const contractRecord = {
        business_id: selectedBusinessId,
        employee_id: employeeId,
        manager_id: authUser.id,
        contract_type: keyTerms.employmentType || 'permanent',
        employment_status: keyTerms.employmentStatus || 'full-time',
        status: status,
        start_date: keyTerms.contractStartDate || null,
        end_date: keyTerms.contractEndDate || null,
        wage_amount: parseContractWageAmount(keyTerms),
        wage_type: 'hourly',
        position_title: keyTerms.positionTitle || null,
        employee_address: keyTerms.employeeAddress || null,
        employee_email: keyTerms.employeeEmail || null,
        employee_first_name: keyTerms.firstName || null,
        employee_last_name: keyTerms.lastName || null,
        contract_data: buildSerializableContractData(contractData),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Check if contract already exists (for updates)
      let contractId;
      if (contractData.finalContract?.id) {
        // Update existing contract
        const { data: updateData, error: updateError } = await supabase
          .from('hr_contracts')
          .update({
            ...contractRecord,
            updated_at: new Date().toISOString()
          })
          .eq('id', contractData.finalContract.id)
          .select()
          .single();
        
        if (updateError) throw updateError;
        contractId = updateData.id;
      } else {
        // Insert new contract
        const { data, error } = await supabase
          .from('hr_contracts')
          .insert(contractRecord)
          .select()
          .single();

        if (error) throw error;
        contractId = data.id;
      }

      await saveContractSections(contractId, selectedTerms);

      // Return the saved contract with the ID
      const { data: savedContract, error: fetchError } = await supabase
        .from('hr_contracts')
        .select('*')
        .eq('id', contractId)
        .single();

      if (fetchError) throw fetchError;

      return savedContract;
    } catch (error) {
      console.error('Error saving contract:', error);
      throw error;
    }
  };

  const canViewContracts = hasAnyPermission(['hr.contracts.view', 'hr.contracts.view_all']) || hasElevatedPrivileges();
  const canCreateContracts = hasPermission('hr.contracts.create') || hasElevatedPrivileges();
  const canEditContracts = hasPermission('hr.contracts.edit') || hasElevatedPrivileges();
  const canDeleteContracts = hasPermission('hr.contracts.delete') || isOwner();
  const canManageFiles = hasPermission('hr.contracts.manage_files') || hasElevatedPrivileges();
  const canAmendContracts = hasPermission('hr.contracts.amend') || hasElevatedPrivileges();
  const canViewCompliance = hasPermission('hr.compliance.view') || hasElevatedPrivileges();
  const canCreateCompliance = hasPermission('hr.compliance.create') || hasElevatedPrivileges();
  const canCreateEmployees = hasPermission('hr.employees.create') || hasElevatedPrivileges();

  // Default contract sections for builder - Seasonal Part Time Template
  const defaultContractSections = [
    {
      id: 'header',
      title: 'EMPLOYMENT CONTRACT - SEASONAL PART TIME',
      content: 'THIS EMPLOYMENT CONTRACT (the "Agreement") dated this [DATE] day of [MONTH], [YEAR]\n\n[EMPLOYER NAME] of [EMPLOYER ADDRESS]\n(the "Employer")\n\n[EMPLOYEE NAME] of [EMPLOYEE ADDRESS]\n(the "Employee")\n\nBACKGROUND:\n\nThe employer is of the opinion that the Employee has the necessary qualifications, experience and abilities to assist and benefit the Employer in its business.\n\nThe Employer desires to employ the Employee and the Employee has agreed to accept and enter such employment upon the terms and conditions set out in this Agreement.\n\nIN CONSIDERATION OF the matters described above and of the mutual benefits and obligations set forth in this Agreement, the receipt and sufficiency of which consideration is hereby acknowledged, the parties to this Agreement agree as follows:',
      section_order: 1,
      is_required: true,
      required_for: 'all',
      section_type: 'header',
      subsections: []
    },
    {
      id: 'key_terms',
      title: '1. EMPLOYMENT CONTRACT – KEY TERMS SUMMARY',
      content: 'Employee Name: [EMPLOYEE_NAME]\nPosition: [POSITION]\nEmployment Type: Seasonal, Part-Time\nContract Start Date: [START_DATE]\nContract End Date: [END_DATE]\nProbationary Period: 3 months (Ends [PROBATION_END])\nBase Hourly Wage: $[WAGE] per hour or current Ontario minimum wage, whichever is greater\nVacation Pay Rate: 4% (paid weekly)\nPrimary Work Location: [WORK_LOCATION]\nEmployer Contact Email: [EMPLOYER_EMAIL]\nEmployee Phone: [EMPLOYEE_PHONE]\nEmployee Email: [EMPLOYEE_EMAIL]',
      section_order: 2,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: []
    },
    {
      id: 'commencement',
      title: '2. COMMENCEMENT DATE & TERM',
      content: 'The Employee will commence this renewed term of employment on the date specified in the Key Terms Summary as the "Contract Start Date." Subject to the Probationary Period and termination provisions of this Agreement, this renewed term will end on the "Contract End Date" listed in the Key Terms Summary.',
      section_order: 3,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'commencement_2_1',
          title: '2.1',
          content: 'The Employee will commence this renewed term of employment on the date specified in the Key Terms Summary as the "Contract Start Date." Subject to the Probationary Period and termination provisions of this Agreement, this renewed term will end on the "Contract End Date" listed in the Key Terms Summary.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'commencement_2_2',
          title: '2.2',
          content: 'Subject to the Probationary Period and the termination provisions in this Agreement, the Employee\'s employment is defined as a fixed-term position as outlined in the Key Terms Summary. This Agreement will automatically expire on the "Contract End Date" without further notice or compensation. The parties agree that this end date constitutes advance notice under the Employment Standards Act, 2000 ("ESA"). No further notice, pay in lieu, or severance will be owed at the conclusion of the term, unless otherwise required by the ESA.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'commencement_2_3',
          title: '2.3',
          content: 'The Employee agrees and acknowledges that no work shall be performed beyond the Contract End Date unless a new written agreement is signed by both parties. Performing work beyond the Contract End Date shall not constitute an automatic renewal or imply indefinite employment status.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'commencement_2_4',
          title: '2.4',
          content: 'The Employee must successfully complete a probationary period as defined in the Key Terms Summary. At any time during the Probationary Period, as and where permitted by law, the Employer may terminate employment without any notice or compensation beyond wages owed for hours already worked. If employment continues beyond the Probationary Period, the Employee will be deemed to have successfully completed probation and will be subject to the termination provisions outlined in the "Termination of Employment" section below.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'commencement_2_5',
          title: '2.5',
          content: 'For clarity, this Agreement is intended to comply with all minimum standards under the Employment Standards Act, 2000. In the event any term of this Agreement provides less than the statutory minimum, the provisions of the Act shall prevail.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'job_description',
      title: '3. JOB TITLE & DESCRIPTION',
      content: 'The initial job title of the Employee will be as specified in the Key Terms Summary.',
      section_order: 4,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'job_3_1',
          title: '3.1',
          content: 'The initial job title of the Employee will be as specified in the Key Terms Summary.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'job_3_2',
          title: '3.2',
          content: 'The Employee agrees to be employed on the terms and conditions set out in this Agreement. The Employee agrees to be subject to the general supervision of and act pursuant to the orders, advice and direction of the Employer.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'job_3_3',
          title: '3.3',
          content: 'The Employee will perform any and all duties as requested by the Employer that are reasonable and that are customarily performed by a person holding a similar position in the industry or business of the Employer.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'job_3_4',
          title: '3.4',
          content: 'The Employer may make changes to the job title or duties of the Employee where the changes would be considered reasonable for a similar position in the industry or business of the Employer. The Employee\'s job title or duties may be changed by agreement and with the approval of both the Employee and the Employer or after a notice period required under law.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'job_3_5',
          title: '3.5',
          content: 'The Employee agrees to abide by the Employer\'s rules, regulations, policies and practices, including those concerning work schedules, vacation and sick leave, as they may from time to time be adopted or modified.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'compensation',
      title: '4. EMPLOYEE COMPENSATION',
      content: 'The Employee will be compensated at the hourly wage indicated in the Key Terms Summary, or the prevailing general minimum wage in Ontario at the time of hire, whichever is greater, for all hours worked during the Employer\'s standard operating schedule.',
      section_order: 5,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'compensation_4_1',
          title: '4.1',
          content: 'The Employee will be compensated at the hourly wage indicated in the Key Terms Summary, or the prevailing general minimum wage in Ontario at the time of hire, whichever is greater, for all hours worked during the Employer\'s standard operating schedule.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'compensation_4_2',
          title: '4.2',
          content: 'This base wage will be paid weekly by cheque, e-transfer, or direct deposit on Fridays. The Employer will make all required statutory deductions from the Employee\'s wages as required by law.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'compensation_4_3',
          title: '4.3',
          content: 'The Employee understands and agrees that any additional remuneration paid in the form of bonuses, premiums, or incentives is entirely discretionary. The Employee shall not earn or accrue any entitlement to such payments by reason of their employment, even if such payments are provided regularly or repeatedly.\n\nDiscretionary compensation does not form part of the Employee\'s base wage, and its repetition in past contracts shall not create a right or expectation in future contracts unless expressly incorporated into a written amendment signed by both parties.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'compensation_4_4',
          title: '4.4',
          content: 'The Employer will reimburse the Employee for all reasonable expenses, in accordance with the Employer\'s lawful policies as in effect from time to time, including but not limited to, any travel and entertainment expenses incurred by the Employee in connection with the business of the Employer. Expenses will be paid within a reasonable time after submission of acceptable supporting documentation.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'shift_premiums',
      title: '5. SHIFT PREMIUMS',
      content: 'The Employer may, at its sole discretion, apply premium pay for hours worked outside of the Employer\'s normal open/operating hours, which are defined as beginning one (1) hour before customers are permitted to enter the facility / property and ending one (1) hour after customers are permitted to be within the building / on property.\n\nWhen granted, the standard premium rate will be an additional $1.00 per hour on top of the Employee\'s base wage.',
      section_order: 6,
      is_required: false,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'premiums_5_1',
          title: '5.1',
          content: 'The Employer may, at its sole discretion, apply premium pay for hours worked outside of the Employer\'s normal open/operating hours, which are defined as beginning one (1) hour before customers are permitted to enter the facility / property and ending one (1) hour after customers are permitted to be within the building / on property.\n\nWhen granted, the standard premium rate will be an additional $1.00 per hour on top of the Employee\'s base wage.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'premiums_5_2',
          title: '5.2',
          content: 'The Employer may apply skill-based premiums for Employees who hold valid, relevant to their role, certifications not provided or paid for by the Employer. These premiums may include:\n\nFirst Aid Certification: An additional $0.25 per hour, provided the certificate remains current and valid.\n\nFood Safety Certification: An additional $0.25 per hour, provided the certificate remains current and valid.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'premiums_5_3',
          title: '5.3',
          content: 'The employer reserves the right to introduce other shift premiums based on the needs of the business. All premiums are entirely discretionary and may be changed, suspended, or discontinued by the Employer at any time without notice or compensation, provided such changes are applied consistently and in accordance with applicable employment legislation.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'place_of_work',
      title: '6. PLACE OF WORK',
      content: 'The Employee\'s primary place of work will be the location specified in the Key Terms Summary.',
      section_order: 7,
      is_required: false,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'place_6_1',
          title: '6.1',
          content: 'The Employee\'s primary place of work will be the location specified in the Key Terms Summary.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'hours_of_work',
      title: '7. TIME OF WORK / HOURS OF WORK',
      content: 'The Employee will, on receiving reasonable notice from the Employer, work additional hours and/or hours outside of the Employee\'s Normal Hours of Work as deemed necessary by the Employer to meet the business needs of the Employer.',
      section_order: 8,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'hours_7_1',
          title: '7.1',
          content: 'The Employee will, on receiving reasonable notice from the Employer, work additional hours and/or hours outside of the Employee\'s Normal Hours of Work as deemed necessary by the Employer to meet the business needs of the Employer.\n\nThe Employer will provide reasonable notice in accordance with the Employment Standards Act, 2000, of schedule changes, taking into account the nature of the business and operational needs. The Employee acknowledges that flexibility is required during peak business periods or special events.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'hours_7_2',
          title: '7.2',
          content: 'Part time is defined as an employee who works less than 30 hours per week. The employer does not guarantee any minimum number of hours for part time staff. Full time is defined as an employee who works 30 hours or more per week. The employer guarantees 30 hours per week for any staff member who\'s contract and / or offer of permanent employment states "FULL TIME."',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'hours_7_3',
          title: '7.3',
          content: 'The Employee acknowledges that hours worked beyond the thresholds set out in the ESA will be paid in accordance with applicable overtime requirements. The Employee agrees not to work unauthorized overtime.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'hours_7_4',
          title: '7.4',
          content: 'The Employee is not permitted to work overtime without prior written approval from the Employer. Any unauthorized overtime must still be paid in accordance with the Employment Standards Act, 2000. However, working unauthorized overtime may result in disciplinary action, up to and including termination for cause, where permitted by law.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'benefits',
      title: '8. EMPLOYEE BENEFITS',
      content: 'The Employee will be entitled to only those additional benefits that are currently available as described in the lawful provisions of the Employer\'s employment booklets, manuals, and policy documents or as required by law.',
      section_order: 9,
      is_required: false,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'benefits_8_1',
          title: '8.1',
          content: 'The Employee will be entitled to only those additional benefits that are currently available as described in the lawful provisions of the Employer\'s employment booklets, manuals, and policy documents or as required by law.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'benefits_8_2',
          title: '8.2',
          content: 'Employer discretionary benefits are subject to change, without compensation, upon the Employer providing the Employee with 60 days written notice of that change and providing that any change to those benefits is taken generally with respect to other employees and does not single out the Employee.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'vacation',
      title: '9. VACATION',
      content: 'The Employee will receive vacation pay at the rate specified in the Key Terms Summary, or the minimum required by the ESA, whichever is greater. Vacation pay will be paid on a weekly basis together with regular wages.',
      section_order: 10,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'vacation_9_1',
          title: '9.1',
          content: 'The Employee will receive vacation pay at the rate specified in the Key Terms Summary, or the minimum required by the ESA, whichever is greater. Vacation pay will be paid on a weekly basis together with regular wages.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'vacation_9_2',
          title: '9.2',
          content: 'The times and dates for any vacation will be determined by mutual agreement between the Employer and the Employee. The Employer reserves the right to establish VACATION BLACKOUT PERIODS, during which vacation time may not be taken due to operational needs or peak business periods. Blackout periods will be communicated to staff in advance and applied consistently across employees in similar roles.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'vacation_9_3',
          title: '9.3',
          content: 'As vacation pay is paid weekly along with regular wages, there will be no accrued but unused vacation pay at the time of termination. The Employee acknowledges that vacation entitlements are satisfied on a pay-as-you-go basis in accordance with the Employment Standards Act, 2000.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'conflict',
      title: '10. CONFLICT OF INTEREST',
      content: 'During the term of the Employee\'s active employment with the Employer, it is understood and agreed that any business opportunity relating to or similar to the Employer\'s actual or reasonably anticipated business opportunities coming to the attention of the Employee, is an opportunity belonging to the Employer.',
      section_order: 11,
      is_required: false,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'conflict_10_1',
          title: '10.1',
          content: 'During the term of the Employee\'s active employment with the Employer, it is understood and agreed that any business opportunity relating to or similar to the Employer\'s actual or reasonably anticipated business opportunities (with the exception of personal investments in less than 5% of the equity of a business, investments in established family businesses, real estate, or investments in stocks and bonds traded on public stock exchanges) coming to the attention of the Employee, is an opportunity belonging to the Employer. Therefore, the Employee will advise the Employer of the opportunity and cannot pursue the opportunity, directly or indirectly, without the written consent of the Employer.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'conflict_10_2',
          title: '10.2',
          content: 'During the term of the Employee\'s active employment with the Employer, the Employee will not, directly or indirectly, engage or participate in any other business activities that the Employer, in its reasonable discretion, determines to be in conflict with the best interests of the Employer without the written consent of the Employer.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'non_competition',
      title: '11. NON-COMPETITION',
      content: 'The Employee agrees that during the Employee\'s term of active employment with the Employer the Employee will not, directly or indirectly, engage in any business that is in competition with the business of the Employer.',
      section_order: 12,
      is_required: false,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'noncomp_11_1',
          title: '11.1',
          content: 'The Employee agrees that during the Employee\'s term of active employment with the Employer the Employee will not, directly or indirectly, as employee, owner, sole proprietor, partner, director, member, consultant, agent, founder, co-venturer or otherwise, solely or jointly with others engage in any business that is in competition with the business of the Employer within any geographic area in or around London, Ontario, in which the Employer conducts its business, or give advice or lend credit, money or the Employee\'s reputation to any natural person or business entity engaged in a competing business in any geographic area in which the Employer conducts its business without the written consent of the Employer.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'non_solicitation',
      title: '12. NON-SOLICITATION',
      content: 'The Employee understands and agrees that any attempt on the part of the Employee to induce other employees or contractors to leave the Employer\'s employ would be harmful and damaging to the Employer.',
      section_order: 13,
      is_required: false,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'solicit_12_1',
          title: '12.1',
          content: 'The Employee understands and agrees that any attempt on the part of the Employee to induce other employees or contractors to leave the Employer\'s employ, or any effort by the Employee to interfere with the Employer\'s relationship with its other employees and contractors would be harmful and damaging to the Employer. The Employee agrees that during the Employee\'s term of employment with the Employer and for a period of one (1) year after the end of that term, the Employee will not in any way, directly or indirectly:\n\n• Induce or attempt to induce any employee or contractor of the Employer to quit employment or retainer with the Employer;\n\n• Otherwise interfere with or disrupt the Employer\'s relationship with its employees and contractors;\n\n• Discuss employment opportunities or provide information about competitive employment to any of the Employer\'s employees or contractors; or\n\n• Solicit, entice, or hire away any employee or contractor of the Employer for the purpose of an employment opportunity that is in competition with the Employer.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'solicit_12_2',
          title: '12.2',
          content: 'This non-solicitation obligation as described in this section will be limited to employees or contractors who were employees or contractors of the Employer during the period that the Employee was employed by the Employer.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'solicit_12_3',
          title: '12.3',
          content: 'During the term of the Employee\'s active employment with the Employer, and for one (1) year thereafter, the Employee will not divert or attempt to divert from the Employer any business the Employer had enjoyed, solicited, or attempted to solicit, from its customers, prior to termination or expiration, as the case may be, of the Employee\'s employment with the Employer.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'termination',
      title: '19. TERMINATION OF EMPLOYMENT',
      content: 'The Employer may terminate the Employee\'s employment for just cause, without notice or pay in lieu of notice, as permitted by the Employment Standards Act, 2000 (Ontario) (The "ESA").',
      section_order: 19,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'term_19_1',
          title: '19.1',
          content: 'The Employer may terminate the Employee\'s employment for just cause, without notice or pay in lieu of notice, as permitted by the Employment Standards Act, 2000 (Ontario) (The "ESA"). The Employer may use a range of progressive disciplinary actions including verbal warnings, written warnings, suspensions, demotions, and termination, but is not required to use them in any specific order.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'term_19_2',
          title: '19.2',
          content: 'The Employer may terminate the Employee\'s employment without cause at any time by providing the Employee with only the minimum notice of termination, termination pay, and severance pay (if applicable) required under the Employment Standards Act, 2000 (Ontario) (the "ESA"). The Employee agrees that this clause is intended to limit any entitlements strictly to the minimum standards under the ESA.\n\nFor Employees hired under a fixed-term or seasonal contract, the parties agree that the specified end date of employment in this Agreement constitutes advance notice of termination. No additional notice, pay in lieu of notice, severance, or damages will be owed at the end of the term, unless otherwise required by the ESA.',
          is_required: false,
          required_for: 'all'
        },
        {
          id: 'term_19_3',
          title: '19.3',
          content: 'If The Employee wishes to resign, they must provide the greater of one (1) week\'s written notice of the minimum required under the ESA. The Employer may waive the notice period by paying wages in lieu, or accept an earlier resignation date by mutual agreement. If the Employee actively cooperates in training a replacement, this may be accepted in lieu of full notice at the Employer\'s discretion.',
          is_required: false,
          required_for: 'all'
        }
      ]
    },
    {
      id: 'acknowledgement',
      title: '25. ACKNOWLEDGEMENT',
      content: 'The Employee acknowledges that they have read and understood this Agreement and have had the opportunity to obtain independent legal advice prior to signing.',
      section_order: 25,
      is_required: true,
      required_for: 'all',
      section_type: 'standard',
      subsections: [
        {
          id: 'ack_25_1',
          title: '25.1',
          content: 'The Employee acknowledges that they have read and understood this Agreement and have had the opportunity to obtain independent legal advice prior to signing.',
          is_required: false,
          required_for: 'all'
        }
      ]
    }
  ];

  useEffect(() => {
    if (!permissionsLoading && !canViewContracts) {
      toast.error('You do not have permission to view contract management');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewContracts]);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error || !session?.user) {
          setAuthLoading(false);
          navigate('/login');
          return;
        }

        setAuthUser(session.user);

        // Match usePOSAuth / BusinessContext: context first, then both localStorage keys
        const currentBusinessId =
          contextBusinessId ||
          localStorage.getItem('currentBusinessId') ||
          localStorage.getItem('selectedBusinessId');
        if (!currentBusinessId) {
          setAuthError('No business selected');
          setAuthLoading(false);
          return;
        }

        setSelectedBusinessId(currentBusinessId);

        const { data: business, error: businessError } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', currentBusinessId)
          .single();

        if (!businessError && business) {
          setBusinessData(business);
        }

        const { data: userRole, error: roleError } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('business_id', currentBusinessId)
          .eq('active', true)
          .single();

        if (roleError || !userRole) {
          setAuthError('Not authorized for this business');
          setAuthLoading(false);
          return;
        }

        setUserRole(userRole.role);
        setAuthLoading(false);

      } catch (err) {
        console.error('Authentication error:', err);
        setAuthError(err.message);
        setAuthLoading(false);
      }
    };

    initializeAuth();
  }, [navigate, contextBusinessId]);

  // Check for employee data from navigation and pre-fill contract form
  useEffect(() => {
    if (!authLoading && selectedBusinessId && location.state?.createContractForEmployee) {
      const employeeData = location.state.createContractForEmployee;
      
      console.log('[ContractManagement] Pre-filling contract form with employee data:', employeeData);
      
      // Pre-fill contractFlowData with employee information
      setContractFlowData(prev => ({
        ...prev,
        keyTerms: {
          firstName: employeeData.firstName || '',
          lastName: employeeData.lastName || '',
          positionTitle: employeeData.position || '',
          employeeAddress: employeeData.address || '',
          employmentType: 'permanent',
          employmentStatus: employeeData.employmentStatus || 'full-time',
          contractStartDate: employeeData.hireDate || new Date().toISOString().split('T')[0],
          contractEndDate: '',
          probationaryPeriod: 90,
          baseHourlyWage: employeeData.wage ? employeeData.wage.toString() : '',
          vacationPayRate: employeeData.vacationPercent ? (employeeData.vacationPercent * 100).toString() : '4',
          primaryWorkLocation: businessData?.business_address || businessData?.address || '',
          employerContactEmail: businessData?.business_email || businessData?.email || '',
          employeeEmail: employeeData.email || '',
          employeePhone: employeeData.phone || '',
          managerId: employeeData.manager_id || employeeData.managerId || '',
          managerName: employeeData.manager_name || employeeData.managerName || ''
        },
        finalContract: {
          employee_id: employeeData.id
        }
      }));
      
      // Open the Key Terms modal and start contract creation flow
      setActiveTab('create');
      setContractFlowStep(1);
      
      // Wait a bit for the tab to switch, then open the modal
      setTimeout(() => {
        setShowKeyTermsModal(true);
      }, 100);
      
      // Clear the location state so it doesn't reload on navigation
      navigate(location.pathname, { replace: true, state: {} });
      
      toast.success(`Creating contract for ${employeeData.firstName} ${employeeData.lastName}`);
    }
  }, [authLoading, selectedBusinessId, location.state, businessData, navigate]);

  useEffect(() => {
    if (selectedBusinessId && canViewContracts) {
      if (activeTab === 'view' || activeTab === 'dashboard') {
        loadContracts();
        loadEmployees();
        loadContractStats();
      } else if (activeTab === 'drafts') {
        loadDrafts();
      }
    }
  }, [selectedBusinessId, canViewContracts, activeTab]);

  // Refresh contract lists when returning to this page (e.g. after signing)
  useEffect(() => {
    const refreshContractData = () => {
      if (selectedBusinessId && canViewContracts && (activeTab === 'view' || activeTab === 'dashboard')) {
        loadContracts();
        loadContractStats();
      }
    };
    window.addEventListener('focus', refreshContractData);
    return () => window.removeEventListener('focus', refreshContractData);
  }, [selectedBusinessId, canViewContracts, activeTab]);

  // Load templates when Create Contract tab is opened
  useEffect(() => {
    if (activeTab === 'create' && selectedBusinessId) {
      loadContractTemplates();
    }
  }, [activeTab, selectedBusinessId]);

  // Delete contract template
  const handleDeleteTemplate = async (templateId) => {
    if (!templateId || !selectedBusinessId) return;
    
    const confirmed = window.confirm('Are you sure you want to delete this template? This will also delete all sections associated with this template. This action cannot be undone.');
    if (!confirmed) return;
    
    try {
      // Delete all sections for this template first (to avoid foreign key constraint issues)
      const { error: sectionsError } = await supabase
        .from('contract_template_sections')
        .delete()
        .eq('template_id', templateId);
      
      if (sectionsError) throw sectionsError;
      
      // Delete the template
      const { error: templateError } = await supabase
        .from('contract_templates')
        .delete()
        .eq('id', templateId)
        .eq('business_id', selectedBusinessId);
      
      if (templateError) throw templateError;
      
      // If the deleted template was currently selected, clear the selection
      if (selectedTemplateId === templateId) {
        setSelectedTemplateId(null);
        setContractSections([]);
        setContractTitle('Employment Agreement');
        setContractType('employment');
      }
      
      // Reload templates list
      await loadContractTemplates();
      
      toast.success('Template deleted successfully');
    } catch (error) {
      console.error('[ContractManagement] Error deleting template:', error);
      toast.error('Failed to delete template: ' + error.message);
    }
  };

  const pickImportTemplateName = async (businessId, desiredName) => {
    const base = (desiredName || 'Imported template').trim();
    const { data: rows } = await supabase
      .from('contract_templates')
      .select('template_name')
      .eq('business_id', businessId)
      .eq('is_active', true);
    const existing = new Set((rows || []).map((r) => (r.template_name || '').trim().toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    for (let n = 1; n < 200; n += 1) {
      const suffix = n === 1 ? ' (imported)' : ` (imported ${n})`;
      const candidate = `${base}${suffix}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} (${Date.now()})`;
  };

  const handleExportSelectedContractTemplate = async () => {
    if (!selectedBusinessId || !authUser) {
      toast.error('Missing business or sign-in.');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('Select a template in the list, then export.');
      return;
    }
    try {
      const { data: template, error: tErr } = await supabase
        .from('contract_templates')
        .select('template_name, contract_type, is_default, is_active')
        .eq('id', selectedTemplateId)
        .eq('business_id', selectedBusinessId)
        .single();
      if (tErr) throw tErr;
      const { data: sections, error: sErr } = await supabase
        .from('contract_template_sections')
        .select('title, content, section_order, is_required, required_for, section_type, placeholder_tags')
        .eq('template_id', selectedTemplateId)
        .order('section_order', { ascending: true });
      if (sErr) throw sErr;
      if (!sections || sections.length === 0) {
        toast.error('This template has no sections to export.');
        return;
      }
      const sourceName = businessData?.business_name || businessData?.name || null;
      const payload = buildContractTemplateExportPayload({
        templates: [{ ...template, sections }],
        sourceBusinessName: sourceName,
        sourceBusinessId: selectedBusinessId,
      });
      downloadJsonPayload(payload, template.template_name || 'contract-template');
      toast.success('Template downloaded');
    } catch (e) {
      console.error('[ContractManagement] Export template:', e);
      toast.error('Export failed: ' + (e.message || 'Unknown error'));
    }
  };

  const handleExportAllContractTemplates = async () => {
    if (!selectedBusinessId || !authUser) {
      toast.error('Missing business or sign-in.');
      return;
    }
    try {
      const { data: templates, error } = await supabase
        .from('contract_templates')
        .select('id, template_name, contract_type, is_default, is_active')
        .eq('business_id', selectedBusinessId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!templates || templates.length === 0) {
        toast.error('No templates to export.');
        return;
      }
      const ids = templates.map((t) => t.id);
      const { data: allSections, error: sErr } = await supabase
        .from('contract_template_sections')
        .select('template_id, title, content, section_order, is_required, required_for, section_type, placeholder_tags')
        .in('template_id', ids)
        .order('section_order', { ascending: true });
      if (sErr) throw sErr;
      const byTemplate = {};
      (allSections || []).forEach((s) => {
        if (!byTemplate[s.template_id]) byTemplate[s.template_id] = [];
        byTemplate[s.template_id].push(s);
      });
      const bundled = templates.map((t) => ({
        template_name: t.template_name,
        contract_type: t.contract_type,
        is_default: t.is_default,
        is_active: t.is_active,
        sections: byTemplate[t.id] || [],
      }));
      const empty = bundled.find((b) => !b.sections || b.sections.length === 0);
      if (empty) {
        toast.error(
          `Template "${empty.template_name}" has no sections. Add sections or remove that template before exporting all.`
        );
        return;
      }
      const sourceName = businessData?.business_name || businessData?.name || null;
      const payload = buildContractTemplateExportPayload({
        templates: bundled,
        sourceBusinessName: sourceName,
        sourceBusinessId: selectedBusinessId,
      });
      const slug = sourceName ? slugifyFilename(sourceName, 'all-contract-templates') : 'all-contract-templates';
      downloadJsonPayload(payload, slug);
      toast.success(`Exported ${bundled.length} template(s)`);
    } catch (e) {
      console.error('[ContractManagement] Export all templates:', e);
      toast.error('Export failed: ' + (e.message || 'Unknown error'));
    }
  };

  const handleImportContractTemplatesFile = async (file) => {
    if (!file) return;
    if (!selectedBusinessId || !authUser?.id) {
      toast.error('Select a business and sign in before importing.');
      return;
    }
    const tid = toast.loading('Importing templates…');
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast.dismiss(tid);
        toast.error('Invalid JSON file.');
        return;
      }
      const parsedResult = parseContractTemplateImportPayload(parsed);
      if (parsedResult.error) {
        toast.dismiss(tid);
        toast.error(parsedResult.error);
        return;
      }
      const { templates } = parsedResult;
      let imported = 0;
      for (let i = 0; i < templates.length; i += 1) {
        const t = templates[i];
        const templateName = await pickImportTemplateName(selectedBusinessId, t.template_name);
        const { data: newRow, error: insErr } = await supabase
          .from('contract_templates')
          .insert({
            business_id: selectedBusinessId,
            template_name: templateName,
            contract_type: t.contract_type || 'employment',
            is_default: false,
            is_active: true,
            created_by: authUser.id,
          })
          .select('id')
          .single();
        if (insErr || !newRow) {
          throw new Error(insErr?.message || `Failed to create template "${templateName}"`);
        }
        const sectionsToInsert = (t.sections || [])
          .map((s, idx) => sanitizeSectionForInsert(s, newRow.id, idx))
          .filter(Boolean);
        if (sectionsToInsert.length === 0) {
          await supabase.from('contract_templates').delete().eq('id', newRow.id);
          throw new Error(`No valid sections for template "${templateName}".`);
        }
        const { error: secErr } = await supabase.from('contract_template_sections').insert(sectionsToInsert);
        if (secErr) {
          await supabase.from('contract_templates').delete().eq('id', newRow.id);
          throw new Error(secErr.message);
        }
        imported += 1;
      }
      await loadContractTemplates();
      toast.dismiss(tid);
      toast.success(imported === 1 ? 'Imported 1 template.' : `Imported ${imported} templates.`);
    } catch (e) {
      console.error('[ContractManagement] Import templates:', e);
      toast.dismiss(tid);
      toast.error('Import failed: ' + (e.message || 'Unknown error'));
    }
  };

  // Load contract templates from database
  const loadContractTemplates = async () => {
    if (!selectedBusinessId) {
      console.log('[ContractManagement] Cannot load templates: no selectedBusinessId');
      return;
    }
    
    setLoadingTemplates(true);
    try {
      console.log('[ContractManagement] Loading templates for business:', selectedBusinessId);
      const { data: templates, error } = await supabase
        .from('contract_templates')
        .select('id, template_name, contract_type, business_id, is_active, created_at, updated_at')
        .eq('business_id', selectedBusinessId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[ContractManagement] Supabase error loading templates:', error);
        throw error;
      }

      console.log('[ContractManagement] Loaded templates:', templates);
      setAvailableTemplates(templates || []);

      // Don't auto-load defaults - users must create/save templates
      // If no templates exist, start with empty sections
      if ((!templates || templates.length === 0) && contractSections.length === 0) {
        console.log('[ContractManagement] No templates found, starting with empty sections');
        setContractSections([]);
      }
    } catch (error) {
      console.error('[ContractManagement] Error loading contract templates:', error);
      // Start with empty sections if table doesn't exist
      if (contractSections.length === 0) {
        setContractSections([]);
      }
    } finally {
      setLoadingTemplates(false);
    }
  };

  // Load a specific template
  const loadTemplate = async (templateId) => {
    if (!templateId) {
      // Reset to empty
      setContractSections([]);
      setContractTitle('Employment Agreement');
      setContractType('employment');
      setSelectedTemplateId(null);
      return;
    }

    try {
      setLoadingTemplates(true);

      // Load template
      const { data: template, error: templateError } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (templateError) throw templateError;

      // Load sections
      const { data: sections, error: sectionsError } = await supabase
        .from('contract_template_sections')
        .select('*')
        .eq('template_id', templateId)
        .order('section_order', { ascending: true });

      if (sectionsError) throw sectionsError;

      // Transform sections: convert placeholder_tags back to subsections
      // Remove number prefixes from titles when loading (will be re-added on display)
      const transformedSections = (sections || []).map(section => {
        // Remove leading number pattern (e.g., "1. ", "2. ", "32. ")
        const titleWithoutNumber = section.title.replace(/^\d+\.\s*/, '');
        // Remove number prefixes from subsections too and ensure all are required
        const subsections = (section.placeholder_tags || []).map((sub, si) => {
          const clientId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? `subsection_${crypto.randomUUID()}`
              : `subsection_${section.id}_${si}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
          return {
            ...sub,
            id: clientId,
            title: sub.title ? sub.title.replace(/^\d+\.\d+\.?\s*/, '') : sub.title,
            is_required: true,
            required_for: sub.required_for || 'all',
          };
        });
        
        return {
          id: section.id,
          title: titleWithoutNumber,
          content: section.content,
          section_order: section.section_order,
          is_required: section.is_required,
          required_for: section.required_for || 'all',
          section_type: section.section_type || 'standard',
          subsections: subsections
        };
      });

      setContractTitle(template.template_name);
      setContractType(template.contract_type);
      setContractSections(transformedSections);
      setSelectedTemplateId(templateId);
    } catch (error) {
      console.error('Error loading template:', error);
      toast.error('Failed to load template');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadContracts = async () => {
    try {
      setLoading(true);
      
      // Load actual contracts from hr_contracts table
      const { data: contractsData, error: contractsError } = await supabase
        .from('hr_contracts')
        .select(`
          id,
          employee_id,
          employee_email,
          employee_first_name,
          employee_last_name,
          status,
          contract_type,
          employment_status,
          position_title,
          start_date,
          end_date,
          created_at,
          updated_at,
          signed_at,
          authorized_representative_signed_at,
          signing_token,
          authorized_representative_signing_token
        `)
        .eq('business_id', selectedBusinessId)
        .neq('status', 'draft') // Exclude drafts (they're in a separate tab)
        .order('created_at', { ascending: false })
        .limit(500);

      if (contractsError) {
        console.error('Error loading contracts:', contractsError);
        toast.error('Failed to load contracts');
        setContracts([]);
        return;
      }

      // Get unique employee IDs to load employee details
      const employeeIds = [...new Set((contractsData || [])
        .map(c => c.employee_id)
        .filter(id => id !== null))];

      let employeesMap = {};
      if (employeeIds.length > 0) {
        const { data: employeeData, error: employeeError } = await supabase
          .from('users')
          .select(`
            id, full_name, email, first_name, last_name, position, department,
            employment_status, hire_date, wage
          `)
          .in('id', employeeIds);

        if (!employeeError && employeeData) {
          employeesMap = employeeData.reduce((acc, user) => {
            acc[user.id] = user;
            return acc;
          }, {});
        }
      }

      // Enrich contracts with employee data (contract row names beat global users profile)
      const enrichedContracts = (contractsData || []).map((contract) => {
        const joined = employeesMap[contract.employee_id] || null;
        const display = getContractEmployeeDisplay({ ...contract, employee: joined });
        const firstName = display.firstName || 'Unknown';
        const lastName = display.lastName || '';
        
        return {
          id: contract.id,
          employee_id: contract.employee_id,
          title: `Employment Contract - ${firstName} ${lastName}`.trim(),
          status: contract.status, // Use actual status from database
          contract_type: contract.contract_type || 'permanent',
          employment_status: contract.employment_status || 'full-time',
          start_date: contract.start_date,
          end_date: contract.end_date,
          created_at: contract.created_at,
          updated_at: contract.updated_at,
          signed_at: contract.signed_at,
          authorized_representative_signed_at: contract.authorized_representative_signed_at,
          signing_token: contract.signing_token,
          authorized_representative_signing_token: contract.authorized_representative_signing_token,
          employee: {
            id: contract.employee_id || contract.employee_email,
            first_name: firstName,
            last_name: lastName,
            full_name: display.fullName,
            employee_number: contract.employee_id ? contract.employee_id.slice(0, 8) : 'N/A',
            email: display.email || contract.employee_email,
            position: contract.position_title || joined?.position,
            department: joined?.department,
            employment_status: contract.employment_status || joined?.employment_status,
            hire_date: contract.start_date || joined?.hire_date,
            wage: joined?.wage
          }
        };
      });

      setContracts(enrichedContracts);

      // Load contract files - use contract IDs or employee IDs
      const contractIds = enrichedContracts.map(c => c.id);
      const employeeIdsForFiles = [...new Set(enrichedContracts
        .map(c => c.employee_id)
        .filter(id => id !== null))];
      
      if (employeeIdsForFiles.length > 0 && canManageFiles) {
        const { data: filesData, error: filesError } = await supabase
          .from('contract_files')
          .select('id, employee_id, file_name, file_type, file_size, uploaded_at, storage_path')
          .in('employee_id', employeeIdsForFiles)
          .eq('business_id', selectedBusinessId)
          .limit(500);

        if (!filesError) {
          const filesGrouped = (filesData || []).reduce((acc, file) => {
            const contract = enrichedContracts.find(c => c.employee_id === file.employee_id);
            if (contract) {
              if (!acc[contract.id]) acc[contract.id] = [];
              acc[contract.id].push(file);
            }
            return acc;
          }, {});

          setContractFiles(filesGrouped);
        }
      }

      if (canViewCompliance) {
        const { data: complianceData, error: complianceError } = await supabase
          .from('compliance_dashboard')
          .select('id, employee_id, compliance_type, compliance_status, due_date, completion_date, priority_level, days_until_due')
          .eq('business_id', selectedBusinessId)
          .limit(500);

        if (!complianceError) {
          const complianceGrouped = (complianceData || []).reduce((acc, record) => {
            if (!acc[record.employee_id]) acc[record.employee_id] = [];
            acc[record.employee_id].push(record);
            return acc;
          }, {});

          setComplianceRecords(complianceGrouped);
        }
      }

    } catch (error) {
      console.error('Error loading contracts:', error);
      toast.error('Failed to load contracts');
      setError('Failed to load contracts');
    } finally {
      setLoading(false);
    }
  };

  // Load drafts
  const loadDrafts = async () => {
    if (!selectedBusinessId) return;
    
    try {
      setLoadingDrafts(true);
      
      const { data: draftsData, error } = await supabase
        .from('hr_contracts')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .eq('status', 'draft')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      setDrafts(draftsData || []);
    } catch (error) {
      console.error('Error loading drafts:', error);
      toast.error('Failed to load drafts');
    } finally {
      setLoadingDrafts(false);
    }
  };

  // Restore draft to contract creation flow
  const handleRestoreDraft = async (draft) => {
    try {
      // Load draft data from draft_data JSON column or reconstruct from contract fields
      let draftData = {};
      
      if (draft.contract_data && typeof draft.contract_data === 'object') {
        draftData = loadContractFlowDataFromRow(draft, businessData);
      } else if (draft.draft_data && typeof draft.draft_data === 'object') {
        draftData = draft.draft_data;
      } else {
        draftData = loadContractFlowDataFromRow(draft, businessData);
      }

      if (draft.id && (!draftData.selectedTerms || draftData.selectedTerms.length === 0)) {
        const { data: sectionsData } = await supabase
          .from('contract_sections')
          .select('id, title, content, section_order, is_required, section_type')
          .eq('contract_id', draft.id)
          .order('section_order', { ascending: true });

        if (sectionsData?.length) {
          draftData.selectedTerms = sectionsData;
        }
      }

      setContractFlowData({
        ...draftData,
        finalContract: { id: draft.id, status: draft.status || 'draft' }
      });

      // Switch to create tab and open at review step
      setActiveTab('create');
      setContractFlowStep(4);
      setShowReviewModal(true);
      
      toast.success('Draft restored successfully');
    } catch (error) {
      console.error('Error restoring draft:', error);
      toast.error('Failed to restore draft: ' + error.message);
    }
  };

  const loadEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, full_name, email, first_name, last_name, position, department,
          employment_status, hire_date, wage,
          business_users!inner(business_id, role)
        `)
        .eq('business_users.business_id', selectedBusinessId)
        .order('full_name');

      if (!error) {
        const transformedEmployees = (data || []).map(user => ({
          id: user.id,
          first_name: user.first_name || user.full_name?.split(' ')[0] || 'Unknown',
          last_name: user.last_name || user.full_name?.split(' ').slice(1).join(' ') || '',
          employee_number: user.id.slice(0, 8),
          email: user.email,
          position: user.position,
          department: user.department,
          employment_status: user.employment_status,
          hire_date: user.hire_date,
          wage: user.wage,
          role: user.business_users[0]?.role || 'employee'
        }));
        
        setEmployees(transformedEmployees);
      }
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  // Contract Builder Functions
  const handleAddSection = () => {
    const newSection = {
      id: `section_${Date.now()}`,
      title: 'New Section',
      content: 'Enter section content here...',
      section_order: contractSections.length + 1,
      is_required: false,
      required_for: 'none',
      section_type: 'standard',
      subsections: []
    };

    setContractSections([...contractSections, newSection]);
  };

  const handleAddSubsection = (parentId) => {
    const newSubsection = {
      id: `subsection_${Date.now()}`,
      title: 'New Subsection',
      content: 'Enter subsection content...',
      is_required: true,
      required_for: 'all'
    };

    setContractSections(contractSections.map(section => {
      if (section.id === parentId) {
        return {
          ...section,
          subsections: [...(section.subsections || []), newSubsection]
        };
      }
      return section;
    }));
  };

  const handleUpdateSection = (sectionId, field, value) => {
    setContractSections(contractSections.map(section =>
      section.id === sectionId ? { ...section, [field]: value } : section
    ));
  };

  const handleUpdateSubsection = (parentId, subsectionId, field, value) => {
    setContractSections(contractSections.map(section => {
      if (section.id === parentId) {
        return {
          ...section,
          subsections: (section.subsections || []).map(sub =>
            sub.id === subsectionId ? { ...sub, [field]: value } : sub
          )
        };
      }
      return section;
    }));
  };

  const handleDeleteSection = (sectionId) => {
    if (confirm('Delete this section?')) {
      setContractSections(contractSections.filter(s => s.id !== sectionId));
    }
  };

  const handleDeleteSubsection = (parentId, subsectionId) => {
    if (confirm('Delete this subsection?')) {
      setContractSections(contractSections.map(section => {
        if (section.id === parentId) {
          return {
            ...section,
            subsections: (section.subsections || []).filter(sub => sub.id !== subsectionId)
          };
        }
        return section;
      }));
    }
  };

  const handleMoveSection = (sectionId, direction) => {
    const index = contractSections.findIndex(s => s.id === sectionId);
    if (index === -1) return;

    const newSections = [...contractSections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newSections.length) return;

    [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];

    newSections.forEach((section, idx) => {
      section.section_order = idx + 1;
    });

    setContractSections(newSections);
  };

  const handleSaveContractTemplate = async () => {
    if (!contractTitle.trim()) {
      toast.error('Please enter a contract title');
      return;
    }

    if (!contractSections || contractSections.length === 0) {
      toast.error('Please add at least one section to the template');
      return;
    }

    console.log('[ContractManagement] Saving template:', {
      selectedTemplateId,
      contractTitle,
      contractType,
      sectionsCount: contractSections.length,
      selectedBusinessId,
      authUserId: authUser?.id
    });

    try {
      let templateId;

      if (selectedTemplateId) {
        console.log('[ContractManagement] Updating existing template:', selectedTemplateId);
        // Update existing template
        const { error: updateError } = await supabase
          .from('contract_templates')
          .update({
            template_name: contractTitle,
            contract_type: contractType,
            updated_at: new Date().toISOString()
          })
          .eq('id', selectedTemplateId);

        console.log('[ContractManagement] Template update result:', { error: updateError });

        if (updateError) throw updateError;

        // Delete existing sections
        console.log('[ContractManagement] Deleting existing sections for template:', selectedTemplateId);
        const { error: deleteError } = await supabase
          .from('contract_template_sections')
          .delete()
          .eq('template_id', selectedTemplateId);

        console.log('[ContractManagement] Sections delete result:', { error: deleteError });

        if (deleteError) throw deleteError;

        templateId = selectedTemplateId;
        toast.success('Contract template updated successfully');
      } else {
        console.log('[ContractManagement] Creating new template...');
        // Create new template
        const templateData = {
          business_id: selectedBusinessId,
          template_name: contractTitle,
          contract_type: contractType,
          is_default: false,
          is_active: true,
          created_by: authUser.id
        };
        console.log('[ContractManagement] Inserting template:', templateData);
        
        const { data: template, error: templateError } = await supabase
          .from('contract_templates')
          .insert(templateData)
          .select()
          .single();

        console.log('[ContractManagement] Template insert result:', {
          template,
          error: templateError,
          errorCode: templateError?.code,
          errorMessage: templateError?.message
        });

        if (templateError) throw templateError;
        templateId = template.id;
        setSelectedTemplateId(templateId);
        toast.success('Contract template saved successfully');
      }

      // Save sections
      console.log('[ContractManagement] Preparing sections to insert:', contractSections.length);
      const sectionsToInsert = contractSections.map((section, index) => {
        // Store title without number prefix (numbers are auto-generated on display)
        const titleWithoutNumber = section.title.replace(/^\d+\.\s*/, '');
        // Store subsections with titles without number prefixes and ensure all are required
        const subsectionsWithoutNumbers = (section.subsections || []).map((sub) => {
          const { id: _clientId, ...rest } = sub;
          return {
            ...rest,
            title: sub.title ? sub.title.replace(/^\d+\.\d+\.?\s*/, '') : sub.title,
            is_required: true, // Ensure all subsections are saved as required
            required_for: sub.required_for || 'all',
          };
        });
        
        return {
          template_id: templateId,
          title: titleWithoutNumber,
          content: section.content,
          section_order: section.section_order || (index + 1),
          is_required: section.is_required || false,
          required_for: section.required_for || 'all',
          section_type: section.section_type || 'standard',
          placeholder_tags: subsectionsWithoutNumbers
        };
      });

      console.log('[ContractManagement] Inserting sections:', sectionsToInsert.length, sectionsToInsert.slice(0, 2));

      const { error: sectionsError, data: insertedSections } = await supabase
        .from('contract_template_sections')
        .insert(sectionsToInsert)
        .select();

      console.log('[ContractManagement] Sections insert result:', {
        insertedCount: insertedSections?.length || 0,
        error: sectionsError,
        errorCode: sectionsError?.code,
        errorMessage: sectionsError?.message
      });

      if (sectionsError) throw sectionsError;

      // Reload templates list
      console.log('[ContractManagement] Reloading templates list...');
      await loadContractTemplates();

      console.log('[ContractManagement] Template saved successfully!', { templateId });

    } catch (error) {
      console.error('[ContractManagement] Error saving template:', error);
      toast.error(`Failed to save contract template: ${error.message || 'Unknown error'}`);
    }
  };

  // Manual trigger for employee creation from signed contract
  const handleCreateEmployeeFromContract = async (contract) => {
    try {
      console.log('[ContractManagement] Manually triggering employee creation for contract:', contract.id);
      
      // Reload contract with full data including contract_data
      const { data: fullContract, error: reloadError } = await supabase
        .from('hr_contracts')
        .select('*, contract_data')
        .eq('id', contract.id)
        .single();
      
      if (reloadError || !fullContract) {
        throw new Error('Failed to load contract data: ' + (reloadError?.message || 'Contract not found'));
      }
      
      console.log('[ContractManagement] Full contract loaded:', {
        id: fullContract.id,
        status: fullContract.status,
        has_contract_data: !!fullContract.contract_data,
        employee_email: fullContract.employee_email
      });
      
      if (fullContract.status !== 'signed') {
        toast.error('Contract must be fully signed before creating employee profile');
        return;
      }
      
      const result = await createEmployeeFromContract(fullContract);
      
      if (result.success) {
        if (result.created) {
          toast.success('Employee profile created successfully from contract!');
        } else {
          toast.success('Employee profile updated successfully from contract!');
        }
        // Reload contracts to refresh the list
        loadContracts();
      }
    } catch (error) {
      console.error('[ContractManagement] Error creating employee from contract:', error);
      toast.error(`Failed to create employee: ${error.message}`);
    }
  };

  const handleViewContract = async (contract) => {
    // For fully signed contracts, navigate to the contract view screen
    if (contract.status === 'signed') {
      // Use signing_token from the contract object (already loaded)
      const viewToken = contract.signing_token || contract.authorized_representative_signing_token;
      
      if (viewToken) {
        navigate(`/contract/view/${viewToken}`);
        return;
      }
      
      // Fallback: try to load if token not in contract object
      const { data: fullContract, error: loadError } = await supabase
        .from('hr_contracts')
        .select('signing_token, authorized_representative_signing_token')
        .eq('id', contract.id)
        .single();
      
      if (!loadError && fullContract) {
        const fallbackToken = fullContract.signing_token || fullContract.authorized_representative_signing_token;
        if (fallbackToken) {
          navigate(`/contract/view/${fallbackToken}`);
          return;
        }
      }
      
      // Final fallback: show error if token not found
      toast.error('Unable to view contract. Viewing token is missing.');
      return;
    }
    
    // For contracts awaiting authorized representative signature, navigate to signing screen
    if (contract.status === 'employee_signed') {
      if (contract.authorized_representative_signing_token) {
        // Navigate to the authorized representative signing screen
        navigate(`/contract/sign/authorized/${contract.authorized_representative_signing_token}`);
        return;
      } else {
        // If token is missing, show error and fall back to legacy editor
        toast.error('Unable to open contract for signing. Signing token is missing.');
        setSelectedContract(contract);
        setShowContractEditor(true);
        return;
      }
    }
    
    // For contracts awaiting signature, load them into the contract flow for review/resending
    if (contract.status === 'pending' || contract.status === 'sent' || contract.status === 'draft') {
      try {
        // CRITICAL FIX: Load full contract with contract_data if not already loaded
        let contractWithData = contract;
        if (!contract.contract_data && contract.id) {
          const { data: fullContract, error: loadError } = await supabase
            .from('hr_contracts')
            .select('*, contract_data')
            .eq('id', contract.id)
            .single();
          
          if (!loadError && fullContract) {
            contractWithData = fullContract;
            console.log('[ContractManagement] Loaded contract_data for contract:', contract.id);
          } else {
            console.warn('[ContractManagement] Failed to load contract_data:', loadError);
          }
        }
        
        // CRITICAL FIX: Use contract_data JSONB if available, otherwise reconstruct from columns
        // This ensures we use the correct employment_status, contract_type, and selectedTerms
        if (contractWithData.contract_data) {
          console.log('[ContractManagement] Loading contract from contract_data JSONB');
          // Use the stored contract_data which has all the correct information
          setContractFlowData({
            ...contractWithData.contract_data,
            finalContract: contractWithData,
            businessData: businessData
          });
        } else {
          console.log('[ContractManagement] contract_data not found, reconstructing from columns (legacy)');
          // Fallback: Reconstruct from columns (for older contracts without contract_data)
          // Fetch employee data if needed
          let employeeData = contract.employee;
          if (!employeeData && contract.employee_id) {
            const { data: empData } = await supabase
              .from('users')
              .select('*')
              .eq('id', contract.employee_id)
              .single();
            employeeData = empData;
          }

          // Load contract sections from database
          let contractSections = [];
          if (contract.id) {
            const { data: sectionsData, error: sectionsError } = await supabase
              .from('contract_sections')
              .select('*')
              .eq('contract_id', contract.id)
              .order('section_order', { ascending: true });

            if (!sectionsError && sectionsData) {
              contractSections = sectionsData.map(section => ({
                id: section.id || section.title,
                title: section.title,
                content: section.content,
                section_order: section.section_order,
                is_required: section.is_required || false,
                section_type: section.section_type || 'standard',
                required_for: section.required_for || 'all',
                placeholder_tags: section.placeholder_tags || []
              }));
            }
          }

          const storedKeyTerms = contract.contract_data?.keyTerms || {};

          // Load contract data into the flow
          setContractFlowData({
            keyTerms: {
              firstName: contract.employee_first_name || storedKeyTerms.firstName || employeeData?.first_name || '',
              lastName: contract.employee_last_name || storedKeyTerms.lastName || employeeData?.last_name || '',
              positionTitle: contract.position_title || storedKeyTerms.positionTitle || employeeData?.position || '',
              employeeAddress: contract.employee_address || storedKeyTerms.employeeAddress || employeeData?.address_line1 || '',
              employeePhone: storedKeyTerms.employeePhone || employeeData?.phone || '',
              employmentType: contract.contract_type || 'permanent',
              employmentStatus: contract.employment_status || 'full-time',
              contractStartDate: contract.start_date || '',
              contractEndDate: contract.end_date || '',
              probationaryPeriod: 90,
              baseHourlyWage: contract.wage_amount?.toString() || '',
              vacationPayRate: '4',
              primaryWorkLocation: '',
              employerContactEmail: businessData?.business_email || '',
              employeeEmail: contract.employee_email || employeeData?.email || '',
              managerId: storedKeyTerms.managerId || employeeData?.manager_id || '',
              managerName: storedKeyTerms.managerName || '',
            },
            specialConsiderations: {
              notApplicable: false,
              profitSharing: { enabled: false, title: 'Profit Sharing', sections: [] },
              shiftPremium: { enabled: false, title: 'Shift Premium', sections: [] },
              signingBonus: { enabled: false, title: 'Signing Bonus', sections: [] },
              other: { enabled: false, title: 'Other Considerations', sections: [] }
            },
            selectedTerms: contractSections, // Load actual contract sections from database
            finalContract: contract
          });
        }

        // Switch to dashboard tab and open review contract modal
        setActiveTab('dashboard');
        setContractFlowStep(4);
        setShowReviewModal(true);
        setShowAwaitingModal(false);
      } catch (error) {
        console.error('Error loading contract for review:', error);
        toast.error('Failed to load contract. Using legacy editor.');
        // Fallback to old editor
        setSelectedContract(contract);
        setShowContractEditor(true);
      }
    } else {
      // For other contracts, use the legacy editor
      setSelectedContract(contract);
      setShowContractEditor(true);
    }
  };
  
  // Load contract statistics for dashboard
  const loadContractStats = async () => {
    try {
      const now = new Date();
      const thirtyDaysLater = new Date(now);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
      
      // Load contracts - exclude large columns (pdf_data, contract_html, contract_data)
      const { data: contractsData, error } = await supabase
        .from('hr_contracts')
        .select(`
          id, business_id, employee_id, employee_email, employee_first_name, employee_last_name,
          status, contract_type, employment_status, position_title, start_date, end_date,
          wage_amount, wage_type, created_at, updated_at, signed_at, expires_at,
          authorized_representative_signed_at,
          personal_info_token, personal_info_submitted_at,
          employee:users!hr_contracts_employee_id_fkey(id, first_name, last_name)
        `)
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false })
        .limit(500);
        
      if (error) throw error;
      
      const enrichedContracts = (contractsData || []).map((contract) =>
        enrichContractRowWithDisplayEmployee(contract)
      );
      
      const isFullySigned = (c) =>
        c.status === 'signed' ||
        c.status === 'active' ||
        (c.signed_at && c.authorized_representative_signed_at);

      const completedContracts = enrichedContracts.filter(isFullySigned);
      const completed = completedContracts.length;
      const ending = enrichedContracts.filter(c => {
        if (!c.end_date) return false;
        const endDate = new Date(c.end_date);
        return endDate >= now && endDate <= thirtyDaysLater;
      });
      // Contracts awaiting employee signature (sent but not signed by employee yet)
      const awaitingRaw = enrichedContracts.filter(c => c.status === 'pending' || c.status === 'draft' || c.status === 'sent');
      const statusPriority = { sent: 3, pending: 2, draft: 1 };
      const awaitingByEmail = new Map();
      for (const contract of awaitingRaw) {
        const key = (contract.employee_email || contract.employee?.email || contract.id).toLowerCase();
        const existing = awaitingByEmail.get(key);
        if (
          !existing ||
          (statusPriority[contract.status] || 0) > (statusPriority[existing.status] || 0) ||
          ((statusPriority[contract.status] || 0) === (statusPriority[existing.status] || 0) &&
            new Date(contract.updated_at || contract.created_at) > new Date(existing.updated_at || existing.created_at))
        ) {
          awaitingByEmail.set(key, contract);
        }
      }
      const awaiting = Array.from(awaitingByEmail.values());
      // Contracts awaiting authorized rep signature (employee signed, but auth rep hasn't)
      const awaitingAuthRep = enrichedContracts.filter(c => c.status === 'employee_signed');
      
      setContractStats({
        completed,
        completedContracts,
        ending: ending || [],
        awaiting: awaiting || [],
        awaitingAuthRep: awaitingAuthRep || []
      });
    } catch (error) {
      console.error('Error loading contract stats:', error);
      // Set default empty values on error
      setContractStats({
        completed: 0,
        completedContracts: [],
        ending: [],
        awaiting: [],
        awaitingAuthRep: []
      });
    }
  };

  const filteredContracts = contracts.filter(contract => {
    const matchesSearch = !searchTerm || 
      contract.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contract.employee?.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contract.employee?.last_name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || contract.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getComplianceStatus = (employeeId) => {
    const records = complianceRecords[employeeId] || [];
    const criticalCount = records.filter(r => r.priority_level === 'critical').length;
    const overdueCount = records.filter(r => r.compliance_status === 'overdue').length;
    const pendingCount = records.filter(r => r.compliance_status === 'pending').length;
    
    if (criticalCount > 0 || overdueCount > 0) {
      return { status: 'critical', count: criticalCount + overdueCount, color: '#dc2626' };
    } else if (pendingCount > 0) {
      return { status: 'pending', count: pendingCount, color: '#f59e0b' };
    } else if (records.length > 0) {
      return { status: 'compliant', count: records.length, color: '#059669' };
    }
    
    return { status: 'none', count: 0, color: '#6b7280' };
  };

  if (permissionsLoading || authLoading) {
    return (
      <div style={{ ...styles.container, justifyContent: 'center', alignItems: 'center' }}>
        <h3>Loading Contract Management...</h3>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={{ ...styles.container, justifyContent: 'center', alignItems: 'center' }}>
        <h3>Unable to load contracts</h3>
        <p style={{ color: '#6b7280', maxWidth: '420px', textAlign: 'center' }}>{authError}</p>
      </div>
    );
  }

  if (!canViewContracts) {
    return (
      <div style={{ ...styles.container, justifyContent: 'center', alignItems: 'center' }}>
        <h3>⚠️ Access Denied</h3>
        <p>You do not have permission to view contract management.</p>
      </div>
    );
  }

  const handleBulkCreatePortalAccess = async () => {
    console.log('========== BULK PORTAL ACCESS CREATION - START ==========');
    console.log('[BulkPortalAccess] Button clicked');
    console.log('[BulkPortalAccess] Business ID:', selectedBusinessId);
    console.log('[BulkPortalAccess] Auth User:', authUser?.id || 'Not authenticated');
    
    if (!selectedBusinessId || !authUser) {
      console.error('[BulkPortalAccess] Missing required information:', {
        hasBusinessId: !!selectedBusinessId,
        hasAuthUser: !!authUser
      });
      toast.error('Missing required information');
      return;
    }

    if (!confirm('This will create portal access for all employees that do not currently have it. Continue?')) {
      console.log('[BulkPortalAccess] User cancelled');
      return;
    }

    setCreatingBulkPortalAccess(true);
    const toastId = toast.loading('Creating portal access for employees...');
    const startTime = Date.now();

    try {
      // Get all employees for this business via user_roles
      console.log('[BulkPortalAccess] Step 1: Loading user roles for business...');
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('business_id', selectedBusinessId)
        .eq('active', true);

      if (rolesError) {
        console.error('[BulkPortalAccess] Error loading user roles:', rolesError);
        throw new Error('Failed to load user roles: ' + rolesError.message);
      }

      console.log('[BulkPortalAccess] Found user roles:', userRoles?.length || 0);

      if (!userRoles || userRoles.length === 0) {
        console.log('[BulkPortalAccess] No employees found for this business');
        toast.dismiss(toastId);
        toast.success('No employees found for this business');
        setCreatingBulkPortalAccess(false);
        return;
      }

      const userIds = userRoles.map(ur => ur.user_id);
      console.log('[BulkPortalAccess] User IDs to process:', userIds.length);

      // Get employee details - exclude terminated and inactive employees
      console.log('[BulkPortalAccess] Step 2: Loading employee details...');
      const { data: employees, error: employeesError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, full_name, employment_status, status')
        .in('id', userIds)
        .neq('employment_status', 'terminated')
        .neq('status', 'terminated');

      if (employeesError) {
        console.error('[BulkPortalAccess] Error loading employees:', employeesError);
        throw new Error('Failed to load employees: ' + employeesError.message);
      }

      console.log('[BulkPortalAccess] Loaded employees:', employees?.length || 0);
      console.log('[BulkPortalAccess] Employees with all data:', employees);

      // Get all existing auth users
      console.log('[BulkPortalAccess] Step 3: Checking authentication...');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('[BulkPortalAccess] No session found');
        throw new Error('Must be authenticated to create portal access');
      }

      console.log('[BulkPortalAccess] Session found:', {
        userId: session.user.id,
        email: session.user.email
      });

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) {
        console.error('[BulkPortalAccess] VITE_SUPABASE_URL not set');
        throw new Error('VITE_SUPABASE_URL environment variable is not set');
      }

      console.log('[BulkPortalAccess] Supabase URL:', supabaseUrl);

      let created = 0;
      let skipped = 0;
      let errors = 0;
      const errorDetails = [];

      // Filter out terminated, suspended, or inactive employees
      // Only grant portal access to active employees (active, probation, on_leave)
      console.log('[BulkPortalAccess] Step 4: Filtering active employees...');
      const activeEmployees = (employees || []).filter(emp => {
        const empStatus = (emp.employment_status || '').toLowerCase();
        const userStatus = (emp.status || '').toLowerCase();
        // Exclude terminated and suspended employees
        // Only include: active, probation, on_leave (or null/empty which defaults to active)
        const excludedStatuses = ['terminated', 'suspended'];
        const isExcluded = excludedStatuses.includes(empStatus) || excludedStatuses.includes(userStatus);
        return !isExcluded;
      });

      const terminatedCount = (employees || []).length - activeEmployees.length;
      console.log('[BulkPortalAccess] Active employees:', activeEmployees.length);
      console.log('[BulkPortalAccess] Terminated/suspended excluded:', terminatedCount);
      console.log('[BulkPortalAccess] Active employees list:', activeEmployees.map(e => ({
        email: e.email,
        name: `${e.first_name} ${e.last_name}`,
        status: e.employment_status || e.status
      })));

      // Check which employees don't have auth accounts by trying to find them
      // We'll use the Edge Function to check and create
      console.log('[BulkPortalAccess] Step 5: Processing employees...');
      for (let i = 0; i < activeEmployees.length; i++) {
        const employee = activeEmployees[i];
        console.log(`[BulkPortalAccess] Processing employee ${i + 1}/${activeEmployees.length}:`, {
          email: employee.email,
          name: `${employee.first_name} ${employee.last_name}`,
          id: employee.id
        });

        if (!employee.email) {
          console.warn(`[BulkPortalAccess] Employee ${employee.id} has no email - skipping`);
          skipped++;
          continue;
        }

        try {
          // Generate temporary password
          const tempPassword = `TempPass${Math.random().toString(36).substring(2, 10)}!`;

          console.log(`[BulkPortalAccess] Calling Edge Function for ${employee.email}...`);
          const requestStartTime = Date.now();

          // Call Edge Function to create auth account (it will skip if already exists)
          const response = await fetch(
            `${supabaseUrl}/functions/v1/create-employee-auth`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                method: 'password',
                employee_email: employee.email,
                employee_id: employee.id,
                first_name: employee.first_name || '',
                last_name: employee.last_name || '',
                full_name: employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
                temporary_password: tempPassword
              })
            }
          );

          const requestDuration = Date.now() - requestStartTime;
          const result = await response.json();

          console.log(`[BulkPortalAccess] Edge Function response for ${employee.email}:`, {
            status: response.status,
            ok: response.ok,
            duration: `${requestDuration}ms`,
            result: result
          });

          if (response.ok) {
            created++;
            console.log(`[BulkPortalAccess] ✅ Created portal access for ${employee.email}`);
          } else if (result.error?.includes('already exists') || result.error?.includes('already registered')) {
            skipped++;
            console.log(`[BulkPortalAccess] ⏭️ Portal access already exists for ${employee.email}`);
          } else {
            errors++;
            const errorMsg = result.error || result.details || 'Unknown error';
            errorDetails.push({ email: employee.email, error: errorMsg });
            console.error(`[BulkPortalAccess] ❌ Failed for ${employee.email}:`, errorMsg);
          }
        } catch (error) {
          errors++;
          errorDetails.push({ email: employee.email, error: error.message });
          console.error(`[BulkPortalAccess] ❌ Exception for ${employee.email}:`, error);
        }
      }

      const totalDuration = Date.now() - startTime;
      console.log('[BulkPortalAccess] ========== SUMMARY ==========');
      console.log('[BulkPortalAccess] Total employees processed:', activeEmployees.length);
      console.log('[BulkPortalAccess] Created:', created);
      console.log('[BulkPortalAccess] Already had access:', skipped);
      console.log('[BulkPortalAccess] Terminated/suspended excluded:', terminatedCount);
      console.log('[BulkPortalAccess] Errors:', errors);
      if (errorDetails.length > 0) {
        console.log('[BulkPortalAccess] Error details:', errorDetails);
      }
      console.log('[BulkPortalAccess] Total duration:', `${totalDuration}ms`);
      console.log('[BulkPortalAccess] ========== END ==========');

      toast.dismiss(toastId);
      let message = `Portal access creation complete: ${created} created, ${skipped} already had access`;
      if (terminatedCount > 0) {
        message += `, ${terminatedCount} terminated (excluded)`;
      }
      if (errors > 0) {
        message += `, ${errors} errors`;
        console.warn('[BulkPortalAccess] Some errors occurred - check console for details');
      }
      toast.success(message);
    } catch (error) {
      console.error('[BulkPortalAccess] ========== FATAL ERROR ==========');
      console.error('[BulkPortalAccess] Error:', error);
      console.error('[BulkPortalAccess] Error message:', error.message);
      console.error('[BulkPortalAccess] Error stack:', error.stack);
      console.error('[BulkPortalAccess] ========== END ERROR ==========');
      toast.dismiss(toastId);
      toast.error('Failed to create portal access: ' + error.message);
    } finally {
      setCreatingBulkPortalAccess(false);
      console.log('[BulkPortalAccess] Process completed');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <h2>Contract Management</h2>
            <p>Create, view, and manage employment contracts</p>
          </div>
          {(isOwner() || hasElevatedPrivileges()) && (
            <button
              onClick={handleBulkCreatePortalAccess}
              disabled={creatingBulkPortalAccess}
              style={{
                padding: '10px 20px',
                backgroundColor: creatingBulkPortalAccess ? '#6b7280' : '#008080',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: creatingBulkPortalAccess ? 'not-allowed' : 'pointer',
                fontSize: '11px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <UserPlus size={18} />
              {creatingBulkPortalAccess ? 'Creating...' : 'Create Portal Access for All Staff'}
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={styles.tabContainer}>
        <div style={styles.tabList}>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'dashboard' ? styles.tabActive : {})
            }}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </button>
          
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'view' ? styles.tabActive : {})
            }}
            onClick={() => setActiveTab('view')}
          >
            <Eye size={18} />
            View Contracts
          </button>
          
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'drafts' ? styles.tabActive : {})
            }}
            onClick={() => setActiveTab('drafts')}
          >
            <FileText size={18} />
            Drafts
          </button>
          
          <PermissionGate permissions={['hr.contracts.create']} requireElevated fallback={null}>
            <button
              style={{
                ...styles.tab,
                ...(activeTab === 'create' ? styles.tabActive : {})
              }}
              onClick={() => setActiveTab('create')}
            >
              <Plus size={18} />
              Contract Templates
            </button>
          </PermissionGate>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && (
        <DashboardTab
          contractStats={contractStats}
          onViewCompleted={() => setShowCompletedModal(true)}
          onViewContracts={() => {
            setStatusFilter('all');
            setActiveTab('view');
          }}
          onViewEnding={() => setShowEndingModal(true)}
          onViewAwaiting={() => setShowAwaitingModal(true)}
          onViewAwaitingAuthRep={() => setShowAwaitingAuthRepModal(true)}
          contractFlowStep={contractFlowStep}
          setContractFlowStep={setContractFlowStep}
          contractFlowData={contractFlowData}
          setContractFlowData={setContractFlowData}
          showKeyTermsModal={showKeyTermsModal}
          setShowKeyTermsModal={setShowKeyTermsModal}
          showSpecialConsiderationsModal={showSpecialConsiderationsModal}
          setShowSpecialConsiderationsModal={setShowSpecialConsiderationsModal}
          showSelectTermsModal={showSelectTermsModal}
          setShowSelectTermsModal={setShowSelectTermsModal}
          showReviewModal={showReviewModal}
          setShowReviewModal={setShowReviewModal}
          showSendContractModal={showSendContractModal}
          setShowSendContractModal={setShowSendContractModal}
          businessData={businessData}
          selectedBusinessId={selectedBusinessId}
          onViewContract={handleViewContract}
          contracts={filteredContracts}
          onSaveDraft={handleSaveDraft}
          onSaveContract={handleSaveContract}
          loadContractStats={loadContractStats}
          loadContracts={loadContracts}
        />
      )}
      
      {activeTab === 'view' && (
        <ViewContractsTab
          contracts={filteredContracts}
          contractFiles={contractFiles}
          complianceRecords={complianceRecords}
          loading={loading}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          onViewContract={handleViewContract}
          onCreateEmployee={handleCreateEmployeeFromContract}
          getComplianceStatus={getComplianceStatus}
          canManageFiles={canManageFiles}
          canViewCompliance={canViewCompliance}
          canEditContracts={canEditContracts}
          businessData={businessData}
          onResendPersonalInfo={async (contract) => {
            try {
              if (!contract.employee_email) {
                toast.error('Employee email is missing');
                return;
              }

              // Get or create user record
              const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, email, personal_info_token')
                .eq('email', contract.employee_email)
                .maybeSingle();
              
              if (userError && userError.code !== 'PGRST116') {
                throw new Error('Failed to load employee: ' + userError.message);
              }

              // Generate or get existing personal info token from user record (primary)
              let personalInfoToken = userData?.personal_info_token || contract.personal_info_token;
              
              if (!personalInfoToken) {
                personalInfoToken = crypto.randomUUID();
              }

              // Update user record with token (primary storage)
              if (userData) {
                const { error: userTokenUpdateError } = await supabase
                  .from('users')
                  .update({ personal_info_token: personalInfoToken })
                  .eq('id', userData.id);
                
                if (userTokenUpdateError) {
                  throw new Error('Failed to generate token: ' + userTokenUpdateError.message);
                }
              }
              
              // Also update contract (for backwards compatibility)
              const { error: contractTokenUpdateError } = await supabase
                .from('hr_contracts')
                .update({ personal_info_token: personalInfoToken })
                .eq('id', contract.id);
              
              if (contractTokenUpdateError) {
                console.warn('Failed to update contract token:', contractTokenUpdateError);
                // Don't fail - user token was saved
              }

              const businessName = await resolveBusinessDisplayName({
                businessId: contract.business_id || selectedBusinessId,
                contractData: contract.contract_data,
                businessData,
              });

              const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
              const personalInfoLink = `${frontendUrl}/contract/personal-info/${personalInfoToken}`;
              const employeeName = `${contract.employee_first_name || ''} ${contract.employee_last_name || ''}`.trim() || 'Employee';

              const personalInfoEmailHTML = `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Complete Your Employee Profile</title>
                  <style>
                    body {
                      font-family: Arial, sans-serif;
                      line-height: 1.6;
                      color: #333;
                      max-width: 800px;
                      margin: 0 auto;
                      padding: 20px;
                      background-color: #f5f5f5;
                    }
                    .email-wrapper {
                      background: white;
                      border-radius: 8px;
                      padding: 30px;
                      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    .form-button {
                      display: inline-block;
                      background-color: #008080;
                      color: white;
                      padding: 15px 30px;
                      text-decoration: none;
                      border-radius: 5px;
                      font-weight: bold;
                      margin: 20px 0;
                    }
                  </style>
                </head>
                <body>
                  <div class="email-wrapper">
                    <h2>Complete Your Employee Profile</h2>
                    <p>Dear ${employeeName},</p>
                    <p>Please complete your personal information form to finalize your employee profile setup.</p>
                    <p><strong>Please complete the form by clicking the button below:</strong></p>
                    <a href="${personalInfoLink}" class="form-button" style="color: white; text-decoration: none;">Complete Personal Information Form</a>
                    <p style="margin-top: 15px; font-size: 9px; color: #666;">
                      Or copy and paste this link into your browser:<br>
                      <a href="${personalInfoLink}" style="color: #008080; word-break: break-all;">${personalInfoLink}</a>
                    </p>
                    <p style="margin-top: 20px; font-size: 16px; color: #666;">
                      This form includes fields for your SIN number, address, birth date, emergency contact information, and account setup (password and PIN).
                    </p>
                  </div>
                </body>
                </html>
              `;

              const plainTextBody = `Dear ${employeeName},

Please complete your personal information form to finalize your employee profile setup.

Please complete the form by visiting:
${personalInfoLink}

This form includes fields for your SIN number, address, birth date, emergency contact information, and account setup (password and PIN).`;

              const emailPayload = {
                businessId: contract.business_id,
                campaignId: `personal-info-resend-${contract.id}-${Date.now()}`,
                contactId: `personal-info-${contract.employee_email}`,
                emailType: 'transactional',
                to: contract.employee_email,
                fromEmail: 'noreply@tavarios.ca',
                fromName: formatContractHrFromName(businessName),
                subject: `Complete Your Employee Profile - ${employeeName}`,
                html: personalInfoEmailHTML,
                text: plainTextBody
              };

              const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify(emailPayload)
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to send email');
              }

              const data = await response.json();
              if (!data?.ok) {
                throw new Error(data?.error || 'Failed to send email');
              }

              toast.success(`Personal information form email sent to ${contract.employee_email}`);
              await loadContractStats();
              await loadContracts();
            } catch (error) {
              console.error('Error resending personal info form:', error);
              toast.error('Failed to resend personal info form: ' + (error.message || 'Unknown error'));
            }
          }}
        />
      )}

      {activeTab === 'drafts' && (
        <DraftsTab
          drafts={drafts}
          loading={loadingDrafts}
          onRestoreDraft={handleRestoreDraft}
          businessData={businessData}
          onDeleteDraft={async (draftId) => {
            try {
              const { error } = await supabase
                .from('hr_contracts')
                .delete()
                .eq('id', draftId);
              
              if (error) throw error;
              
              toast.success('Draft deleted successfully');
              loadDrafts();
            } catch (error) {
              console.error('Error deleting draft:', error);
              toast.error('Failed to delete draft: ' + error.message);
            }
          }}
        />
      )}

      {activeTab === 'create' && (
        <CreateContractTab
          contractTitle={contractTitle}
          setContractTitle={setContractTitle}
          contractType={contractType}
          setContractType={setContractType}
          contractSections={contractSections}
          onAddSection={handleAddSection}
          onAddSubsection={handleAddSubsection}
          onUpdateSection={handleUpdateSection}
          onUpdateSubsection={handleUpdateSubsection}
          onDeleteSection={handleDeleteSection}
          onDeleteSubsection={handleDeleteSubsection}
          onMoveSection={handleMoveSection}
          onSaveTemplate={handleSaveContractTemplate}
          availableTemplates={availableTemplates}
          selectedTemplateId={selectedTemplateId}
          onLoadTemplate={loadTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          loadingTemplates={loadingTemplates}
          onExportSelectedTemplate={handleExportSelectedContractTemplate}
          onExportAllTemplates={handleExportAllContractTemplates}
          onImportTemplatesFile={handleImportContractTemplatesFile}
        />
      )}

      {/* Modals */}
      <PermissionGate permissions={['hr.contracts.edit']} requireElevated>
        <ContractEditorModal
          isOpen={showContractEditor}
          onClose={() => {
            setShowContractEditor(false);
            setSelectedContract(null);
          }}
          contract={selectedContract}
          employee={selectedContract?.employee}
          businessId={selectedBusinessId}
          businessData={businessData}
          onContractSaved={() => {
            setShowContractEditor(false);
            setSelectedContract(null);
            toast.success('Contract updated successfully');
            loadContracts();
          }}
        />
      </PermissionGate>
      
      {/* Fully signed / completed contracts */}
      <ContractsListModal
        isOpen={showCompletedModal}
        onClose={() => setShowCompletedModal(false)}
        title="Completed Contracts (Fully Signed)"
        contracts={contractStats.completedContracts || []}
        onViewContract={handleViewContract}
        onCreateEmployee={handleCreateEmployeeFromContract}
        businessData={businessData}
      />

      {/* Contracts Ending Modal */}
      <ContractsListModal
        isOpen={showEndingModal}
        onClose={() => setShowEndingModal(false)}
        title="Contracts Ending Within 30 Days"
        contracts={contractStats.ending}
        onViewContract={handleViewContract}
        onCreateEmployee={handleCreateEmployeeFromContract}
        businessData={businessData}
      />
      
      {/* Contracts Awaiting Employee Signature Modal */}
      <ContractsListModal
        isOpen={showAwaitingModal}
        onClose={() => setShowAwaitingModal(false)}
        title="Contracts Awaiting Employee Signature"
        contracts={contractStats.awaiting}
        onViewContract={handleViewContract}
        onCreateEmployee={handleCreateEmployeeFromContract}
        businessData={businessData}
        onDeleteContract={async (contract) => {
          try {
            // Delete contract sections first (foreign key constraint)
            const { error: sectionsError } = await supabase
              .from('contract_sections')
              .delete()
              .eq('contract_id', contract.id);

            if (sectionsError) {
              console.error('Error deleting contract sections:', sectionsError);
              // Continue anyway - sections might not exist
            }

            // Delete the contract record
            const { error: deleteError } = await supabase
              .from('hr_contracts')
              .delete()
              .eq('id', contract.id);

            if (deleteError) throw deleteError;

            toast.success('Contract deleted successfully');
            loadContractStats(); // Reload stats to update the modal
            loadContracts(); // Reload contracts list
          } catch (error) {
            console.error('Error deleting contract:', error);
            toast.error('Failed to delete contract: ' + (error.message || 'Unknown error'));
            throw error;
          }
        }}
        onResendContract={async (contract) => {
          try {
            const { data: fullContract, error: fetchError } = await supabase
              .from('hr_contracts')
              .select('*')
              .eq('id', contract.id)
              .single();

            if (fetchError) throw fetchError;

            let contractData = loadContractFlowDataFromRow(fullContract, businessData);

            if (!contractData.selectedTerms?.length) {
              const { data: sections, error: sectionsError } = await supabase
                .from('contract_sections')
                .select('id, title, content, section_order, is_required, section_type')
                .eq('contract_id', contract.id)
                .order('section_order', { ascending: true });

              if (sectionsError) throw sectionsError;
              if (sections?.length) {
                contractData = { ...contractData, selectedTerms: sections };
              }
            }

            setShowSendContractModal(true);
            setContractFlowData(contractData);
            setShowAwaitingModal(false);
          } catch (error) {
            console.error('Error loading contract for resend:', error);
            toast.error('Failed to load contract: ' + error.message);
          }
        }}
      />
      
      {/* Contracts Awaiting Authorized Rep Signature Modal */}
      <ContractsListModal
        isOpen={showAwaitingAuthRepModal}
        onClose={() => setShowAwaitingAuthRepModal(false)}
        title="Contracts Awaiting Authorized Representative Signature"
        contracts={contractStats.awaitingAuthRep}
        onViewContract={handleViewContract}
        onCreateEmployee={handleCreateEmployeeFromContract}
        businessData={businessData}
        onSignContract={async (contract) => {
          try {
            let signingToken = contract.authorized_representative_signing_token;
            
            // If no token exists, generate one
            if (!signingToken) {
              signingToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
              
              // Update the contract with the new token
              const { error: updateError } = await supabase
                .from('hr_contracts')
                .update({ authorized_representative_signing_token: signingToken })
                .eq('id', contract.id);
              
              if (updateError) {
                console.error('Error generating signing token:', updateError);
                toast.error('Failed to generate signing token: ' + updateError.message);
                return;
              }
            }
            
            // Navigate to signing screen
            navigate(`/contract/sign/authorized/${signingToken}`);
          } catch (error) {
            console.error('Error opening contract for signing:', error);
            toast.error('Failed to open contract for signing: ' + error.message);
          }
        }}
        onResendPersonalInfo={async (contract) => {
          try {
            if (!contract.employee_email) {
              toast.error('Employee email is missing');
              return;
            }

            // Get or create user record
            const { data: userData, error: userError } = await supabase
              .from('users')
              .select('id, email, personal_info_token')
              .eq('email', contract.employee_email)
              .maybeSingle();
            
            if (userError && userError.code !== 'PGRST116') {
              throw new Error('Failed to load employee: ' + userError.message);
            }

            // Generate or get existing personal info token from user record (primary)
            let personalInfoToken = userData?.personal_info_token || contract.personal_info_token;
            
            if (!personalInfoToken) {
              personalInfoToken = crypto.randomUUID();
            }

            // Update user record with token (primary storage)
            if (userData) {
              const { error: userTokenUpdateError } = await supabase
                .from('users')
                .update({ personal_info_token: personalInfoToken })
                .eq('id', userData.id);
              
              if (userTokenUpdateError) {
                throw new Error('Failed to generate token: ' + userTokenUpdateError.message);
              }
            }
            
            // Also update contract (for backwards compatibility)
            const { error: contractTokenUpdateError } = await supabase
              .from('hr_contracts')
              .update({ personal_info_token: personalInfoToken })
              .eq('id', contract.id);
            
            if (contractTokenUpdateError) {
              console.warn('Failed to update contract token:', contractTokenUpdateError);
              // Don't fail - user token was saved
            }

            const businessName = await resolveBusinessDisplayName({
              businessId: contract.business_id || selectedBusinessId,
              contractData: contract.contract_data,
              businessData,
            });

            const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
            const personalInfoLink = `${frontendUrl}/contract/personal-info/${personalInfoToken}`;
            const employeeName = `${contract.employee_first_name || ''} ${contract.employee_last_name || ''}`.trim() || 'Employee';

            const personalInfoEmailHTML = `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Complete Your Employee Profile</title>
                <style>
                  body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f5f5f5;
                  }
                  .email-wrapper {
                    background: white;
                    border-radius: 8px;
                    padding: 30px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                  }
                  .form-button {
                    display: inline-block;
                    background-color: #008080;
                    color: white;
                    padding: 15px 30px;
                    text-decoration: none;
                    border-radius: 5px;
                    font-weight: bold;
                    margin: 20px 0;
                  }
                  .form-button:hover {
                    background-color: #006666;
                  }
                </style>
              </head>
              <body>
                <div class="email-wrapper">
                  <h2>Complete Your Employee Profile</h2>
                  <p>Dear ${employeeName},</p>
                  <p>Please complete your personal information form to finalize your employee profile setup.</p>
                  <p><strong>Please complete the form by clicking the button below:</strong></p>
                  <a href="${personalInfoLink}" class="form-button" style="color: white; text-decoration: none;">Complete Personal Information Form</a>
                  <p style="margin-top: 15px; font-size: 13px; color: #666;">
                    Or copy and paste this link into your browser:<br>
                    <a href="${personalInfoLink}" style="color: #008080; word-break: break-all;">${personalInfoLink}</a>
                  </p>
                  <p style="margin-top: 20px; font-size: 11px; color: #666;">
                    This form includes fields for your SIN number, address, birth date, emergency contact information, and account setup (password and PIN).
                  </p>
                </div>
              </body>
              </html>
            `;

            const plainTextBody = `Dear ${employeeName},

Please complete your personal information form to finalize your employee profile setup.

Please complete the form by visiting:
${personalInfoLink}

This form includes fields for your SIN number, address, birth date, emergency contact information, and account setup (password and PIN).`;

            const emailPayload = {
              businessId: contract.business_id,
              campaignId: `personal-info-resend-${contract.id}-${Date.now()}`,
              contactId: `personal-info-${contract.employee_email}`,
              emailType: 'transactional',
              to: contract.employee_email,
              fromEmail: 'noreply@tavarios.ca',
              fromName: formatContractHrFromName(businessName),
              subject: `Complete Your Employee Profile - ${employeeName}`,
              html: personalInfoEmailHTML,
              text: plainTextBody
            };

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
              },
              body: JSON.stringify(emailPayload)
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText || 'Failed to send email');
            }

            const data = await response.json();
            if (!data?.ok) {
              throw new Error(data?.error || 'Failed to send email');
            }

            toast.success(`Personal information form email sent to ${contract.employee_email}`);
            await loadContractStats();
          } catch (error) {
            console.error('Error resending personal info form:', error);
            toast.error('Failed to resend personal info form: ' + (error.message || 'Unknown error'));
            throw error;
          }
        }}
        onResendContract={async (contract) => {
          try {
            // For contracts awaiting authorized rep signature, resend directly to authorized rep
            if (!contract.authorized_representative_email || !contract.authorized_representative_signing_token) {
              toast.error('Authorized representative email or signing token is missing');
              return;
            }

            // Extend expiration date by 14 days
            const newExpirationDate = new Date();
            newExpirationDate.setDate(newExpirationDate.getDate() + 14);
            newExpirationDate.setHours(23, 59, 59, 999);

            // Update expiration date
            const { error: updateError } = await supabase
              .from('hr_contracts')
              .update({ expires_at: newExpirationDate.toISOString() })
              .eq('id', contract.id);

            if (updateError) {
              throw updateError;
            }

            // Send email directly to authorized rep
            const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
            const authRepSigningLink = `${frontendUrl}/contract/sign/authorized/${contract.authorized_representative_signing_token}`;
            
            const businessName = businessData?.business_name || businessData?.name || 'Company';
            const employeeName = `${contract.employee_first_name} ${contract.employee_last_name}`;

            const authRepEmailHTML = `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Contract Requires Your Signature</title>
                <style>
                  body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f5f5f5;
                  }
                  .email-wrapper {
                    background-color: white;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                  }
                  .sign-button {
                    display: inline-block;
                    background-color: #008080;
                    color: white;
                    padding: 12px 24px;
                    text-decoration: none;
                    border-radius: 5px;
                    margin: 20px 0;
                    font-weight: bold;
                  }
                </style>
              </head>
              <body>
                <div class="email-wrapper">
                  <h2>Contract Requires Your Signature</h2>
                  <p>Dear ${contract.authorized_representative_name || 'Authorized Representative'},</p>
                  <p>The employment contract for <strong>${employeeName}</strong> has been signed by the employee and now requires your signature as the authorized representative.</p>
                  <p><strong>Please review and sign the contract by clicking the button below:</strong></p>
                  <a href="${authRepSigningLink}" class="sign-button" style="color: white; text-decoration: none;">Review & Sign Contract</a>
                  <p style="margin-top: 15px; font-size: 11px; color: #666;">
                    Or copy and paste this link into your browser:<br>
                    <a href="${authRepSigningLink}" style="color: #008080; word-break: break-all;">${authRepSigningLink}</a>
                  </p>
                  <p style="margin-top: 20px; font-size: 9px; color: #666;">
                    This link will expire in 14 days.
                  </p>
                </div>
              </body>
              </html>
            `;

            const plainTextBody = `Dear ${contract.authorized_representative_name || 'Authorized Representative'},

The employment contract for ${employeeName} has been signed by the employee and now requires your signature as the authorized representative.

Please review and sign the contract by visiting:
${authRepSigningLink}

This link will expire in 14 days.`;

            const emailPayload = {
              businessId: contract.business_id,
              campaignId: `contract-resend-authrep-${contract.id}-${Date.now()}`,
              contactId: `contract-authrep-${contract.authorized_representative_email}`,
              emailType: 'transactional',
              to: contract.authorized_representative_email,
              fromEmail: 'noreply@tavarios.ca',
              fromName: formatContractHrFromName(businessName),
              subject: `Contract Requires Your Signature - ${employeeName}`,
              html: authRepEmailHTML,
              text: plainTextBody
            };

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
              },
              body: JSON.stringify(emailPayload)
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText || 'Failed to send email');
            }

            const data = await response.json();
            if (!data?.ok) {
              throw new Error(data?.error || 'Failed to send email');
            }

            toast.success(`Contract resend email sent to ${contract.authorized_representative_email}`);
            await loadContractStats();
          } catch (error) {
            console.error('Error resending contract to authorized rep:', error);
            toast.error('Failed to resend contract: ' + (error.message || 'Unknown error'));
          }
        }}
        onDeleteContract={async (contract) => {
          try {
            // Delete contract sections first (foreign key constraint)
            if (contract.id) {
              const { error: sectionsError } = await supabase
                .from('contract_sections')
                .delete()
                .eq('contract_id', contract.id);
              
              if (sectionsError) {
                console.warn('Error deleting contract sections:', sectionsError);
              }

              // Delete the contract record
              const { error: contractError } = await supabase
                .from('hr_contracts')
                .delete()
                .eq('id', contract.id);

              if (contractError) throw contractError;

              toast.success('Contract deleted successfully');
              
              // Reload contract stats to refresh the modal
              await loadContractStats();
            }
          } catch (error) {
            console.error('Error deleting contract:', error);
            throw error;
          }
        }}
      />
    </div>
  );
}

// DASHBOARD TAB COMPONENT
const DashboardTab = ({
  contractStats,
  onViewCompleted,
  onViewContracts,
  onViewEnding,
  onViewAwaiting,
  onViewAwaitingAuthRep,
  contractFlowStep,
  setContractFlowStep,
  contractFlowData,
  setContractFlowData,
  showKeyTermsModal,
  setShowKeyTermsModal,
  showSelectTermsModal,
  setShowSelectTermsModal,
  showReviewModal,
  setShowReviewModal,
  showSpecialConsiderationsModal,
  setShowSpecialConsiderationsModal,
  showSendContractModal,
  setShowSendContractModal,
  businessData,
  selectedBusinessId,
  onViewContract,
  contracts,
  onSaveDraft,
  onSaveContract,
  loadContractStats,
  loadContracts
}) => {
  const steps = [
    { number: 1, title: 'Key Terms Summary', modal: 'keyTerms' },
    { number: 2, title: 'Special Considerations', modal: 'specialConsiderations' },
    { number: 3, title: 'Select Contract Terms', modal: 'selectTerms' },
    { number: 4, title: 'Review Contract', modal: 'review' },
    { number: 5, title: 'Send Contract', modal: null }
  ];

  // Ensure contractStats has default values
  const stats = {
    completed: contractStats?.completed || 0,
    completedContracts: contractStats?.completedContracts || [],
    ending: contractStats?.ending || [],
    awaiting: contractStats?.awaiting || [],
    awaitingAuthRep: contractStats?.awaitingAuthRep || []
  };

  return (
    <div style={styles.tabContent}>
      {/* Action Cards */}
      <div style={dashboardStyles.actionCards}>
        <div style={dashboardStyles.actionCard} onClick={onViewCompleted}>
          <div style={dashboardStyles.cardIcon}>
            <CheckCircle2 size={32} color="#059669" />
          </div>
          <div style={dashboardStyles.cardContent}>
            <div style={dashboardStyles.cardNumber}>{stats.completed}</div>
            <div style={dashboardStyles.cardLabel}>Completed Contracts</div>
            <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '4px' }}>
              Both parties signed
            </div>
          </div>
        </div>
        
        <div style={dashboardStyles.actionCard} onClick={onViewEnding}>
          <div style={dashboardStyles.cardIcon}>
            <Clock size={32} color="#f59e0b" />
          </div>
          <div style={dashboardStyles.cardContent}>
            <div style={dashboardStyles.cardNumber}>{stats.ending.length}</div>
            <div style={dashboardStyles.cardLabel}>Contracts Ending</div>
          </div>
        </div>
        
        <div style={dashboardStyles.actionCard} onClick={onViewAwaiting}>
          <div style={dashboardStyles.cardIcon}>
            <Send size={32} color="#dc2626" />
          </div>
          <div style={dashboardStyles.cardContent}>
            <div style={dashboardStyles.cardNumber}>{stats.awaiting.length}</div>
            <div style={dashboardStyles.cardLabel}>Awaiting Employee Signature</div>
          </div>
        </div>
        
        <div style={dashboardStyles.actionCard} onClick={onViewAwaitingAuthRep}>
          <div style={dashboardStyles.cardIcon}>
            <Shield size={32} color="#f59e0b" />
          </div>
          <div style={dashboardStyles.cardContent}>
            <div style={dashboardStyles.cardNumber}>{stats.awaitingAuthRep.length}</div>
            <div style={dashboardStyles.cardLabel}>Awaiting Authorized Rep Signature</div>
          </div>
        </div>
      </div>

      {/* Contract Creation Steps */}
      <div style={dashboardStyles.stepsSection}>
        <h3 style={dashboardStyles.stepsTitle}>Create New Contract</h3>
        <div style={dashboardStyles.stepsList}>
          {steps.map((step, index) => (
            <div 
              key={step.number} 
              style={{
                ...dashboardStyles.step,
                ...(contractFlowStep >= step.number ? dashboardStyles.stepCompleted : {}),
                ...(contractFlowStep === step.number ? dashboardStyles.stepActive : {})
              }}
              onClick={() => {
                console.log('[DashboardTab] Step clicked:', step.number, 'modal:', step.modal);
                if (step.modal === 'keyTerms') setShowKeyTermsModal(true);
                else if (step.modal === 'specialConsiderations') setShowSpecialConsiderationsModal(true);
                else if (step.modal === 'selectTerms') setShowSelectTermsModal(true);
                else if (step.modal === 'review') setShowReviewModal(true);
                else if (step.number === 5) {
                  // Step 5: Send Contract - open the Send Contract modal
                  console.log('[DashboardTab] Opening Send Contract modal');
                  setShowSendContractModal(true);
                } else {
                  setContractFlowStep(step.number);
                }
              }}
            >
              <div style={dashboardStyles.stepNumber}>
                {contractFlowStep > step.number ? '✓' : step.number}
              </div>
              <div style={dashboardStyles.stepContent}>
                <div style={dashboardStyles.stepTitle}>{step.title}</div>
                {step.number === 2 && (() => {
                  const sc = contractFlowData.specialConsiderations;
                  // Check old format
                  const hasOldFormat = typeof sc?.profitSharing === 'boolean';
                  const hasAnyOld = hasOldFormat && (sc.profitSharing || sc.shiftPremium || sc.signingBonus || sc.other || sc.notApplicable);
                  
                  // Check new format
                  const hasNewFormat = sc?.profitSharing && typeof sc.profitSharing === 'object';
                  const hasAnyNew = hasNewFormat && (
                    (sc.profitSharing?.enabled && sc.profitSharing?.sections?.length > 0) ||
                    (sc.shiftPremium?.enabled && sc.shiftPremium?.sections?.length > 0) ||
                    (sc.signingBonus?.enabled && sc.signingBonus?.sections?.length > 0) ||
                    (sc.other?.enabled && sc.other?.sections?.length > 0) ||
                    sc.notApplicable
                  );
                  
                  if (hasAnyOld || hasAnyNew) {
                    return (
                      <div style={dashboardStyles.stepBadge}>
                        {sc.notApplicable ? 'N/A' : 'Special Terms Added'}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          ))}
        </div>
      </div>


      {/* Modals for steps */}
      <KeyTermsModal
        isOpen={showKeyTermsModal}
        onClose={() => setShowKeyTermsModal(false)}
        data={contractFlowData.keyTerms}
        onSave={(data) => {
          const { contractPreamble, ...keyTerms } = data;
          setContractFlowData((prev) => {
            const emailChanged =
              normalizeContractEmail(prev.keyTerms?.employeeEmail) !==
              normalizeContractEmail(keyTerms.employeeEmail);
            return {
              ...prev,
              keyTerms,
              contractPreamble: contractPreamble || prev.contractPreamble,
              finalContract: emailChanged ? null : prev.finalContract,
            };
          });
          setContractFlowStep(2);
          setShowKeyTermsModal(false);
        }}
        businessData={businessData}
        businessId={selectedBusinessId}
      />
      
      <SpecialConsiderationsModal
        isOpen={showSpecialConsiderationsModal}
        onClose={() => setShowSpecialConsiderationsModal(false)}
        data={contractFlowData.specialConsiderations}
        onSave={(data) => {
          setContractFlowData(prev => ({ ...prev, specialConsiderations: data }));
          setContractFlowStep(3);
          setShowSpecialConsiderationsModal(false);
        }}
      />
      
      <SelectTermsModal
        isOpen={showSelectTermsModal}
        onClose={() => setShowSelectTermsModal(false)}
        selectedTerms={contractFlowData.selectedTerms}
        onSave={(terms) => {
          setContractFlowData(prev => ({ ...prev, selectedTerms: terms }));
          setContractFlowStep(4);
          setShowSelectTermsModal(false);
        }}
        businessId={selectedBusinessId}
      />
      
      <ReviewContractModal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        contractData={contractFlowData}
        businessData={businessData}
        onSaveDraft={onSaveDraft}
        title={contractFlowData?.finalContract ? 'Review Contract' : 'Step 4: Review Contract'}
        onOpenSendModal={() => {
          setShowSendContractModal(true);
          setShowReviewModal(false);
        }}
      />
      
      <SendContractModal
        isOpen={showSendContractModal}
        onClose={() => setShowSendContractModal(false)}
        contractData={{
          ...contractFlowData,
          businessData,
          generateContractPDF: () => generateContractPDF({ ...contractFlowData, businessData })
        }}
        businessData={businessData}
        onSendComplete={async (contractData) => {
          try {
            // SendContractModal already saves the contract to the database with all data (PDF, HTML, tokens, etc.)
            // So we just need to reload the stats and contracts list, and reset the form
            // DO NOT call onSaveContract here - it will create a duplicate contract
            if (contractData.finalContract?.id || contractData.contractRecord?.id) {
              // Contract was already saved by SendContractModal - just reload
              if (loadContractStats) await loadContractStats();
              if (loadContracts) await loadContracts();
            } else {
              // This should never happen - SendContractModal always saves before calling onSendComplete
              console.error('ERROR: Contract was not saved by SendContractModal. This should not happen.');
              toast.error('Contract was sent but not saved properly. Please check the contracts list.');
              // DO NOT call onSaveContract here - it will create a duplicate
              if (loadContractStats) await loadContractStats();
              if (loadContracts) await loadContracts();
            }
            
            setShowSendContractModal(false);
            setContractFlowStep(1);
            setContractFlowData({
              keyTerms: {
                firstName: '',
                lastName: '',
                positionTitle: '',
                employeeAddress: '',
                employeePhone: '',
                managerId: '',
                managerName: '',
                employmentType: '',
                contractStartDate: '',
                contractEndDate: '',
                probationaryPeriod: 90,
                baseHourlyWage: '',
                vacationPayRate: '4',
                primaryWorkLocation: '',
                employerContactEmail: '',
                employeeEmail: ''
              },
              specialConsiderations: {
                notApplicable: false,
                profitSharing: { enabled: false, title: 'Profit Sharing', sections: [] },
                shiftPremium: { enabled: false, title: 'Shift Premium', sections: [] },
                signingBonus: { enabled: false, title: 'Signing Bonus', sections: [] },
                other: { enabled: false, title: 'Other Considerations', sections: [] }
              },
              selectedTerms: [],
              finalContract: null
            });
          } catch (error) {
            console.error('Error completing send:', error);
            toast.error('Contract sent but failed to reload contract list');
          }
        }}
      />
    </div>
  );
};

// SPECIAL CONSIDERATIONS STEP
const SpecialConsiderationsStep = ({ data, onUpdate, onNext, onBack }) => {
  const handleChange = (field, value) => {
    onUpdate({ ...data, [field]: value });
  };

  return (
    <div style={dashboardStyles.stepContentArea}>
      <h3 style={dashboardStyles.stepContentTitle}>Step 2: Special Considerations</h3>
      <p style={dashboardStyles.stepContentDescription}>
        Add any additional features or clauses that are out of the ordinary for this employee.
      </p>
      
      <div style={dashboardStyles.specialConsiderations}>
        <div style={dashboardStyles.considerationItem}>
          <TavariCheckbox
            checked={data.profitSharing}
            onChange={(checked) => handleChange('profitSharing', checked)}
            label="Profit Sharing"
          />
          {data.profitSharing && (
            <textarea
              value={data.profitSharingClause}
              onChange={(e) => handleChange('profitSharingClause', e.target.value)}
              placeholder="Enter profit sharing clause..."
              style={dashboardStyles.clauseTextarea}
              rows={4}
            />
          )}
        </div>
        
        <div style={dashboardStyles.considerationItem}>
          <TavariCheckbox
            checked={data.shiftPremium}
            onChange={(checked) => handleChange('shiftPremium', checked)}
            label="Shift Premium"
          />
          {data.shiftPremium && (
            <textarea
              value={data.shiftPremiumClause}
              onChange={(e) => handleChange('shiftPremiumClause', e.target.value)}
              placeholder="Enter shift premium clause..."
              style={dashboardStyles.clauseTextarea}
              rows={4}
            />
          )}
        </div>
        
        <div style={dashboardStyles.considerationItem}>
          <TavariCheckbox
            checked={data.signingBonus}
            onChange={(checked) => handleChange('signingBonus', checked)}
            label="Signing Bonus"
          />
          {data.signingBonus && (
            <textarea
              value={data.signingBonusClause}
              onChange={(e) => handleChange('signingBonusClause', e.target.value)}
              placeholder="Enter signing bonus clause..."
              style={dashboardStyles.clauseTextarea}
              rows={4}
            />
          )}
        </div>
        
        <div style={dashboardStyles.considerationItem}>
          <TavariCheckbox
            checked={data.other}
            onChange={(checked) => handleChange('other', checked)}
            label="Other"
          />
          {data.other && (
            <textarea
              value={data.otherClause}
              onChange={(e) => handleChange('otherClause', e.target.value)}
              placeholder="Enter other special considerations..."
              style={dashboardStyles.clauseTextarea}
              rows={4}
            />
          )}
        </div>
      </div>
      
      <div style={dashboardStyles.stepActions}>
        <button onClick={onBack} style={dashboardStyles.backButton}>Back</button>
        <button onClick={onNext} style={dashboardStyles.nextButton}>Continue</button>
      </div>
    </div>
  );
};

// SEND CONTRACT STEP
const SendContractStep = ({ contractData, onSend, onBack }) => {
  return (
    <div style={dashboardStyles.stepContentArea}>
      <h3 style={dashboardStyles.stepContentTitle}>Step 5: Send Contract</h3>
      <p style={dashboardStyles.stepContentDescription}>
        Generate PDF and send contract to {contractData.keyTerms.employeeEmail}
      </p>
      
      <div style={dashboardStyles.sendActions}>
        <button onClick={onBack} style={dashboardStyles.backButton}>Back</button>
        <button onClick={onSend} style={dashboardStyles.sendButton}>
          <Send size={18} style={{ marginRight: '8px' }} />
          Generate PDF & Send Email
        </button>
      </div>
    </div>
  );
};

const generateContractPDF = (contractData) => {
  const { keyTerms, specialConsiderations, selectedTerms, businessData } = contractData;
  
  // Debug: Log to ensure selectedTerms is present
  console.log('[generateContractPDF] Contract data check:', {
    hasKeyTerms: !!keyTerms,
    hasSpecialConsiderations: !!specialConsiderations,
    hasSelectedTerms: !!selectedTerms,
    selectedTermsCount: selectedTerms?.length || 0,
    selectedTermsPreview: selectedTerms?.slice(0, 3).map(t => ({ title: t.title, hasContent: !!t.content, hasSubsections: !!t.placeholder_tags?.length }))
  });
  
  // Get business timezone for date formatting
  const businessTimezone = getBusinessTimezone(businessData);
  
  // Format dates using business timezone
  const formatDateNumericForContract = (dateString) => {
    if (!dateString) return 'N/A';
    return formatDateForBusiness(dateString, businessTimezone);
  };
  
  // Alias for consistency
  const formatDateNumeric = formatDateNumericForContract;
  
  // Get date parts for header - use TODAY's date, not contract start date
  // The header date should be when the contract is created/signed, not when employment starts
  // Get today's date in business timezone - format as YYYY-MM-DD first, then parse
  const today = new Date();
  const todayInBusinessTZ = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: businessTimezone
  }).format(today);
  
  // Parse the date string directly (YYYY-MM-DD format)
  const [yearStr, monthStr, dayStr] = todayInBusinessTZ.split('-');
  const year = parseInt(yearStr);
  const monthIndex = parseInt(monthStr) - 1;
  const day = parseInt(dayStr);
  
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[monthIndex] || 'January';
  
  // Helper function for day suffix
  const getDaySuffix = (day) => {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };
  
  // Format employment type for title (combine type + status)
  const getEmploymentTypeTitle = (type, status) => {
    // Use provided values or fallback to keyTerms if not provided
    const employmentType = type || keyTerms?.employmentType || keyTerms?.contract_type || 'permanent';
    const employmentStatus = status || keyTerms?.employmentStatus || keyTerms?.employment_status || 'full-time';
    
    const typeMap = {
      'permanent': 'PERMANENT',
      'seasonal': 'SEASONAL',
      'temporary-contract': 'TEMPORARY CONTRACT',
      'temporary': 'TEMPORARY'
    };
    const statusMap = {
      'full-time': 'FULL TIME',
      'part-time': 'PART TIME',
      'fulltime': 'FULL TIME',
      'parttime': 'PART TIME'
    };
    
    const normalizedType = employmentType?.toLowerCase()?.trim();
    const normalizedStatus = employmentStatus?.toLowerCase()?.trim();
    
    const typeDisplay = typeMap[normalizedType] || (normalizedType ? normalizedType.toUpperCase() : 'PERMANENT');
    const statusDisplay = statusMap[normalizedStatus] || (normalizedStatus ? normalizedStatus.toUpperCase() : 'FULL TIME');
    
    if (typeDisplay && statusDisplay) {
      return `${typeDisplay} ${statusDisplay}`;
    }
    return typeDisplay || statusDisplay || 'PERMANENT FULL TIME';
  };
  
  // Format employment type for display (combine when needed)
  const getEmploymentTypeDisplay = (type, status) => {
    // Use provided values or fallback to keyTerms if not provided
    const employmentType = type || keyTerms?.employmentType || keyTerms?.contract_type || 'permanent';
    const employmentStatus = status || keyTerms?.employmentStatus || keyTerms?.employment_status || 'full-time';
    
    const typeMap = {
      'permanent': 'Permanent',
      'seasonal': 'Seasonal',
      'temporary-contract': 'Temporary Contract',
      'temporary': 'Temporary'
    };
    const statusMap = {
      'full-time': 'Full Time',
      'part-time': 'Part Time',
      'fulltime': 'Full Time',
      'parttime': 'Part Time'
    };
    
    const normalizedType = employmentType?.toLowerCase()?.trim();
    const normalizedStatus = employmentStatus?.toLowerCase()?.trim();
    
    const typeDisplay = typeMap[normalizedType] || (normalizedType ? normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1) : 'Permanent');
    const statusDisplay = statusMap[normalizedStatus] || (normalizedStatus ? normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1).replace('-', ' ') : 'Full Time');
    
    if (typeDisplay && statusDisplay) {
      return `${typeDisplay}, ${statusDisplay}`;
    }
    return typeDisplay || statusDisplay || 'Permanent, Full Time';
  };
  
  // Format wage
  const formatWage = (wage) => {
    const wageNum = parseFloat(wage) || 0;
    return `$${wageNum.toFixed(2)} per hour or current Ontario minimum wage, whichever is greater`;
  };
  
  // Format vacation pay
  const formatVacationPay = (rate) => {
    return `${rate || '4'}% (paid weekly)`;
  };
  
  // Render special considerations with sections and subsections for PDF
  const renderSpecialConsiderationsForPDF = (considerations) => {
    if (!considerations) return '';
    
    let html = '';
    let hasAnyConsideration = false;
    
    // Handle old format (backward compatibility)
    if (typeof considerations.profitSharing === 'boolean') {
      // Only render if the consideration is actually selected/enabled AND has content
      if (considerations.profitSharing && considerations.profitSharingClause && considerations.profitSharingClause.trim()) {
        if (!hasAnyConsideration) {
          html += '<h2>Special Considerations</h2>';
          hasAnyConsideration = true;
        }
        html += `<h3>Profit Sharing</h3><p>${considerations.profitSharingClause}</p>`;
      }
      if (considerations.shiftPremium && considerations.shiftPremiumClause && considerations.shiftPremiumClause.trim()) {
        if (!hasAnyConsideration) {
          html += '<h2>Special Considerations</h2>';
          hasAnyConsideration = true;
        }
        html += `<h3>Shift Premium</h3><p>${considerations.shiftPremiumClause}</p>`;
      }
      if (considerations.signingBonus && considerations.signingBonusClause && considerations.signingBonusClause.trim()) {
        if (!hasAnyConsideration) {
          html += '<h2>Special Considerations</h2>';
          hasAnyConsideration = true;
        }
        html += `<h3>Signing Bonus</h3><p>${considerations.signingBonusClause}</p>`;
      }
      if (considerations.other && considerations.otherClause && considerations.otherClause.trim()) {
        if (!hasAnyConsideration) {
          html += '<h2>Special Considerations</h2>';
          hasAnyConsideration = true;
        }
        html += `<h3>Other Considerations</h3><p>${considerations.otherClause}</p>`;
      }
      return html;
    }
    
    // New format with sections and subsections
    const considerationsList = [
      { key: 'profitSharing', label: 'Profit Sharing' },
      { key: 'shiftPremium', label: 'Shift Premium' },
      { key: 'signingBonus', label: 'Signing Bonus' },
      { key: 'other', label: 'Other Considerations' }
    ];
    
    considerationsList.forEach(({ key, label }) => {
      const consideration = considerations[key];
      
      // ONLY SHOW IF EXPLICITLY ENABLED === true
      // If enabled is not exactly true, DO NOT RENDER AT ALL
      if (!consideration || consideration.enabled !== true) {
        return; // SKIP - Do not show this consideration
      }
      
      // Must have sections array with content
      if (!Array.isArray(consideration.sections) || consideration.sections.length === 0) {
        return; // SKIP - No sections
      }
      
      // Helper function to escape HTML entities
      const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };
      
      // Helper function to render content with paragraph breaks preserved
      const renderContentWithParagraphs = (content) => {
        if (!content || !content.trim()) return '';
        // Split by double newlines (empty lines) to preserve paragraph breaks
        const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
        if (paragraphs.length === 0) return '';
        // If only one paragraph, return single <p> tag with escaped HTML
        if (paragraphs.length === 1) return `<p>${escapeHtml(paragraphs[0])}</p>`;
        // Multiple paragraphs - return each in its own <p> tag with escaped HTML
        return paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
      };
      
      // Check if any section has actual content
      const hasContent = consideration.sections.some(section => {
        if (!section) return false;
        const hasTitle = section.title && section.title.trim().length > 0;
        const hasContentText = section.content && section.content.trim().length > 0;
        const hasSubs = Array.isArray(section.subsections) && section.subsections.length > 0;
        const hasSubContent = hasSubs && section.subsections.some(sub => 
          (sub?.title && sub.title.trim().length > 0) || 
          (sub?.content && sub.content.trim().length > 0)
        );
        return hasTitle || hasContentText || hasSubContent;
      });
      
      if (!hasContent) {
        return; // SKIP - No content in sections
      }
      
      // RENDER THIS CONSIDERATION
      if (!hasAnyConsideration) {
        html += '<h2>Special Considerations</h2>';
        hasAnyConsideration = true;
      }
      html += `<h3>${consideration.title || label}</h3>`;
      
      consideration.sections.forEach((section) => {
        if (!section) return;
        
        const hasTitle = section.title && section.title.trim().length > 0;
        const hasContentText = section.content && section.content.trim().length > 0;
        const hasSubs = Array.isArray(section.subsections) && section.subsections.length > 0;
        const hasSubContent = hasSubs && section.subsections.some(sub => 
          (sub?.title && sub.title.trim().length > 0) || 
          (sub?.content && sub.content.trim().length > 0)
        );
        
        if (hasTitle || hasContentText || hasSubContent) {
          if (hasTitle) {
            html += `<h4>${section.title.trim()}</h4>`;
          }
          if (hasContentText) {
            html += renderContentWithParagraphs(section.content);
          }
          
          if (hasSubs) {
            section.subsections.forEach((subsection) => {
              if (!subsection) return;
              const subTitle = subsection.title && subsection.title.trim().length > 0;
              const subContent = subsection.content && subsection.content.trim().length > 0;
              if (subTitle || subContent) {
                if (subTitle) html += `<h5><strong>${subsection.title.trim()}</strong></h5>`;
                if (subContent) html += renderContentWithParagraphs(subsection.content);
              }
            });
          }
        }
      });
    });
    
    return html;
  };
  
  // Calculate probation end date
  let probationEndDate = '';
  if (keyTerms.contractStartDate && keyTerms.probationaryPeriod) {
    const startDate = new Date(keyTerms.contractStartDate);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (keyTerms.probationaryPeriod || 90));
    probationEndDate = formatDateNumeric(endDate.toISOString());
  }
  
  // Get employer and employee info
  const employerName = businessData?.business_name || businessData?.name || '[EMPLOYER NAME]';
  const employerAddress = businessData?.business_address || businessData?.address || '[EMPLOYER ADDRESS]';
  const employeeName = `${keyTerms.firstName || ''} ${keyTerms.lastName || ''}`.trim() || '[EMPLOYEE NAME]';
  const employeeAddress = keyTerms.employeeAddress || '[EMPLOYEE ADDRESS]';
  const employeePhone = keyTerms.employeePhone || '[EMPLOYEE PHONE]';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: letter; margin: 0.5in; }
        body { font-family: Arial, sans-serif; padding: 8px; line-height: 1.4; font-size: 9px; margin: 0; }
        .contract-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 10px;
        }
        .contract-page-number {
          text-align: right;
          font-size: 9px;
          color: #666;
        }
        .contract-title {
          text-align: center;
          margin: 10px 0;
        }
        .contract-title-main {
          font-size: 14px;
          font-weight: bold;
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .contract-title-sub {
          font-size: 14px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .contract-intro {
          margin-bottom: 10px;
        }
        .contract-intro p {
          margin: 5px 0;
          line-height: 1.4;
        }
        .contract-intro .party-name {
          font-weight: bold;
        }
        .contract-intro .party-label {
          font-style: italic;
        }
        .contract-section {
          margin: 8px 0;
        }
        .contract-section-title {
          font-weight: bold;
          font-size: 18px;
          margin-bottom: 5px;
        }
        .contract-section-content {
          line-height: 1.4;
          margin-bottom: 8px;
        }
        .key-terms-summary {
          margin: 10px 0;
        }
        .key-terms-summary-title {
          font-weight: bold;
          font-size: 14px;
          margin-bottom: 8px;
        }
        .key-terms-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 15px;
        }
        .key-terms-row {
          margin: 4px 0;
          line-height: 1.4;
        }
        .key-terms-label {
          font-weight: bold;
          display: inline;
        }
        .key-terms-value {
          margin-left: 5px;
        }
        h2 {
          font-size: 14px;
          font-weight: bold;
          margin: 10px 0 6px 0;
        }
        h3 {
          font-size: 14px;
          font-weight: bold;
          margin: 8px 0 5px 0;
        }
        h4 {
          font-size: 12px;
          font-weight: bold;
          margin: 6px 0 4px 0;
        }
        h5 {
          font-size: 12px;
          font-weight: bold;
          margin: 5px 0 3px 0;
        }
        p {
          margin: 4px 0;
          line-height: 1.4;
        }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <div class="contract-header">
        <div></div>
        <div class="contract-page-number">Page | 1</div>
      </div>
      
      <div class="contract-title">
        <div class="contract-title-main">EMPLOYMENT CONTRACT</div>
        <div class="contract-title-sub">${getEmploymentTypeTitle(keyTerms.employmentType, keyTerms.employmentStatus)}</div>
      </div>
      
      <div class="contract-intro">
        <p>THIS EMPLOYMENT CONTRACT (the "Agreement") dated this ${day}${getDaySuffix(day)} day of ${month}, ${year}</p>
        <p>
          <span class="party-name">${employerName}</span> of ${employerAddress}
        </p>
        <p class="party-label">(the "Employer")</p>
        <p>
          <span class="party-name">${employeeName}</span> of ${employeeAddress}
        </p>
        <p>Phone: ${employeePhone}</p>
        <p class="party-label">(the "Employee")</p>
      </div>
      
      <div class="contract-section">
        <div class="contract-section-title">BACKGROUND:</div>
        <div class="contract-section-content">
          <p>The employer is of the opinion that the Employee has the necessary qualifications, experience and abilities to assist and benefit the Employer in its business.</p>
          <p>The Employer desires to employ the Employee and the Employee has agreed to accept and enter such employment upon the terms and conditions set out in this Agreement.</p>
        </div>
      </div>
      
      <div class="contract-section">
        <div class="contract-section-title">IN CONSIDERATION OF</div>
        <div class="contract-section-content">
          <p>IN CONSIDERATION OF the matters described above and of the mutual benefits and obligations set forth in this Agreement, the receipt and sufficiency of which consideration is hereby acknowledged, the parties to this Agreement agree as follows:</p>
        </div>
      </div>
      
      <div class="key-terms-summary">
        <div class="key-terms-summary-title">1. EMPLOYMENT CONTRACT – KEY TERMS SUMMARY</div>
        <div class="key-terms-container">
          <div class="key-terms-column">
            <div class="key-terms-row">
              <span class="key-terms-label">Employee Name:</span>
              <span class="key-terms-value">${keyTerms.firstName || ''} ${keyTerms.lastName || ''}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Position:</span>
              <span class="key-terms-value">${keyTerms.positionTitle || '[POSITION]'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employment Type:</span>
              <span class="key-terms-value">${getEmploymentTypeDisplay(keyTerms.employmentType, keyTerms.employmentStatus)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Contract Start Date:</span>
              <span class="key-terms-value">${formatDateNumeric(keyTerms.contractStartDate)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Contract End Date:</span>
              <span class="key-terms-value">${keyTerms.contractEndDate ? formatDateNumeric(keyTerms.contractEndDate) : 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Probationary Period:</span>
              <span class="key-terms-value">${keyTerms.probationaryPeriod || 90} days (Ends ${probationEndDate || 'N/A'})</span>
            </div>
          </div>
          <div class="key-terms-column">
            <div class="key-terms-row">
              <span class="key-terms-label">Base Hourly Wage:</span>
              <span class="key-terms-value">${formatWage(keyTerms.baseHourlyWage)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Vacation Pay Rate:</span>
              <span class="key-terms-value">${formatVacationPay(keyTerms.vacationPayRate)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Primary Work Location:</span>
              <span class="key-terms-value">${keyTerms.primaryWorkLocation || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employer Contact Email:</span>
              <span class="key-terms-value">${keyTerms.employerContactEmail || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Manager:</span>
              <span class="key-terms-value">${keyTerms.managerName || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employee Phone:</span>
              <span class="key-terms-value">${keyTerms.employeePhone || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employee Email:</span>
              <span class="key-terms-value">${keyTerms.employeeEmail || 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>
      
      ${renderSpecialConsiderationsForPDF(specialConsiderations)}
      <h2>Contract Terms</h2>
      ${(() => {
        // Helper function to escape HTML entities
        const escapeHtml = (text) => {
          if (typeof text !== 'string') return '';
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        };
        
        // Helper function to render content with paragraph breaks preserved
        const renderContentWithParagraphs = (content) => {
          if (!content || !content.trim()) return '';
          // Split by double newlines (empty lines) to preserve paragraph breaks
          const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
          if (paragraphs.length === 0) return '';
          // If only one paragraph, return single <p> tag with escaped HTML
          if (paragraphs.length === 1) return `<p>${escapeHtml(paragraphs[0])}</p>`;
          // Multiple paragraphs - return each in its own <p> tag with escaped HTML
          return paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
        };
        
        // Track section numbering (Key Terms Summary is section 1, so start from 2)
        let currentSectionNumber = 2;
        let currentSubsectionNumber = 0;
        
        const termsToRender = (selectedTerms || []).filter(term => {
          const titleWithoutNumber = (term.title || '').replace(/^\d+\.\s*/, '');
          const isKeyTerms = titleWithoutNumber.toLowerCase().includes('key terms summary') || 
                             titleWithoutNumber.toLowerCase().includes('employment contract – key terms');
          return !isKeyTerms; // Filter out Key Terms Summary
        });
        
        console.log('[generateContractPDF] Rendering sections:', {
          totalSelectedTerms: selectedTerms?.length || 0,
          afterFiltering: termsToRender.length,
          first3Titles: termsToRender.slice(0, 3).map(t => t.title)
        });
        
        return termsToRender.map((term, termIndex) => {
          // Render section with proper numbering
          const titleWithoutNumber = (term.title || '').replace(/^\d+\.\s*/, '');
          
          // Add section number dynamically
          const sectionNum = currentSectionNumber++;
          currentSubsectionNumber = 0; // Reset subsection counter for new section
          
          let html = `<h3>${sectionNum}. ${titleWithoutNumber}</h3>`;
          if (term.content) {
            html += renderContentWithParagraphs(term.content);
          }
          
          // Render subsections if they exist
          if (term.placeholder_tags && Array.isArray(term.placeholder_tags) && term.placeholder_tags.length > 0) {
            term.placeholder_tags.forEach((subsection) => {
              const subTitle = subsection.title || '';
              const subContent = subsection.content || '';
              const cleanSubTitle = subTitle.replace(/^\d+\.\d+\.?\s*/, '');
              
              if (cleanSubTitle || subContent) {
                // Increment subsection number for this section
                currentSubsectionNumber++;
                const subsectionNum = currentSubsectionNumber;
                
                // Render subsection title and content with paragraph breaks
                html += `<div style="margin-left: 15px; padding-left: 12px;">`;
                if (cleanSubTitle) {
                  // Subsection with title: "2.1. Title"
                  html += `<p style="text-indent: -12px; padding-left: 12px; margin-bottom: 5px;"><strong>${sectionNum}.${subsectionNum}.</strong> ${escapeHtml(cleanSubTitle)}</p>`;
                }
                if (subContent) {
                  // Render content with paragraph breaks
                  const contentParagraphs = subContent.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
                  if (contentParagraphs.length > 0) {
                    contentParagraphs.forEach((paragraph, paraIndex) => {
                      if (paraIndex === 0 && !cleanSubTitle) {
                        // First paragraph of subsection without title - add subsection number
                        html += `<p style="text-indent: -12px; padding-left: 12px; margin-bottom: 5px;"><strong>${sectionNum}.${subsectionNum}.</strong> ${escapeHtml(paragraph)}</p>`;
                      } else {
                        // Subsequent paragraphs or paragraphs after a title
                        html += `<p style="text-indent: 0; padding-left: 0; margin-bottom: 5px;">${escapeHtml(paragraph)}</p>`;
                      }
                    });
                  }
                }
                html += `</div>`;
              }
            });
          }
          
          return html;
        }).join('');
      })()}
      
      <div class="contract-section" style="margin-top: 12px;">
        <div class="contract-section-content" style="text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 10px;">
          IN WITNESS WHEREOF
        </div>
        <div class="contract-section-content" style="margin-bottom: 10px;">
          <p>The parties have duly affixed their signatures as of the date indicated below, and acknowledge agreement to the terms, including those summarized in the Key Terms Summary at the beginning of this Agreement.</p>
        </div>
        
        <div style="margin-top: 10px;">
          <div style="margin-bottom: 10px;">
            <p style="margin-bottom: 5px;"><strong>For the Employer</strong></p>
            <p style="margin-bottom: 5px;">${businessData?.business_name || businessData?.name || '[EMPLOYER NAME]'}</p>
            <p style="margin-bottom: 8px;">By its authorized representative:</p>
            <div style="margin-bottom: 10px;">
              <p style="margin-bottom: 3px; font-size: 12px;">Authorized Representative</p>
              <div style="border-bottom: 1px solid #000; height: 30px; margin-bottom: 8px;"></div>
              <p style="margin-bottom: 3px; font-size: 14px;">Date:</p>
              <div style="border-bottom: 1px solid #000; height: 30px;"></div>
            </div>
          </div>
          
          <div style="margin-top: 10px;">
            <p style="margin-bottom: 8px;"><strong>For the Employee:</strong></p>
            <div style="margin-bottom: 10px;">
              <p style="margin-bottom: 3px; font-size: 12px;">Employee Signature:</p>
              <div style="border-bottom: 1px solid #000; height: 30px; margin-bottom: 8px;"></div>
              <p style="margin-bottom: 3px; font-size: 16px;">Date:</p>
              <div style="border-bottom: 1px solid #000; height: 30px;"></div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Export generateContractPDF for use in other components
export { generateContractPDF };

// CONTRACTS LIST MODAL
const ContractsListModal = ({ isOpen, onClose, title, contracts = [], onViewContract, onDeleteContract, onResendContract, onCreateEmployee, businessData, onResendPersonalInfo, onSignContract }) => {
  const [hoveredContract, setHoveredContract] = useState(null);
  const [deletingContractId, setDeletingContractId] = useState(null);
  const [resendingContractId, setResendingContractId] = useState(null);
  const [creatingEmployeeId, setCreatingEmployeeId] = useState(null);
  const [resendingPersonalInfoId, setResendingPersonalInfoId] = useState(null);
  
  if (!isOpen) return null;
  
  // Ensure contracts is always an array
  const safeContracts = Array.isArray(contracts) ? contracts : [];
  
  const handleContractClick = (contract, e) => {
    e.stopPropagation();
    if (onViewContract) {
      onViewContract(contract);
    }
    onClose();
  };

  const handleDeleteClick = async (contract, e) => {
    e.stopPropagation();
    const display = getContractEmployeeDisplay(contract);
    const employeeName = display.fullName || 'this contract';
    
    if (!window.confirm(`Are you sure you want to delete the contract for ${employeeName || 'this employee'}? This action cannot be undone.`)) {
      return;
    }

    setDeletingContractId(contract.id);
    try {
      if (onDeleteContract) {
        await onDeleteContract(contract);
      }
    } catch (error) {
      console.error('Error deleting contract:', error);
      toast.error('Failed to delete contract: ' + (error.message || 'Unknown error'));
    } finally {
      setDeletingContractId(null);
    }
  };

  const handleResendClick = async (contract, e) => {
    e.stopPropagation();
    if (onResendContract) {
      setResendingContractId(contract.id);
      try {
        await onResendContract(contract);
        onClose();
      } catch (error) {
        console.error('Error resending contract:', error);
        toast.error('Failed to resend contract: ' + (error.message || 'Unknown error'));
      } finally {
        setResendingContractId(null);
      }
    }
  };

  const handleCreateEmployeeClick = async (contract, e) => {
    e.stopPropagation();
    if (onCreateEmployee) {
      setCreatingEmployeeId(contract.id);
      try {
        await onCreateEmployee(contract);
      } catch (error) {
        console.error('Error creating employee:', error);
        toast.error('Failed to create employee: ' + (error.message || 'Unknown error'));
      } finally {
        setCreatingEmployeeId(null);
      }
    }
  };

  const handleResendPersonalInfoClick = async (contract, e) => {
    e.stopPropagation();
    if (onResendPersonalInfo) {
      setResendingPersonalInfoId(contract.id);
      try {
        await onResendPersonalInfo(contract);
      } catch (error) {
        console.error('Error resending personal info form:', error);
        toast.error('Failed to resend personal info form: ' + (error.message || 'Unknown error'));
      } finally {
        setResendingPersonalInfoId(null);
      }
    }
  };

  const handleSignContractClick = (contract, e) => {
    e.stopPropagation();
    if (onSignContract) {
      onSignContract(contract);
      onClose();
    }
  };
  
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>{title}</h2>
          <button onClick={onClose} style={modalStyles.closeButton}>
            <X size={24} />
          </button>
        </div>
        <div style={modalStyles.body}>
          {safeContracts.length === 0 ? (
            <div style={modalStyles.emptyState}>No contracts found</div>
          ) : (
            <div style={modalStyles.contractList}>
              {safeContracts.map((contract) => {
                const display = getContractEmployeeDisplay(contract);
                const employeeName = display.fullName || 'Unknown Employee';
                const isDeleting = deletingContractId === contract.id;
                
                return (
                  <div 
                    key={contract.id} 
                    style={{
                      ...modalStyles.contractItem,
                      ...(hoveredContract === contract.id ? modalStyles.contractItemHover : {})
                    }}
                    onMouseEnter={() => setHoveredContract(contract.id)}
                    onMouseLeave={() => setHoveredContract(null)}
                  >
                    <div 
                      style={modalStyles.contractItemContent}
                      onClick={(e) => handleContractClick(contract, e)}
                    >
                      <div style={modalStyles.contractName}>
                        {employeeName}
                      </div>
                      <div style={modalStyles.contractDate}>
                        {contract.start_date && contract.end_date
                          ? `${formatDateShort(contract.start_date, businessData?.timezone || 'America/Toronto')} – ${formatDateShort(contract.end_date, businessData?.timezone || 'America/Toronto')}`
                          : contract.end_date
                            ? `Ends: ${formatDateShort(contract.end_date, businessData?.timezone || 'America/Toronto')}`
                            : contract.start_date
                              ? `Starts: ${formatDateShort(contract.start_date, businessData?.timezone || 'America/Toronto')}`
                              : 'No date set'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {onSignContract && (
                        <button
                          style={{
                            ...modalStyles.deleteButton,
                            opacity: 1,
                            cursor: 'pointer',
                            backgroundColor: 'transparent',
                            borderColor: '#f59e0b',
                            color: '#f59e0b'
                          }}
                          onClick={(e) => handleSignContractClick(contract, e)}
                          title="Open and sign contract"
                          onMouseEnter={(e) => {
                            e.target.style.backgroundColor = '#fef3c7';
                            e.target.style.borderColor = '#f59e0b';
                            e.target.style.color = '#f59e0b';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'transparent';
                            e.target.style.borderColor = '#f59e0b';
                            e.target.style.color = '#f59e0b';
                          }}
                        >
                          <PenTool size={18} />
                        </button>
                      )}
                      {onResendPersonalInfo && (contract.status === 'employee_signed' || contract.status === 'signed') && (
                        <button
                          style={{
                            ...modalStyles.deleteButton,
                            opacity: resendingPersonalInfoId === contract.id ? 0.6 : 1,
                            cursor: resendingPersonalInfoId === contract.id ? 'not-allowed' : 'pointer',
                            backgroundColor: 'transparent',
                            borderColor: '#7c3aed',
                            color: '#7c3aed'
                          }}
                          onClick={(e) => handleResendPersonalInfoClick(contract, e)}
                          disabled={resendingPersonalInfoId === contract.id}
                          title="Resend personal information form"
                          onMouseEnter={(e) => {
                            if (resendingPersonalInfoId !== contract.id) {
                              e.target.style.backgroundColor = '#ede9fe';
                              e.target.style.borderColor = '#7c3aed';
                              e.target.style.color = '#7c3aed';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'transparent';
                            e.target.style.borderColor = '#7c3aed';
                            e.target.style.color = '#7c3aed';
                          }}
                        >
                          <FileText size={18} />
                        </button>
                      )}
                      {onCreateEmployee && contract.status === 'signed' && (
                        <button
                          style={{
                            ...modalStyles.deleteButton,
                            opacity: creatingEmployeeId === contract.id ? 0.6 : 1,
                            cursor: creatingEmployeeId === contract.id ? 'not-allowed' : 'pointer',
                            backgroundColor: 'transparent',
                            borderColor: '#059669',
                            color: '#059669'
                          }}
                          onClick={(e) => handleCreateEmployeeClick(contract, e)}
                          disabled={creatingEmployeeId === contract.id}
                          title="Create employee profile from contract"
                          onMouseEnter={(e) => {
                            if (creatingEmployeeId !== contract.id) {
                              e.target.style.backgroundColor = '#d1fae5';
                              e.target.style.borderColor = '#059669';
                              e.target.style.color = '#059669';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'transparent';
                            e.target.style.borderColor = '#059669';
                            e.target.style.color = '#059669';
                          }}
                        >
                          <UserPlus size={18} />
                        </button>
                      )}
                      {onResendContract && (
                        <button
                          style={{
                            ...modalStyles.deleteButton,
                            opacity: resendingContractId === contract.id ? 0.6 : 1,
                            cursor: resendingContractId === contract.id ? 'not-allowed' : 'pointer',
                            backgroundColor: 'transparent',
                            borderColor: '#008080',
                            color: '#008080'
                          }}
                          onClick={(e) => handleResendClick(contract, e)}
                          disabled={resendingContractId === contract.id}
                          title="Resend contract"
                          onMouseEnter={(e) => {
                            if (resendingContractId !== contract.id) {
                              e.target.style.backgroundColor = '#e0f7f7';
                              e.target.style.borderColor = '#008080';
                              e.target.style.color = '#008080';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'transparent';
                            e.target.style.borderColor = '#008080';
                            e.target.style.color = '#008080';
                          }}
                        >
                          <Send size={18} />
                        </button>
                      )}
                      {onDeleteContract && (
                        <button
                          style={{
                            ...modalStyles.deleteButton,
                            opacity: isDeleting ? 0.6 : 1,
                            cursor: isDeleting ? 'not-allowed' : 'pointer'
                          }}
                          onClick={(e) => handleDeleteClick(contract, e)}
                          disabled={isDeleting}
                          title="Delete contract"
                          onMouseEnter={(e) => {
                            if (!isDeleting) {
                              e.target.style.backgroundColor = '#fee2e2';
                              e.target.style.borderColor = '#dc2626';
                              e.target.style.color = '#dc2626';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'transparent';
                            e.target.style.borderColor = '#ef4444';
                            e.target.style.color = '#ef4444';
                          }}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// VIEW CONTRACTS TAB COMPONENT
// DRAFTS TAB
const DraftsTab = ({ drafts, loading, onRestoreDraft, onDeleteDraft, businessData }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const businessTimezone = getBusinessTimezone(businessData);

  const filteredDrafts = (drafts || []).filter(draft => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    const name = `${draft.employee_first_name || ''} ${draft.employee_last_name || ''}`.toLowerCase();
    const email = (draft.employee_email || '').toLowerCase();
    const position = (draft.position_title || '').toLowerCase();
    return name.includes(search) || email.includes(search) || position.includes(search);
  });

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return formatDateTimeForBusiness(dateString, businessTimezone);
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p>Loading drafts...</p>
      </div>
    );
  }

  return (
    <div style={styles.tabContent}>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }} />
          <input
            type="text"
            placeholder="Search drafts by name, email, or position..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px 10px 40px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '16px'
            }}
          />
        </div>
        <div style={{ color: '#6b7280', fontSize: '16px' }}>
          {filteredDrafts.length} draft{filteredDrafts.length !== 1 ? 's' : ''}
        </div>
      </div>

      {filteredDrafts.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#6b7280' }}>
          <FileText size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
          <h3 style={{ marginBottom: '8px' }}>No Drafts Found</h3>
          <p>You don't have any saved contract drafts yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {filteredDrafts.map((draft) => (
            <div
              key={draft.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '20px',
                backgroundColor: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600' }}>
                    {draft.employee_first_name} {draft.employee_last_name}
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px', color: '#6b7280' }}>
                    <span><strong>Position:</strong> {draft.position_title || 'N/A'}</span>
                    <span><strong>Type:</strong> {draft.contract_type || 'N/A'} - {draft.employment_status || 'N/A'}</span>
                    <span><strong>Email:</strong> {draft.employee_email || 'N/A'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => onRestoreDraft(draft)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '16px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Edit size={16} />
                    Continue Editing
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to delete this draft?')) {
                        onDeleteDraft(draft.id);
                      }
                    }}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '14px', color: '#9ca3af', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                <span>Last updated: {formatDate(draft.updated_at)}</span>
                {draft.created_at !== draft.updated_at && (
                  <span style={{ marginLeft: '16px' }}>Created: {formatDate(draft.created_at)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ViewContractsTab = ({
  contracts,
  contractFiles,
  complianceRecords,
  loading,
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  onViewContract,
  onCreateEmployee,
  getComplianceStatus,
  canManageFiles,
  canViewCompliance,
  canEditContracts,
  businessData,
  onResendPersonalInfo
}) => {
  if (loading) {
    return <div style={styles.loading}>Loading contracts...</div>;
  }

  return (
    <div style={styles.tabContent}>
      {/* Search and Filter Controls */}
      <div style={styles.controls}>
        <div style={styles.searchGroup}>
          <Search size={20} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search contracts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>
        
        <div style={styles.filterGroup}>
          <Filter size={20} style={styles.filterIcon} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="pending">Pending Signature</option>
            <option value="employee_signed">Awaiting Employer Signature</option>
            <option value="signed">Signed (Complete)</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      {/* Contracts Grid */}
      {contracts.length === 0 ? (
        <div style={styles.emptyState}>
          <FileText size={64} style={{ color: '#9ca3af', marginBottom: '20px' }} />
          <h3>No contracts found</h3>
          <p>No contracts match your current filters.</p>
        </div>
      ) : (
        <div style={styles.contractGrid}>
          {contracts.map((contract) => (
            <div key={contract.id} style={styles.contractCard}>
              <div style={styles.contractHeader}>
                <div style={styles.contractTitle}>{contract.title}</div>
                <span style={{
                  ...styles.statusBadge,
                  ...getStatusStyle(contract.status)
                }}>
                  {contract.status}
                </span>
              </div>

              <div style={styles.contractBody}>
                <div style={styles.employeeInfo}>
                  <div style={styles.employeeName}>
                    {getContractEmployeeDisplay(contract).fullName || 'Unknown'}
                  </div>
                  <div style={styles.employeeDetail}>Employee #: {contract.employee?.employee_number}</div>
                  <div style={styles.employeeDetail}>Position: {contract.employee?.position || 'N/A'}</div>
                </div>

                <div style={styles.contractDates}>
                  <div style={styles.dateRow}>
                    <span>Start:</span>
                    <span>{formatDateShort(contract.start_date, businessData?.timezone || 'America/Toronto')}</span>
                  </div>
                </div>

                {canManageFiles && (
                  <div style={styles.fileInfo}>
                    <FileText size={16} />
                    <span>{contractFiles[contract.id]?.length || 0} files</span>
                  </div>
                )}

                {canViewCompliance && (() => {
                  const compliance = getComplianceStatus(contract.employee_id);
                  return compliance.count > 0 && (
                    <div style={{ ...styles.complianceInfo, borderColor: compliance.color }}>
                      <Shield size={16} style={{ color: compliance.color }} />
                      <span style={{ color: compliance.color }}>
                        {compliance.count} compliance {compliance.status}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div style={styles.contractActions}>
                {onResendPersonalInfo && (contract.status === 'employee_signed' || contract.status === 'signed') && (
                  <button
                    onClick={() => onResendPersonalInfo(contract)}
                    style={{
                      ...styles.actionButton,
                      backgroundColor: '#7c3aed',
                      color: 'white',
                      borderColor: '#7c3aed'
                    }}
                    title="Resend personal information form"
                  >
                    <FileText size={16} />
                    Resend Info Form
                  </button>
                )}
                {onCreateEmployee && contract.status === 'signed' && (
                  <button
                    onClick={() => onCreateEmployee(contract)}
                    style={{
                      ...styles.actionButton,
                      backgroundColor: '#059669',
                      color: 'white',
                      borderColor: '#059669'
                    }}
                    title="Create employee profile from contract"
                  >
                    <UserPlus size={16} />
                    Create Employee
                  </button>
                )}
                {canEditContracts && (
                  <button
                    onClick={() => onViewContract(contract)}
                    style={styles.actionButton}
                  >
                    <Eye size={16} />
                    {contract.status === 'signed' ? 'View' : 'View/Edit'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// CREATE CONTRACT TAB COMPONENT
const CreateContractTab = ({
  contractTitle,
  setContractTitle,
  contractType,
  setContractType,
  contractSections,
  onAddSection,
  onAddSubsection,
  onUpdateSection,
  onUpdateSubsection,
  onDeleteSection,
  onDeleteSubsection,
  onMoveSection,
  onSaveTemplate,
  availableTemplates,
  selectedTemplateId,
  onLoadTemplate,
  onDeleteTemplate,
  loadingTemplates,
  onExportSelectedTemplate,
  onExportAllTemplates,
  onImportTemplatesFile,
}) => {
  const importFileRef = React.useRef(null);

  const transferBtn = (disabled) => ({
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #008080',
    backgroundColor: 'white',
    color: '#008080',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    fontWeight: 600,
    opacity: disabled ? 0.45 : 1,
  });

  return (
    <div style={styles.tabContent}>
      {/* Template Selector */}
      <div style={styles.templateSelector}>
        <div style={styles.formGroup}>
          <label style={styles.formLabel}>
            {selectedTemplateId ? 'Editing template' : 'New or existing template'}
            {loadingTemplates && <span style={{ marginLeft: '8px', color: '#666', fontSize: '14px' }}>(Loading...)</span>}
            {!loadingTemplates && availableTemplates.length > 0 && (
              <span style={{ marginLeft: '8px', color: '#28a745', fontSize: '14px' }}>
                ({availableTemplates.length} saved)
              </span>
            )}
          </label>
          <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#6b7280', lineHeight: 1.45 }}>
            Pick a template below to load it into the builder, change sections or metadata, then use{' '}
            <strong>{selectedTemplateId ? 'Update Contract Template' : 'Save Contract Template'}</strong> to write changes.
            Choose &quot;New template&quot; to start from scratch.
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={selectedTemplateId || ''}
              onChange={(e) => onLoadTemplate(e.target.value || null)}
              style={{ ...styles.formSelect, flex: '1 1 240px', minWidth: '200px' }}
              disabled={loadingTemplates}
              aria-label="Choose contract template to edit or new"
            >
              <option value="">— New template —</option>
              {availableTemplates.length === 0 && !loadingTemplates && (
                <option value="" disabled>No saved templates yet</option>
              )}
              {availableTemplates.map((template) => {
                const label = template.template_name || template.name || 'Untitled template';
                const typeLabel = template.contract_type || 'employment';
                return (
                  <option key={template.id} value={template.id}>
                    {label} ({typeLabel})
                  </option>
                );
              })}
            </select>
            {selectedTemplateId && onDeleteTemplate && (
              <button
                onClick={() => onDeleteTemplate(selectedTemplateId)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #dc3545',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap'
                }}
                title="Delete Template"
              >
                <Trash2 size={16} />
                Delete
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            marginTop: '16px',
            padding: '14px 16px',
            backgroundColor: '#f0fdfa',
            border: '1px solid #99f6e4',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f766e', marginBottom: '6px' }}>
            Export / import (copy to another business)
          </div>
          <p style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#64748b', lineHeight: 1.5 }}>
            While signed into the source business, export a JSON file. Switch to the target business in the dashboard,
            open Contract Templates here, and import the file. Names that already exist get an &quot;(imported)&quot; suffix.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => onExportSelectedTemplate?.()}
              style={transferBtn(!selectedTemplateId || loadingTemplates)}
              disabled={!selectedTemplateId || loadingTemplates}
              title="Download the template selected above"
            >
              <Download size={16} />
              Export selected
            </button>
            <button
              type="button"
              onClick={() => onExportAllTemplates?.()}
              style={transferBtn(loadingTemplates || !availableTemplates?.length)}
              disabled={loadingTemplates || !availableTemplates?.length}
              title="Download every template for this business in one file"
            >
              <Download size={16} />
              Export all
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f && onImportTemplatesFile) await onImportTemplatesFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              style={{
                ...transferBtn(loadingTemplates),
                backgroundColor: '#008080',
                color: 'white',
                borderColor: '#006666',
              }}
              disabled={loadingTemplates}
              title="Create new templates from a JSON export"
            >
              <Upload size={16} />
              Import from file
            </button>
          </div>
        </div>
      </div>

      {/* Contract Metadata */}
      <div style={styles.builderHeader}>
        <div style={styles.builderMetadata}>
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Contract Title</label>
            <input
              type="text"
              value={contractTitle}
              onChange={(e) => setContractTitle(e.target.value)}
              style={styles.formInput}
              placeholder="Employment Agreement"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Contract Type</label>
            <select
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              style={styles.formSelect}
            >
              <option value="employment">Employment</option>
              <option value="contractor">Contractor</option>
              <option value="probation">Probationary</option>
              <option value="ownership">Ownership</option>
            </select>
          </div>
        </div>

        <button onClick={onAddSection} style={styles.addSectionButton}>
          <Plus size={18} />
          Add Section
        </button>
      </div>

      {/* Section Builder */}
      <div style={styles.sectionsBuilder}>
        {contractSections.map((section, index) => {
          // Auto-number sections (skip header type)
          const sectionNumber = section.section_type === 'header' ? null : index;
          // Remove any existing number prefix from title for editing
          const titleWithoutNumber = section.title.replace(/^\d+\.\s*/, '');
          const displayTitle = section.section_type === 'header' 
            ? section.title 
            : `${index}. ${titleWithoutNumber}`;

          return (
          <div key={section.id} style={styles.sectionBuilderCard}>
            {/* Section Header */}
            <div style={styles.sectionBuilderHeader}>
              <input
                type="text"
                value={titleWithoutNumber}
                onChange={(e) => {
                  // Store title without number prefix
                  onUpdateSection(section.id, 'title', e.target.value);
                }}
                style={styles.sectionTitleInput}
                placeholder="Section Title"
              />
              {section.section_type !== 'header' && (
                <span style={{ marginLeft: '8px', color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  (Auto-numbered: {index})
                </span>
              )}

              <div style={styles.sectionHeaderActions}>
                <button
                  onClick={() => onMoveSection(section.id, 'up')}
                  disabled={index === 0}
                  style={{ ...styles.iconButton, opacity: index === 0 ? 0.3 : 1 }}
                >
                  <ChevronUp size={16} />
                </button>

                <button
                  onClick={() => onMoveSection(section.id, 'down')}
                  disabled={index === contractSections.length - 1}
                  style={{ ...styles.iconButton, opacity: index === contractSections.length - 1 ? 0.3 : 1 }}
                >
                  <ChevronDown size={16} />
                </button>

                <button
                  onClick={() => onDeleteSection(section.id)}
                  style={styles.deleteIconButton}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Section Content */}
            <textarea
              value={section.content}
              onChange={(e) => onUpdateSection(section.id, 'content', e.target.value)}
              style={styles.sectionContentTextarea}
              rows={4}
              placeholder="Enter section content..."
            />

            {/* Section Settings */}
            <div style={styles.sectionSettings}>
              <div style={styles.settingGroup}>
                <TavariCheckbox
                  checked={section.is_required}
                  onChange={(checked) => onUpdateSection(section.id, 'is_required', checked)}
                  label="Required Section"
                  size="sm"
                />
              </div>

              <div style={styles.settingGroup}>
                <label style={styles.formLabel}>Required For:</label>
                <select
                  value={section.required_for}
                  onChange={(e) => onUpdateSection(section.id, 'required_for', e.target.value)}
                  style={styles.formSelectSmall}
                >
                  <option value="none">None</option>
                  <option value="all">All Employees</option>
                  <option value="management">Management Only</option>
                  <option value="hourly">Hourly Workers</option>
                  <option value="salary">Salaried Employees</option>
                </select>
              </div>

              <button
                onClick={() => onAddSubsection(section.id)}
                style={styles.addSubsectionButton}
              >
                <Plus size={14} />
                Add Subsection
              </button>
            </div>

            {/* Subsections */}
            {section.subsections && section.subsections.length > 0 && (
              <div style={styles.subsectionsContainer}>
                {section.subsections.map((subsection, subIndex) => {
                  // Auto-number subsections based on section number and index
                  const subsectionNumber = section.section_type === 'header' ? null : index;
                  // Remove existing number prefix (like "2.1", "2.2", etc.)
                  const subTitleWithoutNumber = (subsection.title || '').replace(/^\d+\.\d+\.?\s*/, '');
                  const subDisplayTitle = subsectionNumber !== null 
                    ? `${index}.${subIndex + 1}. ${subTitleWithoutNumber}`
                    : subsection.title;

                  const subsectionKey = subsection.id
                    ? `${section.id}-${subsection.id}`
                    : `${section.id}-sub-${subIndex}`;

                  return (
                  <div key={subsectionKey} style={styles.subsectionCard}>
                    <div style={styles.subsectionHeader}>
                      <input
                        type="text"
                        value={subTitleWithoutNumber}
                        onChange={(e) => {
                          // Store title without number prefix
                          onUpdateSubsection(section.id, subsection.id, 'title', e.target.value);
                        }}
                        style={styles.subsectionTitleInput}
                        placeholder="Subsection Title"
                      />
                      {subsectionNumber !== null && (
                        <span style={{ marginLeft: '8px', color: '#6b7280', fontSize: '16px' }}>
                          (Auto-numbered: {index}.{subIndex + 1})
                        </span>
                      )}

                      <button
                        onClick={() => onDeleteSubsection(section.id, subsection.id)}
                        style={styles.deleteIconButtonSmall}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <textarea
                      value={subsection.content}
                      onChange={(e) => onUpdateSubsection(section.id, subsection.id, 'content', e.target.value)}
                      style={styles.subsectionContentTextarea}
                      rows={2}
                      placeholder="Enter subsection content..."
                    />

                    <div style={styles.subsectionSettings}>
                      <TavariCheckbox
                        checked={subsection.is_required}
                        onChange={(checked) => onUpdateSubsection(section.id, subsection.id, 'is_required', checked)}
                        label="Required"
                        size="sm"
                      />

                      <select
                        value={subsection.required_for}
                        onChange={(e) => onUpdateSubsection(section.id, subsection.id, 'required_for', e.target.value)}
                        style={styles.formSelectSmall}
                      >
                        <option value="none">None</option>
                        <option value="all">All</option>
                        <option value="management">Management</option>
                      </select>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}
      </div>

      {/* Save Template Button */}
      <div style={styles.builderFooter}>
        <button onClick={onSaveTemplate} style={styles.saveTemplateButton}>
          <Save size={18} />
          {selectedTemplateId ? 'Update Contract Template' : 'Save Contract Template'}
        </button>
      </div>
    </div>
  );
};

const getStatusStyle = (status) => {
  switch (status) {
    case 'draft': return { backgroundColor: '#f3f4f6', color: '#374151' };
    case 'pending': return { backgroundColor: '#fef3c7', color: '#d97706' };
    case 'signed': return { backgroundColor: '#d1fae5', color: '#059669' };
    case 'active': return { backgroundColor: '#dbeafe', color: '#1e40af' };
    case 'expired': return { backgroundColor: '#fee2e2', color: '#dc2626' };
    default: return { backgroundColor: '#f3f4f6', color: '#374151' };
  }
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '20px',
    paddingTop: '0px',
    boxSizing: 'border-box'
  },
  header: {
    marginBottom: '30px',
    textAlign: 'center'
  },
  tabContainer: {
    marginBottom: '30px',
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  tabList: {
    display: 'flex',
    borderBottom: '1px solid #e5e7eb'
  },
  tab: {
    flex: 1,
    padding: '16px',
    backgroundColor: '#f8f9fa',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    fontWeight: '600',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s',
    borderRight: '1px solid #e5e7eb'
  },
  tabActive: {
    backgroundColor: '#008080',
    color: 'white'
  },
  tabContent: {
    flex: 1,
    overflowY: 'auto',
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px'
  },
  controls: {
    display: 'flex',
    gap: '15px',
    marginBottom: '30px'
  },
  searchGroup: {
    position: 'relative',
    flex: 1
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#6b7280'
  },
  searchInput: {
    width: '100%',
    paddingLeft: '40px',
    padding: '12px',
    border: '2px solid #008080',
    borderRadius: '8px',
    fontSize: '14px',
    boxSizing: 'border-box'
  },
  filterGroup: {
    position: 'relative',
    minWidth: '200px'
  },
  filterIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#6b7280'
  },
  filterSelect: {
    width: '100%',
    paddingLeft: '40px',
    padding: '12px',
    border: '2px solid #008080',
    borderRadius: '8px',
    fontSize: '14px',
    backgroundColor: 'white',
    boxSizing: 'border-box'
  },
  contractGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '20px'
  },
  contractCard: {
    backgroundColor: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px'
  },
  contractHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
    paddingBottom: '15px',
    borderBottom: '1px solid #f3f4f6'
  },
  contractTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: 'bold',
    textTransform: 'uppercase'
  },
  contractBody: {
    marginBottom: '20px'
  },
  employeeInfo: {
    marginBottom: '15px'
  },
  employeeName: {
    fontSize: '15px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '4px'
  },
  employeeDetail: {
    fontSize: '13px',
    color: '#6b7280',
    marginBottom: '4px'
  },
  contractDates: {
    marginBottom: '15px'
  },
  dateRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    marginBottom: '4px'
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '16px',
    color: '#6b7280',
    padding: '8px',
    backgroundColor: '#f9fafb',
    borderRadius: '6px',
    marginBottom: '15px'
  },
  complianceInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '18px',
    padding: '8px',
    backgroundColor: '#f9fafb',
    borderRadius: '6px',
    border: '1px solid',
    marginBottom: '15px'
  },
  contractActions: {
    display: 'flex',
    gap: '8px'
  },
  actionButton: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '32px',
    fontWeight: '500'
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#6b7280'
  },
  templateSelector: {
    backgroundColor: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px'
  },
  builderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: '30px',
    gap: '20px'
  },
  builderMetadata: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: '20px',
    flex: 1
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  formLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px'
  },
  formInput: {
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '20px'
  },
  formSelect: {
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '18px',
    backgroundColor: 'white'
  },
  formSelectSmall: {
    padding: '6px 10px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '16px',
    backgroundColor: 'white'
  },
  addSectionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  sectionsBuilder: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    marginBottom: '30px'
  },
  sectionBuilderCard: {
    backgroundColor: '#f8f9fa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px'
  },
  sectionBuilderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    gap: '12px'
  },
  sectionTitleInput: {
    flex: 1,
    fontSize: '20px',
    fontWeight: 'bold',
    padding: '10px',
    border: '2px solid #008080',
    borderRadius: '6px'
  },
  sectionHeaderActions: {
    display: 'flex',
    gap: '8px'
  },
  iconButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
    backgroundColor: 'white',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#374151'
  },
  deleteIconButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#dc2626'
  },
  deleteIconButtonSmall: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#dc2626'
  },
  sectionContentTextarea: {
    width: '100%',
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    lineHeight: '1.6',
    resize: 'vertical',
    fontFamily: 'inherit',
    marginBottom: '12px',
    boxSizing: 'border-box'
  },
  sectionSettings: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    padding: '12px',
    backgroundColor: 'white',
    borderRadius: '6px',
    marginBottom: '12px'
  },
  settingGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer'
  },
  checkboxLabelSmall: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '16px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer'
  },
  addSubsectionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    marginLeft: 'auto'
  },
  subsectionsContainer: {
    marginTop: '12px',
    paddingLeft: '20px',
    borderLeft: '3px solid #008080',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  subsectionCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '12px'
  },
  subsectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    gap: '10px'
  },
  subsectionTitleInput: {
    flex: 1,
    fontSize: '16px',
    fontWeight: '600',
    padding: '8px',
    border: '1px solid #d1d5db',
    borderRadius: '4px'
  },
  subsectionContentTextarea: {
    width: '100%',
    padding: '10px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '18px',
    lineHeight: '1.5',
    resize: 'vertical',
    fontFamily: 'inherit',
    marginBottom: '8px',
    boxSizing: 'border-box'
  },
  subsectionSettings: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px'
  },
  builderFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    paddingTop: '20px',
    borderTop: '2px solid #e5e7eb'
  },
  saveTemplateButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 28px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '60px',
    fontSize: '14px',
    color: '#6b7280'
  }
};

// DASHBOARD STYLES
const dashboardStyles = {
  actionCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
    marginBottom: '40px'
  },
  actionCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    border: '2px solid #e5e7eb',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    transition: 'all 0.2s',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  cardIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardContent: {
    flex: 1
  },
  cardNumber: {
    fontSize: '26px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '4px'
  },
  cardLabel: {
    fontSize: '11px',
    color: '#6b7280'
  },
  stepsSection: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid #e5e7eb'
  },
  stepsTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    marginBottom: '20px',
    color: '#1f2937'
  },
  stepsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    backgroundColor: '#f9fafb'
  },
  stepCompleted: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac'
  },
  stepActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#3b82f6'
  },
  stepNumber: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#6b7280'
  },
  stepContent: {
    flex: 1
  },
  stepTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '4px'
  },
  stepBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    backgroundColor: '#fef3c7',
    color: '#d97706',
    fontSize: '9px',
    fontWeight: 'bold',
    borderRadius: '4px',
    marginTop: '4px'
  },
  stepContentArea: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    marginTop: '20px',
    border: '1px solid #e5e7eb'
  },
  stepContentTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#1f2937'
  },
  stepContentDescription: {
    fontSize: '11px',
    color: '#6b7280',
    marginBottom: '24px'
  },
  specialConsiderations: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  considerationItem: {
    padding: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  clauseTextarea: {
    width: '100%',
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '11px',
    fontFamily: 'inherit',
    resize: 'vertical'
  },
  stepActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px'
  },
  sendActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px'
  },
  backButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  },
  nextButton: {
    padding: '12px 24px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  },
  sendButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 24px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  }
};

// MODAL STYLES (for ContractsListModal)
const modalStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    borderBottom: '2px solid #e5e7eb',
    backgroundColor: '#f8f9fa'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px'
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px'
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280'
  },
  contractList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  contractItem: {
    padding: '16px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: '#e5e7eb',
    borderRadius: '8px',
    transition: 'all 0.2s',
    backgroundColor: '#ffffff',
    pointerEvents: 'auto',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px'
  },
  contractItemHover: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
    transform: 'translateY(-2px)',
    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.15)'
  },
  contractItemContent: {
    flex: 1,
    cursor: 'pointer',
    minWidth: 0
  },
  contractName: {
    fontSize: '14px',
    fontWeight: '600',
    marginBottom: '6px',
    color: '#111827'
  },
  contractDate: {
    fontSize: '11px',
    color: '#6b7280'
  },
  deleteButton: {
    background: 'none',
    border: '2px solid #ef4444',
    borderRadius: '6px',
    color: '#ef4444',
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0
  }
};

export default ContractManagement;