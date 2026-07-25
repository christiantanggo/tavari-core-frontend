import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs@2.4.3'

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

    // Verify requesting user is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) {
      throw new Error('Unauthorized')
    }

    // Check if user is manager/owner — resolve both auth and public.users ids
    let userRole = null;
    const membershipIds = new Set<string>([user.id]);

    const { data: publicUserRow } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', (user.email || '').trim())
      .maybeSingle();

    if (publicUserRow?.id) {
      membershipIds.add(publicUserRow.id);
    }

    const membershipIdList = [...membershipIds];
    console.log('Checking user role for:', { userId: user.id, userEmail: user.email, membershipIdList });
    
    const { data: userRolesData, error: userRoleError } = await supabaseAdmin
      .from('user_roles')
      .select('role, business_id')
      .in('user_id', membershipIdList)
      .in('role', ['manager', 'owner', 'admin'])
      .eq('active', true)

    console.log('user_roles query result:', { 
      count: userRolesData?.length || 0, 
      roles: userRolesData,
      error: userRoleError?.message 
    });

    if (userRolesData && userRolesData.length > 0) {
      userRole = userRolesData[0]; // Use first matching role
      console.log('Found role in user_roles:', userRole.role);
    } else {
      // Fallback to business_users table - get ALL roles
      const { data: businessUsersData, error: businessUserError } = await supabaseAdmin
        .from('business_users')
        .select('role, business_id')
        .in('user_id', membershipIdList)
        .in('role', ['manager', 'owner', 'admin'])

      console.log('business_users query result:', { 
        count: businessUsersData?.length || 0, 
        roles: businessUsersData,
        error: businessUserError?.message 
      });

      if (businessUsersData && businessUsersData.length > 0) {
        userRole = businessUsersData[0]; // Use first matching role
        console.log('Found role in business_users:', userRole.role);
      }
      
      // Log if there was an error checking business_users
      if (businessUserError) {
        console.warn('Error checking business_users table:', businessUserError);
      }
    }

    if (!userRole) {
      console.error('User role check failed - no manager/owner/admin role found:', { 
        userId: user.id, 
        userEmail: user.email,
        userRoleError: userRoleError?.message || null
      });
      throw new Error('Only managers and owners can reset passwords. Your account does not have the required permissions.')
    }
    
    console.log('User has required role:', userRole.role, 'in business:', userRole.business_id)

    const { employee_email, new_password } = await req.json()

    console.log('Password reset request for:', employee_email, 'by:', user.email)

    // Validation
    if (!employee_email) {
      throw new Error('Employee email is required')
    }

    if (!new_password || new_password.length < 6) {
      throw new Error('Password must be at least 6 characters')
    }

    // Find the target user's auth account.
    // IMPORTANT: listUsers() defaults to 50 users/page — never rely on a single page.
    const normalizedTargetEmail = String(employee_email || '').trim().toLowerCase()
    console.log('Looking up auth user for:', normalizedTargetEmail)

    let targetUser = null

    // Preferred path: public.users email → auth id (IDs usually match)
    const { data: publicEmployee } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .ilike('email', normalizedTargetEmail)
      .maybeSingle()

    if (publicEmployee?.id) {
      const { data: byIdData, error: byIdError } = await supabaseAdmin.auth.admin.getUserById(
        publicEmployee.id
      )
      if (!byIdError && byIdData?.user) {
        targetUser = byIdData.user
        console.log('Found auth user via public.users id:', targetUser.id)
      } else if (byIdError) {
        console.warn('getUserById failed, will fall back to listUsers:', byIdError.message)
      }
    }

    // Fallback: paginate all auth users and match email
    if (!targetUser) {
      let page = 1
      const perPage = 1000
      while (!targetUser) {
        const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        })

        if (listError) {
          console.error('Failed to list users:', listError)
          throw new Error('Could not look up employee auth account')
        }

        targetUser =
          authUsers?.users?.find(
            (u) => u.email?.toLowerCase() === normalizedTargetEmail
          ) || null

        if (targetUser) {
          console.log('Found auth user via paginated listUsers page', page, ':', targetUser.id)
          break
        }

        if (!authUsers?.users?.length || authUsers.users.length < perPage) {
          break
        }
        page++
      }
    }

    if (!targetUser) {
      console.error('Auth user not found for:', employee_email)
      throw new Error(`No auth account found for ${employee_email}. Use "Fix Auth" tool first.`)
    }

    console.log('Found target user:', targetUser.id)

    // Reset password
    console.log('Resetting password...')
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUser.id,
      { password: new_password }
    )

    if (updateError) {
      console.error('Password update failed:', updateError)
      throw new Error(`Password update failed: ${updateError.message}`)
    }

    // Keep public.users.hashed_password in sync (portal / legacy checks use this)
    try {
      const hashedPassword = await bcrypt.hash(new_password, 10)
      const publicIds = new Set<string>([targetUser.id])
      if (publicEmployee?.id) publicIds.add(publicEmployee.id)

      const { error: hashUpdateError } = await supabaseAdmin
        .from('users')
        .update({ hashed_password: hashedPassword })
        .in('id', [...publicIds])

      if (hashUpdateError) {
        console.warn('Auth password updated, but public hashed_password sync failed:', hashUpdateError)
      } else {
        console.log('Synced public.users.hashed_password for', [...publicIds])
      }
    } catch (hashError) {
      console.warn('Auth password updated, but hashing/sync failed:', hashError)
    }

    console.log('Password reset successful')

    // Log the action
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: targetUser.id,
        event_type: 'admin_password_reset',
        details: JSON.stringify({
          reset_for_email: employee_email,
          reset_by: user.id,
          reset_by_email: user.email,
          timestamp: new Date().toISOString()
        })
      })
    } catch (auditError) {
      console.warn('Audit logging failed:', auditError)
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Password reset successfully for ${employee_email}`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 200 
      }
    )

  } catch (error) {
    console.error('Password reset error:', error)
    const errorMessage = error.message || 'Password reset failed'
    const statusCode = error.message?.includes('Unauthorized') ? 401 : 
                      error.message?.includes('not found') ? 404 : 400
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        success: false
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: statusCode 
      }
    )
  }
})