// utils/contractEmployeeCreation.js - Shared utility for creating employees from contracts
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';
import { findEmployeeForBusinessByEmail } from './contractPersistence';

const resolveContractManagerId = (keyTerms = {}) => {
  const raw = keyTerms.managerId || keyTerms.manager_id;
  return raw || null;
};

/**
 * Create or update employee profile from contract data
 * This function can be called from anywhere in the app
 */
export const createEmployeeFromContract = async (contractData) => {
  console.log('[CreateEmployee] ========== STARTING EMPLOYEE CREATION ==========');
  console.log('[CreateEmployee] Contract data received:', {
    id: contractData.id,
    employee_email: contractData.employee_email,
    employee_first_name: contractData.employee_first_name,
    employee_last_name: contractData.employee_last_name,
    employee_address: contractData.employee_address,
    position_title: contractData.position_title,
    business_id: contractData.business_id,
    has_contract_data: !!contractData.contract_data,
    contract_data_type: typeof contractData.contract_data
  });
  
  if (!contractData.business_id) {
    throw new Error('Contract missing business_id - cannot create employee');
  }
  
  const employeeEmail = (contractData.employee_email || '').trim().toLowerCase();
  if (!employeeEmail) {
    throw new Error('Contract missing employee_email - cannot create employee');
  }

  try {

    // Check if employee already exists (email is globally unique in public.users)
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, employment_status, status')
      .eq('email', employeeEmail)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existingUser) {
      console.log('[CreateEmployee] Global profile exists for email:', existingUser.id);

      const rosterMember = await findEmployeeForBusinessByEmail(
        contractData.business_id,
        employeeEmail
      );

      // Silo: never link or mutate a global profile from another business's contract
      if (!rosterMember || rosterMember.id !== existingUser.id) {
        console.log(
          '[CreateEmployee] Email not on this business roster — contract stays siloed (no cross-business link)'
        );
        return {
          success: true,
          employeeId: null,
          created: false,
          siloedCrossBusiness: true,
        };
      }
      
      // Check if employee is terminated or suspended - don't create portal access for these employees
      const empStatus = (existingUser.employment_status || '').toLowerCase();
      const userStatus = (existingUser.status || '').toLowerCase();
      const excludedStatuses = ['terminated', 'suspended'];
      if (excludedStatuses.includes(empStatus) || excludedStatuses.includes(userStatus)) {
        console.log(`[CreateEmployee] Employee is ${empStatus || userStatus} - skipping portal access creation`);
        // Still link to business and update data, but don't create portal access
        // Return success but without tempPassword
        return { 
          success: true, 
          employeeId: existingUser.id, 
          created: false,
          skippedPortalAccess: true // Flag to indicate portal access was skipped
        };
      }
      
      // Extract contract data for use in RPC calls
      const contractDataObj = contractData.contract_data || {};
      let keyTerms = {};
      
      if (contractDataObj) {
        if (typeof contractDataObj === 'string') {
          try {
            const parsed = JSON.parse(contractDataObj);
            keyTerms = parsed.keyTerms || {};
          } catch (e) {
            console.warn('[CreateEmployee] Failed to parse contract_data as JSON:', e);
          }
        } else {
          keyTerms = contractDataObj.keyTerms || {};
        }
      }

      const contractFirstName = contractData.employee_first_name || keyTerms.firstName || '';
      const contractLastName = contractData.employee_last_name || keyTerms.lastName || '';
      
      // Check if they're already linked to this business
      const { data: existingRole, error: roleCheckError } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', existingUser.id)
        .eq('business_id', contractData.business_id)
        .eq('active', true)
        .maybeSingle();

      if (roleCheckError && roleCheckError.code !== 'PGRST116') {
        throw roleCheckError;
      }

      if (existingRole) {
        console.log('[CreateEmployee] Employee already linked to business');
        // Still update user data and ensure business_users exists
        // Use RPC function to handle this safely
        const { data: updatedId, error: updateError } = await supabase.rpc(
          'create_employee_from_contract_rpc',
          {
            p_business_id: contractData.business_id,
            p_employee_email: existingUser.email,
            p_employee_first_name: contractFirstName,
            p_employee_last_name: contractLastName,
            p_employee_address: contractData.employee_address || keyTerms.employeeAddress || existingUser.address || null,
            p_position_title: contractData.position_title || keyTerms.positionTitle || existingUser.position || null,
            p_phone: (keyTerms.employeePhone || '').trim() || existingUser.phone || null,
            p_hire_date: keyTerms.contractStartDate || existingUser.hire_date || null,
            p_employment_status: keyTerms.employmentStatus || existingUser.employment_status || 'active',
            p_wage: keyTerms.baseHourlyWage ? parseFloat(keyTerms.baseHourlyWage) : existingUser.wage || null,
            p_vacation_percent: keyTerms.vacationPayRate ? (() => {
              const parsed = parseFloat(keyTerms.vacationPayRate.replace('%', '').trim());
              // Convert percentage to decimal (e.g., 4 -> 0.04, 4.0 -> 0.04)
              // If value is >= 1.0, assume it's a percentage and convert to decimal
              return parsed >= 1.0 ? parsed / 100 : parsed;
            })() : existingUser.vacation_percent || null,
            p_department: keyTerms.department || existingUser.department || null,
            p_manager_id: resolveContractManagerId(keyTerms)
          }
        );
        
        if (updateError) {
          console.warn('[CreateEmployee] Failed to update existing employee via RPC:', updateError);
        }
        
        // Check if portal access exists and create if needed
        let tempPassword = null;
        let authCreated = false;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
          const authToken = session?.access_token || supabaseAnonKey;
          
          if (supabaseUrl && authToken) {
            // Generate temporary password
            const generatedPassword = `TempPass${Math.random().toString(36).substring(2, 10)}!`;
            
            // Call Edge Function to create/update auth account
            const response = await fetch(
              `${supabaseUrl}/functions/v1/create-employee-auth`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${authToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  method: 'password',
                  employee_email: existingUser.email,
                  employee_id: existingUser.id,
                  first_name: contractFirstName || existingUser.first_name || '',
                  last_name: contractLastName || existingUser.last_name || '',
                  full_name: `${contractFirstName || existingUser.first_name || ''} ${contractLastName || existingUser.last_name || ''}`.trim(),
                  temporary_password: generatedPassword
                })
              }
            );
            
            const authResult = await response.json();
            
            if (response.ok) {
              // Check if this was a new auth account creation
              if (authResult.was_new_account) {
                authCreated = true;
                tempPassword = generatedPassword;
                console.log('[CreateEmployee] ✅ Portal access created for existing employee');
              } else {
                // Auth account already existed, just password was updated
                console.log('[CreateEmployee] Portal access already existed, password updated');
              }
            } else {
              console.warn('[CreateEmployee] Failed to create/update auth account:', authResult.error);
            }
          }
        } catch (authError) {
          console.warn('[CreateEmployee] Error creating portal access for existing employee:', authError);
          // Continue anyway - employee exists and is linked
        }
        
        return { 
          success: true, 
          employeeId: existingUser.id, 
          created: false,
          tempPassword: authCreated ? tempPassword : undefined // Only return password if auth was just created
        };
      }

      // Link existing user to business - use RPC function to bypass RLS
      const { data: linkedId, error: linkError } = await supabase.rpc(
        'create_employee_from_contract_rpc',
        {
          p_business_id: contractData.business_id,
          p_employee_email: existingUser.email,
          p_employee_first_name: contractFirstName,
          p_employee_last_name: contractLastName,
          p_employee_address: contractData.employee_address || keyTerms.employeeAddress || existingUser.address || null,
          p_position_title: contractData.position_title || keyTerms.positionTitle || existingUser.position || null,
          p_phone: (keyTerms.employeePhone || '').trim() || existingUser.phone || null,
          p_hire_date: keyTerms.contractStartDate || existingUser.hire_date || null,
          p_employment_status: keyTerms.employmentStatus || existingUser.employment_status || 'active',
          p_wage: keyTerms.baseHourlyWage ? parseFloat(keyTerms.baseHourlyWage) : existingUser.wage || null,
          p_vacation_percent: keyTerms.vacationPayRate ? (() => {
            const parsed = parseFloat(keyTerms.vacationPayRate.replace('%', '').trim());
            // Convert percentage to decimal (e.g., 4 -> 0.04, 4.0 -> 0.04)
            // If value is >= 1.0, assume it's a percentage and convert to decimal
            return parsed >= 1.0 ? parsed / 100 : parsed;
          })() : existingUser.vacation_percent || null,
          p_department: keyTerms.department || existingUser.department || null,
          p_manager_id: resolveContractManagerId(keyTerms)
        }
      );

      if (linkError) throw linkError;

      console.log('[CreateEmployee] Linked existing employee to business via RPC (user updated and business_users created)');
      
      // Check if portal access exists and create if needed
      let tempPassword = null;
      let authCreated = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const authToken = session?.access_token || supabaseAnonKey;
        
        if (supabaseUrl && authToken) {
          // Generate temporary password
          const generatedPassword = `TempPass${Math.random().toString(36).substring(2, 10)}!`;
          
          // Call Edge Function to create/update auth account
          const response = await fetch(
            `${supabaseUrl}/functions/v1/create-employee-auth`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                method: 'password',
                employee_email: existingUser.email,
                employee_id: existingUser.id,
                first_name: contractFirstName || existingUser.first_name || '',
                last_name: contractLastName || existingUser.last_name || '',
                full_name: `${contractFirstName || existingUser.first_name || ''} ${contractLastName || existingUser.last_name || ''}`.trim(),
                temporary_password: generatedPassword
              })
            }
          );
          
          const authResult = await response.json();
          
          if (response.ok) {
            // Check if this was a new auth account creation
            if (authResult.was_new_account) {
              authCreated = true;
              tempPassword = generatedPassword;
              console.log('[CreateEmployee] ✅ Portal access created for existing employee');
            } else {
              // Auth account already existed, just password was updated
              console.log('[CreateEmployee] Portal access already existed, password updated');
            }
          } else {
            console.warn('[CreateEmployee] Failed to create/update auth account:', authResult.error);
          }
        }
      } catch (authError) {
        console.warn('[CreateEmployee] Error creating portal access for existing employee:', authError);
        // Continue anyway - employee exists and is linked
      }
      
      return { 
        success: true, 
        employeeId: existingUser.id, 
        created: false,
        tempPassword: authCreated ? tempPassword : undefined // Only return password if auth was just created
      };
    }

    // Extract contract data
    let contractDataObj = {};
    let keyTerms = {};
    
    // Handle contract_data if it's a string (JSON) or object
    if (contractData.contract_data) {
      if (typeof contractData.contract_data === 'string') {
        try {
          contractDataObj = JSON.parse(contractData.contract_data);
        } catch (e) {
          console.warn('[CreateEmployee] Failed to parse contract_data as JSON:', e);
        }
      } else {
        contractDataObj = contractData.contract_data;
      }
      keyTerms = contractDataObj.keyTerms || {};
    }
    
    console.log('[CreateEmployee] Extracted keyTerms:', {
      firstName: keyTerms.firstName,
      lastName: keyTerms.lastName,
      email: keyTerms.employeeEmail,
      phone: keyTerms.employeePhone,
      address: keyTerms.employeeAddress,
      position: keyTerms.positionTitle,
      wage: keyTerms.baseHourlyWage
    });

    // Create new user - prioritize contract fields, then keyTerms, then empty string
    const firstName = contractData.employee_first_name || keyTerms.firstName || '';
    const lastName = contractData.employee_last_name || keyTerms.lastName || '';
    const email = employeeEmail || keyTerms.employeeEmail || '';
    const fullName = `${firstName} ${lastName}`.trim();

    console.log('[CreateEmployee] Employee data to create:', {
      firstName,
      lastName,
      email,
      fullName,
      hasEmail: !!email,
      hasFirstName: !!firstName,
      hasLastName: !!lastName
    });

    const phone = (keyTerms.employeePhone || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');

    if (!email || !firstName || !lastName || phoneDigits.length < 10) {
      const missing = [];
      if (!email) missing.push('email');
      if (!firstName) missing.push('first name');
      if (!lastName) missing.push('last name');
      if (phoneDigits.length < 10) missing.push('phone number');
      throw new Error(`Missing required employee information: ${missing.join(', ')}`);
    }

    // Extract address from contract
    const address = contractData.employee_address || keyTerms.employeeAddress || null;
    
    // CRITICAL: Create auth account FIRST with temporary password, then use that ID for public.users
    // This ensures public.users.id == auth.users.id from the start
    console.log('[CreateEmployee] ========== CREATING AUTH ACCOUNT WITH TEMP PASSWORD ==========');
    
    const { data: { session } } = await supabase.auth.getSession();
    
    // Generate temporary password (similar to PayrollImportProcessor)
    const tempPassword = `TempPass${Math.random().toString(36).substring(2, 10)}!`;
    console.log('[CreateEmployee] Generated temporary password');
    
    // Call edge function to create auth account with password
    // Use 'password' method - creates account with password directly (no invite email)
    // Use direct fetch for better error handling
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl) {
      throw new Error('VITE_SUPABASE_URL environment variable is not set');
    }
    if (!supabaseAnonKey) {
      throw new Error('VITE_SUPABASE_ANON_KEY environment variable is not set');
    }
    
    // Use session token if available, otherwise use anon key (for public contract signing)
    const authToken = session?.access_token || supabaseAnonKey;
    const isAnonCall = !session;
    
    // Extract contract_id and business_id - check multiple possible locations
    const contractId = contractData.id || contractData.contract_id || contractData.contractId;
    const businessId = contractData.business_id || contractData.businessId;
    
    console.log('[CreateEmployee] Calling Edge Function:', {
      hasSession: !!session,
      isAnonCall,
      employee_email: email,
      contract_id: contractId,
      business_id: businessId,
      contractData_keys: Object.keys(contractData)
    });
    
    // Build request body
    const requestBody = {
      method: 'password', // Create account with password directly
      employee_email: email,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim(),
      temporary_password: tempPassword
    };
    
    // Only include public call fields if this is an anon call AND we have the required IDs
    if (isAnonCall) {
      if (!contractId || !businessId) {
        console.warn('[CreateEmployee] Anon call but missing contract_id or business_id:', {
          contract_id: contractId,
          business_id: businessId,
          contractData: contractData
        });
        // For anon calls without contract info, we can't validate, so skip the public call validation
        // The Edge Function will handle this case
      } else {
        requestBody.is_public_call = true;
        requestBody.contract_id = contractId;
        requestBody.business_id = businessId;
      }
    }
    
    const response = await fetch(
      `${supabaseUrl}/functions/v1/create-employee-auth`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );
    
    const authResult = await response.json();
    
    if (!response.ok) {
      console.error('[CreateEmployee] Failed to create auth account. Status:', response.status);
      console.error('[CreateEmployee] Error response:', authResult);
      
      // Extract detailed error message from response
      const errorMessage = authResult.error || authResult.details || 'Unknown error occurred';
      const errorCode = authResult.code || '';
      const errorName = authResult.name || '';
      
      let fullErrorMessage = `Failed to create auth account: ${errorMessage}`;
      if (errorCode) fullErrorMessage += ` (Code: ${errorCode})`;
      if (errorName) fullErrorMessage += ` (Type: ${errorName})`;
      
      throw new Error(fullErrorMessage);
    }
    
    console.log('[CreateEmployee] Auth result:', JSON.stringify(authResult, null, 2));
    
    if (!authResult?.user?.id) {
      console.error('[CreateEmployee] Auth account creation returned no user ID');
      console.error('[CreateEmployee] Full auth result:', authResult);
      throw new Error('Auth account creation failed - no user ID returned. Result: ' + JSON.stringify(authResult));
    }
    
    const authUserId = authResult.user.id;
    console.log('[CreateEmployee] ✅ Auth account created with ID:', authUserId);
    
    // Now create public.users record using the auth.users.id via RPC (bypasses RLS)
    console.log('[CreateEmployee] ========== CREATING PUBLIC.USERS WITH AUTH ID ==========');
    
    const { data: employeeId, error: rpcError } = await supabase.rpc(
      'create_employee_from_contract_rpc',
      {
        p_business_id: contractData.business_id,
        p_employee_email: email,
        p_employee_first_name: firstName,
        p_employee_last_name: lastName,
        p_employee_address: address || null,
        p_position_title: contractData.position_title || keyTerms.positionTitle || null,
        p_phone: phone || null,
        p_hire_date: keyTerms.contractStartDate || null,
        p_employment_status: keyTerms.employmentStatus || 'active',
        p_wage: keyTerms.baseHourlyWage ? parseFloat(keyTerms.baseHourlyWage) : null,
        p_vacation_percent: keyTerms.vacationPayRate ? (() => {
          const parsed = parseFloat(keyTerms.vacationPayRate.replace('%', '').trim());
          // Convert percentage to decimal (e.g., 4 -> 0.04, 4.0 -> 0.04)
          // If value is >= 1.0, assume it's a percentage and convert to decimal
          return parsed >= 1.0 ? parsed / 100 : parsed;
        })() : null,
        p_department: keyTerms.department || null,
        p_manager_id: resolveContractManagerId(keyTerms),
        p_user_id: authUserId  // Pass auth.users.id so public.users.id matches!
      }
    );
    
    if (rpcError) {
      console.error('[CreateEmployee] Failed to create public.users record via RPC:', rpcError);
      console.error('[CreateEmployee] WARNING: Auth account created but public.users creation failed. Auth account ID:', authUserId);
      throw new Error('Failed to create user record: ' + rpcError.message);
    }
    
    if (!employeeId) {
      console.error('[CreateEmployee] RPC returned no employeeId');
      throw new Error('Employee creation failed - no ID returned');
    }
    
    console.log('[CreateEmployee] ✅ public.users created with ID:', employeeId);
    console.log('[CreateEmployee] ✅ Auth account ID matches public.users.id:', employeeId === authUserId ? 'YES' : 'NO');
    console.log('[CreateEmployee] ✅ Employee profile created and linked to business successfully');
    console.log('[CreateEmployee] ========== EMPLOYEE CREATION SUCCESS ==========');
    // NOTE: tempPassword is returned, but should only be used/sent when contract is signed
    // When contract is sent, don't send password email - wait until contract is signed
    return { success: true, employeeId, created: true, tempPassword };
  } catch (error) {
    console.error('[CreateEmployee] ========== EMPLOYEE CREATION FAILED ==========');
    console.error('[CreateEmployee] Error creating employee profile:', error);
    console.error('[CreateEmployee] Error details:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      stack: error.stack
    });
    console.error('[CreateEmployee] Contract data at error:', {
      id: contractData.id,
      business_id: contractData.business_id,
      employee_email: contractData.employee_email,
      has_contract_data: !!contractData.contract_data
    });
    console.error('[CreateEmployee] ========== END ERROR LOG ==========');
    throw error;
  }
};



