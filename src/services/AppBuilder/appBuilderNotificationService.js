// Step 60: Create appBuilderNotificationService.js
// Service for notifications (build/deployment status, trial expiring)
// Uses Tavari Mail service for notifications

import { supabase } from '../../supabaseClient';

class AppBuilderNotificationService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Notify build complete
  async notifyBuildComplete(buildId, userId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get build info
    const { data: build } = await supabase
      .from('app_builds')
      .select('app_version, platform, build_status')
      .eq('id', buildId)
      .single();

    if (!build) {
      throw new Error('Build not found');
    }

    // Get user email
    const { data: user } = await supabase.auth.admin.getUserById(userId);
    const userEmail = user?.user?.email;

    if (!userEmail) {
      console.warn('Cannot send notification: user email not found');
      return;
    }

    // Create mail campaign or send notification
    // This would integrate with Tavari Mail service
    // For now, we'll log it (actual mail integration can be added later)
    console.log('Build complete notification:', {
      to: userEmail,
      subject: `Build ${build.app_version} (${build.platform}) completed`,
      message: `Your app build for ${build.platform} has completed with status: ${build.build_status}`
    });

    // TODO: Integrate with Tavari Mail service to send actual email
    // await mailService.sendEmail({
    //   to: userEmail,
    //   subject: `Build ${build.app_version} completed`,
    //   template: 'build_complete',
    //   data: { build }
    // });
  }

  // Notify deployment status
  async notifyDeploymentStatus(deploymentId, userId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: deployment } = await supabase
      .from('app_deployments')
      .select('status, deployment_type, build:app_builds(app_version, platform)')
      .eq('id', deploymentId)
      .single();

    if (!deployment) {
      throw new Error('Deployment not found');
    }

    const { data: user } = await supabase.auth.admin.getUserById(userId);
    const userEmail = user?.user?.email;

    if (userEmail) {
      console.log('Deployment status notification:', {
        to: userEmail,
        subject: `Deployment to ${deployment.deployment_type} - ${deployment.status}`,
        message: `Your app deployment to ${deployment.deployment_type} is now ${deployment.status}`
      });

      // TODO: Integrate with Tavari Mail service
    }
  }

  // Notify build failed
  async notifyBuildFailed(buildId, userId, errorMessage) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: build } = await supabase
      .from('app_builds')
      .select('app_version, platform')
      .eq('id', buildId)
      .single();

    const { data: user } = await supabase.auth.admin.getUserById(userId);
    const userEmail = user?.user?.email;

    if (userEmail) {
      console.log('Build failed notification:', {
        to: userEmail,
        subject: `Build ${build?.app_version} failed`,
        message: `Your app build failed: ${errorMessage}`
      });

      // TODO: Integrate with Tavari Mail service
    }
  }

  // Notify trial expiring
  async notifyTrialExpiring(moduleKey, userId, daysRemaining) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: module } = await supabase
      .from('app_modules')
      .select('module_name')
      .eq('module_key', moduleKey)
      .single();

    const { data: user } = await supabase.auth.admin.getUserById(userId);
    const userEmail = user?.user?.email;

    if (userEmail) {
      console.log('Trial expiring notification:', {
        to: userEmail,
        subject: `Trial expiring for ${module?.module_name || moduleKey}`,
        message: `Your trial for ${module?.module_name || moduleKey} expires in ${daysRemaining} days`
      });

      // TODO: Integrate with Tavari Mail service
    }
  }
}

export default new AppBuilderNotificationService();




