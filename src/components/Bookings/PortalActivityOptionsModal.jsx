import React, { useState } from 'react';
import { FiMinus, FiPlus, FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import PortalBundleCustomizationModal from './PortalBundleCustomizationModal';
import OutsideFoodPolicyModal from './OutsideFoodPolicyModal';
import { optionNeedsBundleCustomization } from '../../utils/posBundleModifiers';
import { buildPortalInventoryById } from '../../utils/posInventoryBundles';
import {
  PORTAL_OPTIONS_DISPLAY_MODES,
  validatePortalOptionsConfig,
  resolvePortalOptionListPrice,
  calculatePortalOptionLinePricing,
  applyPortalOptionSelectionChange,
  groupIsIncludedPackageChoice,
  groupIsIncludedMultiPickChoice,
  groupIsUpgradeFromIncluded,
  includedPackagePickCount,
  groupUsesCheckboxPortalSelection,
  filterVisiblePortalOptionGroups,
  filterVisiblePortalOptionItems,
  finalizePortalOptionSelections,
  isPortalOptionGroupVisible,
  portalOptionStepRequiresSelection,
} from '../../utils/bookingActivityOptions';

const formatMoney = (value) => `$${(Number.parseFloat(value) || 0).toFixed(2)}`;

/**
 * Show list price only when the customer is paying for extras.
 * Included package choices stay price-free until quantity exceeds the free unit.
 */
function formatOptionPrice(group, option, inventoryPrices = {}, selections = {}, quantity = 0) {
  const qty = Math.max(0, Number.parseInt(quantity, 10) || 0);
  const listPrice = resolvePortalOptionListPrice(group, option, inventoryPrices);

  if (option.included) {
    if (qty <= 0) return 'Included';

    const pricing = calculatePortalOptionLinePricing(
      group,
      option,
      qty,
      inventoryPrices,
      selections,
    );
    if (pricing.paidQuantity <= 0) return 'Included';
    if (pricing.paidQuantity === 1) {
      return `${formatMoney(listPrice)} for 1 extra`;
    }
    return `${pricing.paidQuantity} × ${formatMoney(listPrice)} = ${formatMoney(pricing.totalPrice)}`;
  }

  return formatMoney(listPrice);
}

function IncludedPackageNotice({ group, selections = {}, allGroups = [] }) {
  const freeUnits = includedPackagePickCount(group);
  const selectedUnits = filterVisiblePortalOptionItems(group, selections, allGroups).reduce(
    (sum, opt) => sum + (Number.parseInt(selections?.[opt.id], 10) || 0),
    0,
  );
  const progressUnits = Math.min(selectedUnits, freeUnits);
  const isComplete = progressUnits >= freeUnits;
  const isMulti = groupIsIncludedMultiPickChoice(group);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 12,
        padding: '12px 14px',
        borderRadius: 10,
        backgroundColor: isComplete ? '#ecfdf5' : '#ecfeff',
        border: `1px solid ${isComplete ? '#6ee7b7' : TavariStyles.colors.primaryLight}`,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          minWidth: 48,
          padding: '6px 10px',
          borderRadius: 8,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 16,
          lineHeight: 1.2,
          color: '#fff',
          backgroundColor: isComplete ? TavariStyles.colors.success : TavariStyles.colors.primary,
        }}
        aria-label={`${progressUnits} of ${freeUnits} included food options selected`}
      >
        {progressUnits}/{freeUnits}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.45,
          color: isComplete ? TavariStyles.colors.successText : TavariStyles.colors.primaryDark,
        }}
      >
        {isMulti ? (
          <>
            Your package includes {freeUnits} food option{freeUnits === 1 ? '' : 's'} at no extra charge
            {' '}({progressUnits} of {freeUnits} selected). Quantity counts — for example {freeUnits} of
            the same option, or a mix. Anything beyond that is charged at list price.
          </>
        ) : (
          <>
            Your package includes one choice below at no extra charge ({progressUnits} of {freeUnits}{' '}
            selected). Select any combination — the first is included, extras are charged at list price.
          </>
        )}
      </p>
    </div>
  );
}

