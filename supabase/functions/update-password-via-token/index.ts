// Edge function to update password using custom reset token
// Uses Supabase Admin API to update auth.users password

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, newPassword, newPin, hashedPassword, hashedPin } = await req.json();

    if (!token || !newPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "Token and newPassword are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hashedPassword || !hashedPin) {
      return new Response(
        JSON.stringify({ success: false, error: "hashedPassword and hashedPin are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role (admin access)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Verify token
    const { data: tokenData, error: tokenError } = await supabaseAdmin.rpc(
      "verify_password_reset_token",
      { p_token: token }
    );

    if (tokenError || !tokenData || !tokenData.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: tokenData?.error || "Invalid or expired reset token",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = tokenData.user_id;
    const userEmail = tokenData.email;

    // Update password using Admin API
    const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateError) {
      console.error("Error updating password:", updateError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to update password: " + updateError.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update users table with hashed password and PIN (use email since IDs may differ)
    const { data: updateUserData, error: updateUserError } = await supabaseAdmin.rpc(
      "update_user_password_and_pin",
      {
        p_user_email: userEmail,
        p_hashed_password: hashedPassword,
        p_hashed_pin: hashedPin,
      }
    );

    if (updateUserError) {
      console.error("Error updating users table:", updateUserError);
      // Password was updated in auth, but users table update failed
      // Still mark token as used to prevent reuse
      await supabaseAdmin.rpc("mark_password_reset_token_used", {
        p_token: token,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: `Password updated, but failed to save PIN: ${updateUserError.message || JSON.stringify(updateUserError)}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!updateUserData?.success) {
      console.error("RPC returned success:false:", updateUserData);
      // Password was updated in auth, but users table update failed
      // Still mark token as used to prevent reuse
      await supabaseAdmin.rpc("mark_password_reset_token_used", {
        p_token: token,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: `Password updated, but failed to save PIN: ${updateUserData?.error || "Unknown error"}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark token as used
    await supabaseAdmin.rpc("mark_password_reset_token_used", {
      p_token: token,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Password and PIN updated successfully",
        user_id: userId,
        email: userEmail,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in update-password-via-token:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

