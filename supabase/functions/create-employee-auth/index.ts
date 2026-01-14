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
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) throw new Error('Unauthorized')

    const { 
      method, 
      employee_email, 
      employee_id,
      first_name,
      last_name,
      full_name,
      temporary_password 
    } = await req.json()

    console.log('Creating auth account:', { method, employee_email, employee_id })

    // Check if auth account already exists
    const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingAuth = existingAuthUsers?.users.find(u => u.email?.toLowerCase() === employee_email?.toLowerCase())

    if (existingAuth) {
      console.log('Auth account already exists:', existingAuth.id)
      
      if (method === 'password' && temporary_password) {
        // Update password
        await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, { password: temporary_password })
        console.log('Password updated for existing auth account')
        
        // CRITICAL: If IDs don't match AND employee_id is provided, sync business_users and user_roles
        if (employee_id && existingAuth.id !== employee_id) {
          console.log('ID mismatch detected. Syncing business_users and user_roles...')
          console.log('  Old ID:', employee_id)
          console.log('  Auth ID:', existingAuth.id)
          
          // Update business_users to use auth user ID
          const { error: updateBusinessUserError } = await supabaseAdmin
            .from('business_users')
            .update({ user_id: existingAuth.id })
            .eq('user_id', employee_id)
          
          if (updateBusinessUserError) {
            console.warn('Failed to update business_users:', updateBusinessUserError)
          } else {
            console.log('✅ business_users synced')
          }
          
          // Update user_roles to use auth user ID
          const { error: updateRolesError } = await supabaseAdmin
            .from('user_roles')
            .update({ user_id: existingAuth.id })
            .eq('user_id', employee_id)
          
          if (updateRolesError) {
            console.warn('Failed to update user_roles:', updateRolesError)
          } else {
            console.log('✅ user_roles synced')
          }
          
          // NOTE: Cannot update users table ID (primary key) - that's okay
          // business_users and user_roles will use auth.users.id, which is what matters for portal access
        } else if (!employee_id) {
          console.log('No employee_id provided - employee record will be created with auth ID')
        }
      } else if (method === 'invite') {
        await supabaseAdmin.auth.resetPasswordForEmail(
          employee_email,
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
        employee_email,
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
        email: employee_email,
        password: temporary_password,
        email_confirm: true,
        user_metadata: { first_name, last_name, full_name }
      })

      // If user already exists, fetch them and update password instead
      if (error && (error.code === 'email_exists' || error.message?.includes('already been registered'))) {
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
          
          foundUser = usersData?.users.find(u => u.email?.toLowerCase() === employee_email?.toLowerCase())
          
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
        employee_email,
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

    // 🔥 THE FIX: If IDs don't match AND employee_id is provided, UPDATE the users table and related tables
    // Note: When creating from contract, employee_id may be undefined (employee doesn't exist yet)
    if (employee_id && newAuthUser.id !== employee_id) {
      console.log('ID mismatch detected. Syncing users table...')
      console.log('  Old ID:', employee_id)
      console.log('  New ID:', newAuthUser.id)

      // Check if new auth ID already exists in users table
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', newAuthUser.id)
        .single()

      if (existingUser) {
        throw new Error(`Auth ID ${newAuthUser.id} already exists in users table. Manual cleanup required.`)
      }

      // Update users table
      const { error: updateUserError } = await supabaseAdmin
        .from('users')
        .update({ id: newAuthUser.id })
        .eq('id', employee_id)

      if (updateUserError) {
        console.error('Failed to update users table:', updateUserError)
        throw new Error('Auth account created but failed to sync users table: ' + updateUserError.message)
      }

      // Update business_users
      const { error: updateBusinessUserError } = await supabaseAdmin
        .from('business_users')
        .update({ user_id: newAuthUser.id })
        .eq('user_id', employee_id)

      if (updateBusinessUserError) {
        console.warn('Failed to update business_users:', updateBusinessUserError)
      }

      // Update user_roles
      const { error: updateRolesError } = await supabaseAdmin
        .from('user_roles')
        .update({ user_id: newAuthUser.id })
        .eq('user_id', employee_id)

      if (updateRolesError) {
        console.warn('Failed to update user_roles:', updateRolesError)
      }

      console.log('✅ Users table synced successfully!')
    } else if (!employee_id) {
      console.log('✅ No employee_id provided - employee will be created with auth ID in users table')
    } else {
      console.log('✅ IDs match - no sync needed')
    }

    // Log the action
    await supabaseAdmin.from('audit_logs').insert({
      user_id: newAuthUser.id,
      event_type: 'employee_auth_account_created',
      details: JSON.stringify({
        employee_email,
        method,
        fixed_by: user.id,
        old_id: employee_id,
        new_id: newAuthUser.id,
        synced: employee_id ? newAuthUser.id !== employee_id : false,
        timestamp: new Date().toISOString()
      })
    })

    return new Response(
      JSON.stringify({ 
        success: true,
        user: newAuthUser,
        method: method,
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
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})