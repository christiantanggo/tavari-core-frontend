// src/screens/RecipeBuilderScreen.jsx
import React, { useState } from 'react';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../utils/TavariStyles';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import SessionManager from '../components/SessionManager';

import IngredientsTab from '../components/RecipeBuilder/IngredientsTab';
import RecipeTab from '../components/RecipeBuilder/RecipeTab';
import InventoryLevelsTab from '../components/RecipeBuilder/InventoryLevelsTab';
import ShrinkageTab from '../components/RecipeBuilder/ShrinkageTab';
import SettingsTab from '../components/RecipeBuilder/SettingsTab';
import TavariTabSystemComponent from '../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../components/UI/TavariModuleHeader';

const RecipeBuilderScreen = () => {
  const [activeTab, setActiveTab] = useState('ingredients');
  const { selectedBusinessId } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'RecipeBuilderScreen'
  });

  usePermissions();

  const tabs = [
    { id: 'ingredients', label: '🥬 Ingredients' },
    { id: 'recipe', label: '📖 Recipe' },
    { id: 'inventory', label: '📦 Inventory' },
    { id: 'shrinkage', label: '♻️ Shrink / Adjustment' },
    { id: 'settings', label: '⚙️ Settings' },
  ];

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin']}
      requireBusiness={true}
      componentName="RecipeBuilderScreen"
    >
      <SessionManager>
        <div style={styles.container}>
          <TavariModuleHeader
            title="Tavari Recipe Manager"
            description="Purchase ingredients, build recipes, track inventory, and manage suppliers."
            actionLabel="Ingredients"
            onAction={() => setActiveTab('ingredients')}
          />

          <TavariTabSystemComponent
            tabs={tabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={setActiveTab}
            ariaLabel="Recipe Manager module"
            variant="module"
          />

          <div style={styles.content}>
            {activeTab === 'ingredients' && <IngredientsTab businessId={selectedBusinessId} />}
            {activeTab === 'recipe' && <RecipeTab businessId={selectedBusinessId} />}
            {activeTab === 'inventory' && <InventoryLevelsTab businessId={selectedBusinessId} />}
            {activeTab === 'shrinkage' && <ShrinkageTab businessId={selectedBusinessId} />}
            {activeTab === 'settings' && <SettingsTab businessId={selectedBusinessId} />}
          </div>
        </div>
      </SessionManager>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50,
    padding: TavariStyles.spacing['3xl'],
    paddingTop: '80px',
    boxSizing: 'border-box'
  },
  content: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius?.lg || '12px',
    padding: TavariStyles.spacing['3xl'],
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
};

export default RecipeBuilderScreen;
