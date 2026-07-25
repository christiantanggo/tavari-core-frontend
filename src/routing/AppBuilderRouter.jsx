// Step 122: Create AppBuilderRouter.jsx
// Centralized router for AppBuilder routes with license checks
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import AppBuilderDashboard from '../screens/AppBuilder/AppBuilderDashboard';
import AppBuilderBrandingScreen from '../screens/AppBuilder/AppBuilderBrandingScreen';
import AppBuilderModuleManagementScreen from '../screens/AppBuilder/AppBuilderModuleManagementScreen';
import AppBuilderBuildScreen from '../screens/AppBuilder/AppBuilderBuildScreen';
import AppBuilderDeploymentScreen from '../screens/AppBuilder/AppBuilderDeploymentScreen';
import AppBuilderAnalyticsScreen from '../screens/AppBuilder/AppBuilderAnalyticsScreen';
import AppBuilderModuleLicenseGuard from '../components/AppBuilder/AppBuilderModuleLicenseGuard';

const AppBuilderRouter = () => {
  return (
    <Routes>
      <Route path="appbuilder" element={<AppBuilderDashboard />} />
      <Route path="appbuilder/branding" element={<AppBuilderBrandingScreen />} />
      <Route path="appbuilder/modules" element={<AppBuilderModuleManagementScreen />} />
      <Route path="appbuilder/builds" element={<AppBuilderBuildScreen />} />
      <Route path="appbuilder/deployments" element={<AppBuilderDeploymentScreen />} />
      <Route path="appbuilder/analytics" element={<AppBuilderAnalyticsScreen />} />
    </Routes>
  );
};

export default AppBuilderRouter;




