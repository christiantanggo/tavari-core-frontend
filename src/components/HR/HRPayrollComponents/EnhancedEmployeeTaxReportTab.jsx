// components/HR/HRPayrollComponents/EnhancedEmployeeTaxReportTab.jsx
import React, { useState, useEffect } from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../../utils/TavariStyles';

import EETRT_EmployeeSelector from './EETRT-EmployeeSelector';
import EETRT_FrequencyDetection from './EETRT-FrequencyDetection';
import EETRT_ReportConfiguration from './EETRT-ReportConfiguration';
import EETRT_DataPreview from './EETRT-DataPreview';
import { useEETRTData } from './EETRT-DataHook';

const EnhancedEmployeeTaxReportTab = ({ selectedBusinessId, businessData }) => {
  const {
    employees,
    selectedEmployee,
    reportConfig,
    calculatedData,
    loading,
    generating,
    handleEmployeeChange,
    setReportConfig,
    generateComprehensiveReport
  } = useEETRTData(selectedBusinessId, businessData);

  const security = useSecurityContext({
    componentName: 'EnhancedEmployeeTaxReportTab',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  const auth = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'EnhancedEmployeeTaxReportTab'
  });

  const effectiveBusinessId = selectedBusinessId || auth.selectedBusinessId;
  const effectiveBusinessData = businessData || auth.businessData;

  const styles = {
    container: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      minHeight: '100vh'
    }
  };

  if (loading) {
    return (
      <POSAuthWrapper componentName="EnhancedEmployeeTaxReportTab" requiredRoles={['owner', 'manager', 'hr_admin']} requireBusiness={true}>
        <SecurityWrapper componentName="EnhancedEmployeeTaxReportTab" securityLevel="critical" enableAuditLogging={true} sensitiveComponent={true}>
          <div style={styles.container}>
            <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl }}>Loading employees...</div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="EnhancedEmployeeTaxReportTab" requiredRoles={['owner', 'manager', 'hr_admin']} requireBusiness={true}>
      <SecurityWrapper componentName="EnhancedEmployeeTaxReportTab" securityLevel="critical" enableAuditLogging={true} sensitiveComponent={true}>
        <div style={styles.container}>
          <EETRT_EmployeeSelector
            employees={employees}
            selectedEmployee={selectedEmployee}
            onEmployeeChange={handleEmployeeChange}
            effectiveBusinessId={effectiveBusinessId}
          />
          
          <EETRT_FrequencyDetection
            selectedEmployee={selectedEmployee}
            reportConfig={reportConfig}
            setReportConfig={setReportConfig}
          />
          
          <EETRT_ReportConfiguration
            selectedEmployee={selectedEmployee}
            reportConfig={reportConfig}
            setReportConfig={setReportConfig}
          />
          
          <EETRT_DataPreview
            calculatedData={calculatedData}
            generating={generating}
            onGenerateReport={generateComprehensiveReport}
          />
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default EnhancedEmployeeTaxReportTab;