function OptionRow({
  group,
  option,
  quantity,
  onChange,
  onCustomize,
  hasCustomization,
  needsBundleCustomization = false,
  isUpgradeGroup,
  inventoryPrices = {},
  selections = {},
}) {
  const isCheckbox = isUpgradeGroup || option.input_type === 'checkbox';
  const checked = quantity > 0;

  if (isCheckbox) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onChange(checked ? 0 : 1)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onChange(checked ? 0 : 1);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '14px 16px',
          border: `1px solid ${checked ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
          borderRadius: 8,
          backgroundColor: checked ? `${TavariStyles.colors.primary}10` : 'white',
          cursor: 'pointer',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <TavariCheckbox
            checked={checked}
            onChange={(next) => onChange(next ? 1 : 0)}
            size="md"
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
            {option.name}
            {option.included && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#047857',
                  backgroundColor: '#d1fae5',
                  padding: '2px 8px',
                  borderRadius: 999,
                  verticalAlign: 'middle',
                }}
              >
                Included
              </span>
            )}
            {option.required && <span style={{ color: '#dc2626' }}> *</span>}
          </div>
          {option.description && (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
              {option.description}
            </div>
          )}
          {!option.description && option.includes_label && (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
              Includes: {option.includes_label}
            </div>
          )}
          <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.primary, marginTop: 6 }}>
            {formatOptionPrice(group, option, inventoryPrices, selections, quantity)}
          </div>
          {checked && needsBundleCustomization && onCustomize && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCustomize();
              }}
              style={{
                marginTop: 8,
                padding: '6px 10px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 6,
                border: `1px solid ${TavariStyles.colors.primary}`,
                background: '#fff',
                color: TavariStyles.colors.primary,
                cursor: 'pointer',
              }}
            >
              {hasCustomization ? 'Edit balloon choices' : 'Choose balloon styles'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '14px 16px',
        border: `1px solid ${TavariStyles.colors.gray200}`,
        borderRadius: 8,
        backgroundColor: 'white',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
            {option.name}
            {option.included && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#047857',
                  backgroundColor: '#d1fae5',
                  padding: '2px 8px',
                  borderRadius: 999,
                  verticalAlign: 'middle',
                }}
              >
                Included
              </span>
            )}
            {option.required && <span style={{ color: '#dc2626' }}> *</span>}
          </div>
          {option.description && (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
              {option.description}
            </div>
          )}
          {!option.description && option.includes_label && (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
              Includes: {option.includes_label}
            </div>
          )}
          <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.primary, marginTop: 6 }}>
            {formatOptionPrice(group, option, inventoryPrices, selections, quantity)}
            {!isUpgradeGroup && option.max_quantity > 1 && (
              <span style={{ fontWeight: 400, color: TavariStyles.colors.gray500 }}>
                {' '}
                · max {option.max_quantity}
              </span>
            )}
          </div>
          {quantity > 0 && needsBundleCustomization && onCustomize && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCustomize();
              }}
              style={{
                marginTop: 8,
                padding: '6px 10px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 6,
                border: `1px solid ${TavariStyles.colors.primary}`,
                background: '#fff',
                color: TavariStyles.colors.primary,
                cursor: 'pointer',
              }}
            >
              {hasCustomization ? 'Edit balloon choices' : 'Choose balloon styles'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => onChange(Math.max(0, quantity - 1))}
            disabled={quantity <= 0}
            style={qtyButtonStyle}
            aria-label="Decrease quantity"
          >
            <FiMinus size={16} />
          </button>
          <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{quantity}</span>
          <button
            type="button"
            onClick={() => onChange(Math.min(option.max_quantity, quantity + 1))}
            disabled={quantity >= option.max_quantity}
            style={qtyButtonStyle}
            aria-label="Increase quantity"
          >
            <FiPlus size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

const qtyButtonStyle = {
  width: 32,
  height: 32,
  borderRadius: 6,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  background: 'white',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

export default function PortalActivityOptionsModal({
  open,
  optionsConfig,
  selections,
  onSelectionsChange,
  bundleCustomizations = {},
  onBundleCustomizationsChange,
  businessId,
  inventoryItems = [],
  bundleContext = {},
  stepIndex = 0,
  onStepIndexChange,
  onContinue,
  onBack,
  onClose,
  isPartyBooking = false,
  requiresStaffApproval = false,
  checkoutActionLabel = 'Proceed to Payment',
  modalStyles = {},
  addonSettingsRaw = null,
}) {
  const [bundleModal, setBundleModal] = useState(null);
  const [acceptedOutsideFoodPolicyGroupIds, setAcceptedOutsideFoodPolicyGroupIds] = useState(
    () => new Set()
  );
  const inventoryById = React.useMemo(
    () => buildPortalInventoryById(inventoryItems, bundleContext),
    [inventoryItems, bundleContext],
  );
  const bundleItemsByBundleId =
    bundleContext?.bundleItemsByBundleId instanceof Map
      ? bundleContext.bundleItemsByBundleId
      : new Map();

  const portalSettingsPayload = {
    portal_options: { groups: optionsConfig?.groups || [], display_mode: optionsConfig?.displayMode },
  };

  const applyQuantityChange = (group, option, qty) => {
    onSelectionsChange(
      applyPortalOptionSelectionChange(portalSettingsPayload, selections, group, option.id, qty)
    );
  };

  const openBundleCustomization = (group, option, targetQty) => {
    setBundleModal({
      group,
      option,
      targetQty,
      initialSlotSelections: bundleCustomizations?.[option.id]?.slotSelections || {},
    });
  };

  const handleOptionQuantityChange = (group, option, qty) => {
    const needsCustomization = optionNeedsBundleCustomization(
      option,
      inventoryById,
      bundleItemsByBundleId,
      group,
    );

    if (qty <= 0) {
      if (onBundleCustomizationsChange && bundleCustomizations?.[option.id]) {
        const next = { ...bundleCustomizations };
        delete next[option.id];
        onBundleCustomizationsChange(next);
      }
      applyQuantityChange(group, option, 0);
      return;
    }

    if (needsCustomization) {
      openBundleCustomization(group, option, qty);
      return;
    }

    applyQuantityChange(group, option, qty);
  };

  const handleBundleModalSave = ({ slotSelections, bundleComponentModifiers }) => {
    if (!bundleModal) return;
    const { group, option, targetQty } = bundleModal;
    applyQuantityChange(group, option, targetQty);
    if (onBundleCustomizationsChange) {
      onBundleCustomizationsChange({
        ...bundleCustomizations,
        [option.id]: { slotSelections, bundleComponentModifiers },
      });
    }
    setBundleModal(null);
  };
  const isStepMode = optionsConfig?.displayMode === PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS;
  const inventoryPrices = optionsConfig?.inventoryPrices || {};
  const visibleGroups =
    open && optionsConfig?.groups?.length
      ? filterVisiblePortalOptionGroups(optionsConfig.groups, selections)
      : [];
  const groupsToShow = isStepMode
    ? [visibleGroups[stepIndex]].filter(Boolean)
    : visibleGroups;

  React.useEffect(() => {
    if (!open) {
      setAcceptedOutsideFoodPolicyGroupIds(new Set());
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || !isStepMode || !onStepIndexChange) return;
    if (stepIndex >= visibleGroups.length && visibleGroups.length > 0) {
      onStepIndexChange(Math.max(0, visibleGroups.length - 1));
    }
  }, [open, isStepMode, stepIndex, visibleGroups.length, onStepIndexChange]);

  React.useEffect(() => {
    if (!open || !isStepMode || !onStepIndexChange || !optionsConfig?.groups?.length) return;
    const groupAtStep = visibleGroups[stepIndex];
    if (!groupAtStep) return;
    if (
      isPortalOptionGroupVisible(groupAtStep, selections, optionsConfig.groups)
    ) {
      return;
    }
    const replacementIndex = visibleGroups.findIndex((group) =>
      isPortalOptionGroupVisible(group, selections, optionsConfig.groups)
    );
    if (replacementIndex >= 0 && replacementIndex !== stepIndex) {
      onStepIndexChange(replacementIndex);
    }
  }, [
    open,
    isStepMode,
    stepIndex,
    visibleGroups,
    selections,
    optionsConfig?.groups,
    onStepIndexChange,
  ]);

  if (!open || !optionsConfig?.groups?.length) return null;

  const title = isPartyBooking
    ? isStepMode && groupsToShow[0]?.name
      ? `Party add-ons — ${groupsToShow[0].name}`
      : 'Customize your party'
    : isStepMode && groupsToShow[0]?.name
      ? groupsToShow[0].name
      : 'Add-ons & extras';

  const isLastStep = !isStepMode || stepIndex >= visibleGroups.length - 1;
  const currentStepGroup = isStepMode ? groupsToShow[0] : null;
  const stepRequiresSelection = isStepMode
    ? portalOptionStepRequiresSelection(currentStepGroup, selections, optionsConfig.groups)
    : visibleGroups.some((group) =>
        portalOptionStepRequiresSelection(group, selections, optionsConfig.groups)
      );
  const isOptionalStep = !stepRequiresSelection;

  const groupsForPolicyCheck = isStepMode ? groupsToShow : visibleGroups;
  const pendingOutsideFoodPolicyGroup = groupsForPolicyCheck.find(
    (group) =>
      groupIsIncludedPackageChoice(group) &&
      !acceptedOutsideFoodPolicyGroupIds.has(group.id)
  );
  const showOutsideFoodPolicyModal = open && Boolean(pendingOutsideFoodPolicyGroup);

  const handleAcceptOutsideFoodPolicy = () => {
    if (!pendingOutsideFoodPolicyGroup) return;
    setAcceptedOutsideFoodPolicyGroupIds((prev) => {
      const next = new Set(prev);
      next.add(pendingOutsideFoodPolicyGroup.id);
      return next;
    });
  };

  const handleContinue = () => {
    if (showOutsideFoodPolicyModal) return;
    const normalizedSelections = finalizePortalOptionSelections(
      addonSettingsRaw || { portal_options: { groups: optionsConfig.groups } },
      selections
    );
    const visibleForValidation = filterVisiblePortalOptionGroups(optionsConfig.groups, normalizedSelections);
    const groupsForStep = isStepMode ? groupsToShow : visibleForValidation;
    const check = validatePortalOptionsConfig(
      { ...optionsConfig, groups: groupsForStep },
      normalizedSelections,
      bundleCustomizations,
      inventoryItems,
      bundleContext
    );
    if (!check.ok) {
      onContinue(check);
      return;
    }
    const nextVisibleGroups = filterVisiblePortalOptionGroups(
      optionsConfig.groups,
      normalizedSelections
    );
    onSelectionsChange(normalizedSelections);
    if (isStepMode && stepIndex < nextVisibleGroups.length - 1) {
      onStepIndexChange(stepIndex + 1);
      return;
    }
    onContinue({ ok: true });
  };

  const forwardActionsStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginLeft: 'auto',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  };

  const renderForwardActions = () => {
    if (isLastStep) {
      return (
        <button type="button" onClick={handleContinue} style={modalStyles.footerNext}>
          {checkoutActionLabel}
        </button>
      );
    }

    if (isOptionalStep) {
      return (
        <>
          <button type="button" onClick={handleContinue} style={modalStyles.footerBack}>
            Skip
          </button>
          <button type="button" onClick={handleContinue} style={modalStyles.footerNext}>
            Next
          </button>
        </>
      );
    }

    return (
      <button type="button" onClick={handleContinue} style={modalStyles.footerNext}>
        Next
      </button>
    );
  };

  return (
    <>
    <div style={modalStyles.modalOverlay}>
      <div
        style={{
          ...modalStyles.modalContent,
          width: '100%',
          maxHeight: '90vh',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ ...modalStyles.modalHeader, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ ...modalStyles.modalTitle, flex: 1, minWidth: 0 }}>{title}</div>
          <button type="button" onClick={onClose} style={modalStyles.modalClose} aria-label="Close">
            <FiX size={24} />
          </button>
        </div>
        <div style={{ ...modalStyles.modalBody, width: '100%', boxSizing: 'border-box' }}>
          {isPartyBooking && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                borderRadius: 8,
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                fontSize: 13,
                color: '#1e40af',
                lineHeight: 1.5,
              }}
            >
              Choose food, decorations, and other party extras before {requiresStaffApproval ? 'submitting your request' : 'paying your deposit'}.
            </div>
          )}
          {isStepMode && visibleGroups.length > 1 && (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray500, marginBottom: 12 }}>
              Step {stepIndex + 1} of {visibleGroups.length}
            </div>
          )}
          {isStepMode && isOptionalStep && visibleGroups.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                backgroundColor: TavariStyles.colors.gray50,
                border: `1px solid ${TavariStyles.colors.gray200}`,
                fontSize: 13,
                color: TavariStyles.colors.gray600,
                lineHeight: 1.5,
              }}
            >
              {isLastStep
                ? (requiresStaffApproval
                  ? 'These extras are optional. You can submit your request without selecting anything.'
                  : 'These extras are optional. You can proceed to payment without selecting anything.')
                : 'This step is optional. Use Skip if you do not want to add anything here.'}
            </div>
          )}
          {visibleGroups.length === 0 ? (
            <div style={{ padding: '20px 0', fontSize: 14, color: TavariStyles.colors.gray600, textAlign: 'center' }}>
              Make a selection above to see related options.
            </div>
          ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
            {groupsToShow.map((group) => (
              <div key={group.id} style={{ width: '100%' }}>
                {!isStepMode && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: TavariStyles.colors.gray900 }}>
                      {group.name}
                    </div>
                    {group.description && (
                      <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
                        {group.description}
                      </div>
                    )}
                  </div>
                )}
                {isStepMode && group.description && (
                  <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginBottom: 12 }}>
                    {group.description}
                  </p>
                )}
                {groupIsIncludedPackageChoice(group) ? (
                  <IncludedPackageNotice
                    group={group}
                    selections={selections}
                    allGroups={optionsConfig.groups}
                  />
                ) : groupIsUpgradeFromIncluded(group) ? (
                  <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginBottom: 10 }}>
                    Your package includes a default choice. Select another option below to upgrade.
                  </p>
                ) : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                  {filterVisiblePortalOptionItems(group, selections, optionsConfig.groups).map((option) => {
                    const needsBundleCustomization = optionNeedsBundleCustomization(
                      option,
                      inventoryById,
                      bundleItemsByBundleId,
                      group,
                    );
                    return (
                    <OptionRow
                      key={option.id}
                      group={group}
                      option={option}
                      isUpgradeGroup={groupUsesCheckboxPortalSelection(group)}
                      inventoryPrices={inventoryPrices}
                      selections={selections}
                      quantity={Number.parseInt(selections?.[option.id], 10) || 0}
                      hasCustomization={Boolean(bundleCustomizations?.[option.id]?.bundleComponentModifiers?.length)}
                      needsBundleCustomization={needsBundleCustomization}
                      onCustomize={
                        needsBundleCustomization
                          ? () => openBundleCustomization(group, option, Number.parseInt(selections?.[option.id], 10) || 1)
                          : undefined
                      }
                      onChange={(qty) => handleOptionQuantityChange(group, option, qty)}
                    />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
        <div style={{ ...modalStyles.modalFooter, width: '100%', boxSizing: 'border-box' }}>
          <button type="button" onClick={onBack} style={modalStyles.footerBack}>
            Back
          </button>
          <div style={forwardActionsStyle}>{renderForwardActions()}</div>
        </div>
      </div>
    </div>
    <PortalBundleCustomizationModal
      open={Boolean(bundleModal)}
      businessId={businessId}
      bundleInventoryId={bundleModal?.option?.inventory_item_id}
      bundleName={bundleModal?.option?.name}
      initialSlotSelections={bundleModal?.initialSlotSelections || {}}
      onSave={handleBundleModalSave}
      onClose={() => setBundleModal(null)}
      modalStyles={modalStyles}
    />
    <OutsideFoodPolicyModal
      open={showOutsideFoodPolicyModal}
      onAccept={handleAcceptOutsideFoodPolicy}
    />
    </>
  );
}
