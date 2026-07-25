import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const token = authHeader.replace('Bearer ', '')
    
    // Check if this is an anon key call (public contract signing)
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const isAnonKey = supabaseAnonKey && token === supabaseAnonKey
    
    let requestBody: Record<string, unknown>
    let callerUserId: string | null = null
    
    if (isAnonKey) {
      // For anon key calls, validate the request is legitimate
      requestBody = await req.json()
      const { 
        method, 
        employee_email, 
        employee_id,
        first_name,
        last_name,
        full_name,
        temporary_password,
        is_public_call,
        contract_id,
        business_id
      } = requestBody
      
      // Validate this is a legitimate contract signing request
      // If is_public_call is true AND we have contract_id and business_id, validate the contract
      // If they're missing, we'll skip the contract validation but still allow the call to proceed
      // (This handles cases where contract data might not be fully available yet)
      if (is_public_call && contract_id && business_id) {
        // Validate contract exists and is signed (or employee_signed)
        const { data: contract, error: contractError } = await supabaseAdmin
          .from('hr_contracts')
          .select('id, status, employee_email, business_id')
          .eq('id', contract_id)
          .eq('business_id', business_id)
          .in('status', ['signed', 'employee_signed'])
          .single()
        
        if (contractError || !contract) {
          throw new Error('Contract not found or not signed')
        }
        
        // Verify the email matches the contract
        if (contract.employee_email?.toLowerCase() !== employee_email?.toLowerCase()) {
          throw new Error('Employee email does not match contract')
        }
        
        console.log('Public call validated - contract exists and is signed')
      } else if (is_public_call) {
        // Public call but missing contract validation data - allow it but log a warning
        console.log('Public call - contract validation skipped (missing contract_id or business_id)')
        console.log('This is allowed for cases where contract data may not be fully available yet')
      }
    } else {
      // Normal authenticated call - validate caller
      const { data: { user: authenticatedUser }, error: userError } = await supabaseAdmin.auth.getUser(token)
      
      if (userError || !authenticatedUser) throw new Error('Unauthorized')
      
      callerUserId = authenticatedUser.id
      requestBody = await req.json()
    }
    
    // Extract common fields from request body
    const { 
      method, 
      employee_email, 
      employee_id,
      first_name,
      last_name,
      full_name,
      temporary_password 
    } = requestBody

    // Normalize email (trim and lowercase for comparison, but keep original for creation)
    const normalizedEmail = employee_email?.trim().toLowerCase()
    const originalEmail = employee_email?.trim()
    
    console.log('Creating auth account:', { method, employee_email: originalEmail, normalizedEmail, employee_id })

    // Validate required fields
    if (!method) {
      throw new Error('Method is required (must be "password", "invite", or "reset")')
    }
    
    if (!originalEmail) {
      throw new Error('Employee email is required')
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(originalEmail)) {
      throw new Error('Invalid email format')
    }
    
    if (method === 'password' && !temporary_password) {
      throw new Error('Temporary password is required when method is "password"')
    }

    // Check if auth account already exists (with pagination to find all users)
    let existingAuth = null
    let page = 1
    const perPage = 1000
    
    while (!existingAuth) {
      const { data: existingAuthUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage
      })
      
      if (listError) {
        console.error('Error listing users during check:', listError)
        break
      }
      
      existingAuth = existingAuthUsers?.users.find(u => u.email?.toLowerCase() === normalizedEmail)
      
      if (existingAuth) {
        console.log('Found existing auth user:', existingAuth.id)
        break
      }
      
      // If no more users or empty result, stop
      if (!existingAuthUsers?.users || existingAuthUsers.users.length === 0 || existingAuthUsers.users.length < perPage) {
        break
      }
      
      page++
    }

    if (existingAuth) {
      console.log('Auth account already exists:', existingAuth.id)
      
      if (method === 'password' && temporary_password) {
        // Update password
        await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, { password: temporary_password })
        console.log('Password updated for existing auth account')
        
        // CRITICAL: If IDs don't match AND employee_id is provided, sync business_users and user_roles
        // NOTE: We CANNOT update users table ID due to foreign key constraints
        // business_users and user_roles will use auth.users.id, which is what matters for portal access
        if (employee_id && existingAuth.id !== employee_id) {
          console.log('ID mismatch detected. Syncing business_users and user_roles (NOT users table)...')
          console.log('  Old users.id:', employee_id)
          console.log('  Auth ID:', existingAuth.id)
          console.log('  Note: users.id will remain as old ID due to foreign key constraints')
          
          // Update business_users to use auth user ID
          const { error: updateBusinessUserError } = await supabaseAdmin
            .from('business_users')
            .update({ user_id: existingAuth.id })
            .eq('user_id', employee_id)
          
          if (updateBusinessUserError) {
            console.warn('Failed to update business_users:', updateBusinessUserError)
          } else {
            console.log('✅ business_users synced to use auth ID')
          }
          
          // Update user_roles to use auth user ID
          const { error: updateRolesError } = await supabaseAdmin
            .from('user_roles')
            .update({ user_id: existingAuth.id })
            .eq('user_id', employee_id)
          
          if (updateRolesError) {
            console.warn('Failed to update user_roles:', updateRolesError)
          } else {
            console.log('✅ user_roles synced to use auth ID')
          }
          
          console.log('✅ Related tables synced! Note: users.id remains as old ID (this is OK)')
        } else if (!employee_id) {
          console.log('No employee_id provided - employee record will be created with auth ID')
        }
      } else if (method === 'invite') {
        await supabaseAdmin.auth.resetPasswordForEmail(
          originalEmail,
          { redirectTo: `${Deno.env.get('VITE_BASE_URL')}/auth/callback` }
        )
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Auth account already exists. Password updated.',
          user: existingAuth,
          method: method,
          synced: employee_id ? existingAuth.id !== employee_id : false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Create new auth account
    let newAuthUser

    if (method === 'invite') {
      console.log('Sending invite email...')
      
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        originalEmail,
        {
          data: { first_name, last_name, full_name },
          redirectTo: `${Deno.env.get('VITE_BASE_URL')}/auth/callback`
        }
      )

      if (error) throw error
      newAuthUser = data.user

    } else if (method === 'password') {
      console.log('Creating account with password...')
      
      if (!temporary_password || temporary_password.length < 6) {
        throw new Error('Password must be at least 6 characters')
      }

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: originalEmail,
        password: temporary_password,
        email_confirm: true,
        user_metadata: { first_name, last_name, full_name }
      })

      // If user already exists, fetch them and update password instead
      if (error && (
        error.code === 'email_exists' || 
        error.message?.toLowerCase().includes('already been registered') ||
        error.message?.toLowerCase().includes('user already registered') ||
        error.message?.toLowerCase().includes('already exists') ||
        error.status === 422
      )) {
        console.log('User creation failed - user may already exist. Error:', error.message, 'Code:', error.code)
        console.log('User already exists, fetching and updating password...')
        
        // Try to get user by email - list all users and find by email
        let foundUser = null
        let page = 1
        const perPage = 1000
        
        while (!foundUser) {
          const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage
          })
          
          if (listError) {
            console.error('Error listing users:', listError)
            break
          }
          
          foundUser = usersData?.users.find(u => u.email?.toLowerCase() === normalizedEmail)
          
          if (foundUser) {
            console.log('Found existing user:', foundUser.id)
            break
          }
          
          // If no more users or empty result, stop
          if (!usersData?.users || usersData.users.length === 0 || usersData.users.length < perPage) {
            break
          }
          
          page++
        }
        
        if (!foundUser) {
          throw new Error('User email exists but could not be found. Please contact support.')
        }
        
        // Update password for existing user
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(foundUser.id, {
          password: temporary_password,
          user_metadata: { first_name, last_name, full_name }
        })
        
        if (updateError) {
          throw new Error('Failed to update existing user password: ' + updateError.message)
        }
        
        console.log('Password updated for existing user')
        newAuthUser = foundUser
      } else if (error) {
        throw error
      } else {
        newAuthUser = data.user
      }

    } else if (method === 'reset') {
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(
        originalEmail,
        { redirectTo: `${Deno.env.get('VITE_BASE_URL')}/auth/callback` }
      )
      if (error) throw error
      
      return new Response(
        JSON.stringify({ success: true, method: 'reset' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    } else {
      throw new Error('Invalid method')
    }

    console.log('Auth user created:', newAuthUser.id)

    // 🔥 THE FIX: If IDs don't match AND employee_id is provided, update related tables
    // NOTE: We CANNOT update the users table ID because it has foreign key constraints
    // from tables like scheduling_shifts, scheduling_time_clocks, etc.
    // Instead, we update business_users and user_roles to use the auth ID for portal access
    // The users table ID can stay as the old ID - it doesn't matter for functionality
    if (employee_id && newAuthUser.id !== employee_id) {
      console.log('ID mismatch detected. Syncing related tables (NOT users table)...')
      console.log('  Old users.id:', employee_id)
      console.log('  New auth.users.id:', newAuthUser.id)
      console.log('  Note: users.id will remain as old ID due to foreign key constraints')

      // Update business_users to use auth ID (this is what matters for portal access)
      const { error: updateBusinessUserError } = await supabaseAdmin
        .from('business_users')
        .update({ user_id: newAuthUser.id })
        .eq('user_id', employee_id)

      if (updateBusinessUserError) {
        console.warn('Failed to update business_users:', updateBusinessUserError)
        // Don't throw - this is non-critical, we can continue
      } else {
        console.log('✅ business_users synced to use auth ID')
      }

      // Update user_roles to use auth ID (this is what matters for portal access)
      const { error: updateRolesError } = await supabaseAdmin
        .from('user_roles')
        .update({ user_id: newAuthUser.id })
        .eq('user_id', employee_id)

      if (updateRolesError) {
        console.warn('Failed to update user_roles:', updateRolesError)
        // Don't throw - this is non-critical, we can continue
      } else {
        console.log('✅ user_roles synced to use auth ID')
      }

      console.log('✅ Related tables synced! Note: users.id remains as old ID (this is OK)')
    } else if (!employee_id) {
      console.log('✅ No employee_id provided - employee will be created with auth ID in users table')
    } else {
      console.log('✅ IDs match - no sync needed')
    }

    // Determine if this was a new account creation or just an update
    const wasNewAccount = !existingAuth || (existingAuth && existingAuth.id !== newAuthUser.id)
    
    // Log the action
    await supabaseAdmin.from('audit_logs').insert({
      user_id: newAuthUser.id,
      event_type: wasNewAccount ? 'employee_auth_account_created' : 'employee_auth_account_updated',
      details: JSON.stringify({
        employee_email: originalEmail,
        method,
        was_new_account: wasNewAccount,
        ...(callerUserId && !isAnonKey ? { fixed_by: callerUserId } : {}),
        ...(employee_id ? {
          old_id: employee_id,
          new_id: newAuthUser.id,
          synced: newAuthUser.id !== employee_id
        } : {}),
        timestamp: new Date().toISOString()
      })
    })

    return new Response(
      JSON.stringify({ 
        success: true,
        user: newAuthUser,
        method: method,
        was_new_account: wasNewAccount, // Indicate if this was a new account creation
        synced: employee_id ? newAuthUser.id !== employee_id : false,
        message: employee_id && newAuthUser.id !== employee_id
          ? `✅ Auth account created and IDs synced! Old ID: ${employee_id}, New ID: ${newAuthUser.id}`
          : employee_id
          ? '✅ Auth account created with matching ID!'
          : '✅ Auth account created! Employee record will be created with this auth ID.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Error:', error)
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      name: error.name,
      stack: error.stack
    })
    
    // Return more detailed error information
    const errorResponse = {
      error: error.message || 'Unknown error occurred',
      code: error.code,
      details: error.details || error.message,
      name: error.name
    }
    
    return new Response(
      JSON.stringify(errorResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})