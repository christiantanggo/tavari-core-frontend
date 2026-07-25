import React, { useEffect, useMemo, useState } from 'react';
import { FiChevronDown, FiChevronRight, FiMinus, FiPlus } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  applyPortalOptionSelectionChange,
  calculatePortalOptionLinePricing,
  findPortalOptionLabel,
  groupHasIncludedOption,
  groupIsIncludedPackageChoice,
  groupIsIncludedMultiPickChoice,
  groupIsUpgradeFromIncluded,
  includedPackagePickCount,
  resolvePortalOptionListPrice,
} from '../../utils/bookingActivityOptions';
const formatMoney = (value) => `$${(Number.parseFloat(value) || 0).toFixed(2)}`;

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

function countGroupSelections(group, selections = {}) {
  return (group.options || []).filter(
    (opt) => (Number.parseInt(selections?.[opt.id], 10) || 0) > 0,
  ).length;
}

function getGroupSelectionSummary(group, selections = {}) {
  const selected = (group.options || []).filter(
    (opt) => (Number.parseInt(selections?.[opt.id], 10) || 0) > 0,
  );
  if (selected.length === 0) return 'None selected';
  return selected
    .map((opt) => {
      const qty = Number.parseInt(selections?.[opt.id], 10) || 0;
      return qty > 1 ? `${opt.name} (×${qty})` : opt.name;
    })
    .join(', ');
}

function OptionRow({
  group,
  option,
  quantity,
  onChange,
  inventoryPrices = {},
  readOnly = false,
  parentLabel = null,
  selections = {},
}) {
  const checked = quantity > 0;

  const nameRow = (
    <>
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
        {quantity > 0 && !readOnly ? (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 600,
              color: TavariStyles.colors.primary,
            }}
          >
            Selected
          </span>
        ) : null}
      </div>
      {parentLabel ? (
        <div style={{ fontSize: 11, color: TavariStyles.colors.gray500, marginTop: 4 }}>
          Shows when: {parentLabel}
        </div>
      ) : null}
      {option.description ? (
        <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
          {option.description}
        </div>
      ) : null}
      {!option.description && option.includes_label ? (
        <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
          Includes: {option.includes_label}
        </div>
      ) : null}
      <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.primary, marginTop: 6 }}>
        {formatOptionPrice(group, option, inventoryPrices, selections, quantity)}
        {option.max_quantity > 1 ? (
          <span style={{ fontWeight: 400, color: TavariStyles.colors.gray500 }}>
            {' '}
            · max {option.max_quantity}
          </span>
        ) : null}
      </div>
    </>
  );

  if (readOnly) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          padding: '12px 14px',
          border: `1px solid ${checked ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
          borderRadius: 8,
          backgroundColor: checked ? `${TavariStyles.colors.primary}08` : '#fafafa',
        }}
      >
        <div style={{ flex: 1 }}>{nameRow}</div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Qty {quantity}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '14px 16px',
        border: `1px solid ${checked ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
        borderRadius: 8,
        backgroundColor: checked ? `${TavariStyles.colors.primary}08` : 'white',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>{nameRow}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => onChange(Math.max(0, quantity - 1))}
            disabled={quantity <= 0}
            style={{
              ...qtyButtonStyle,
              opacity: quantity <= 0 ? 0.4 : 1,
              cursor: quantity <= 0 ? 'not-allowed' : 'pointer',
            }}
            aria-label="Decrease quantity"
          >
            <FiMinus size={16} />
          </button>
          <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{quantity}</span>
          <button
            type="button"
            onClick={() => onChange(Math.min(option.max_quantity, quantity + 1))}
            disabled={quantity >= option.max_quantity}
            style={{
              ...qtyButtonStyle,
              opacity: quantity >= option.max_quantity ? 0.4 : 1,
              cursor: quantity >= option.max_quantity ? 'not-allowed' : 'pointer',
            }}
            aria-label="Increase quantity"
          >
            <FiPlus size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline editor for all activity portal options (staff booking detail).
 * Shows every configured option; selections drive quantities.
 */
export default function PortalActivityOptionsEditor({
  optionsConfig,
  addonSettingsRaw,
  selections,
  onSelectionsChange,
  readOnly = false,
  focusGroupId = null,
  onFocusGroupHandled,
}) {
  const inventoryPrices = optionsConfig?.inventoryPrices || {};
  const groups = optionsConfig?.groups || [];
  const groupIdsKey = useMemo(() => groups.map((g) => g.id).join('|'), [groups]);
  const [expandedGroupIds, setExpandedGroupIds] = useState(new Set());

  useEffect(() => {
    const withSelections = groups
      .filter((group) => countGroupSelections(group, selections) > 0)
      .map((group) => group.id);
    setExpandedGroupIds(
      new Set(withSelections.length > 0 ? withSelections : groups[0]?.id ? [groups[0].id] : []),
    );
  }, [groupIdsKey]);

  useEffect(() => {
    if (!focusGroupId) return;
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      next.add(focusGroupId);
      return next;
    });
    const el = document.getElementById(`portal-options-group-${focusGroupId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    onFocusGroupHandled?.();
  }, [focusGroupId, onFocusGroupHandled]);

  if (!groups.length) {
    return null;
  }

  const toggleGroup = (groupId) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleOptionChange = (group, optionId, qty) => {
    if (readOnly || !onSelectionsChange) return;
    onSelectionsChange(
      applyPortalOptionSelectionChange(
        addonSettingsRaw || { portal_options: { groups } },
        selections,
        group,
        optionId,
        qty,
      ),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map((group) => {
        const isExpanded = expandedGroupIds.has(group.id);
        const selectedCount = countGroupSelections(group, selections);
        const selectionSummary = getGroupSelectionSummary(group, selections);

        return (
          <section
            key={group.id}
            id={`portal-options-group-${group.id}`}
            style={{
              border: `1px solid ${isExpanded ? TavariStyles.colors.primary : '#e5e7eb'}`,
              borderRadius: 8,
              overflow: 'hidden',
              backgroundColor: isExpanded ? '#f8fafc' : 'white',
            }}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={isExpanded}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, margin: 0, color: TavariStyles.colors.gray900 }}>
                  {group.name || 'Options'}
                  {selectedCount > 0 ? (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        color: TavariStyles.colors.primary,
                        backgroundColor: `${TavariStyles.colors.primary}14`,
                        padding: '2px 8px',
                        borderRadius: 999,
                        verticalAlign: 'middle',
                      }}
                    >
                      {selectedCount} selected
                    </span>
                  ) : null}
                </div>
                {group.description ? (
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                    {group.description}
                  </p>
                ) : null}
                {!isExpanded ? (
                  <p
                    style={{
                      margin: '6px 0 0',
                      fontSize: 13,
                      color: selectedCount > 0 ? TavariStyles.colors.gray700 : TavariStyles.colors.gray500,
                      lineHeight: 1.4,
                    }}
                  >
                    {selectionSummary}
                  </p>
                ) : null}
              </div>
              <span style={{ color: TavariStyles.colors.gray500, flexShrink: 0, marginTop: 2 }}>
                {isExpanded ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
              </span>
            </button>

            {isExpanded ? (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e5e7eb' }}>
                {groupIsIncludedPackageChoice(group) ? (
                  <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '12px 0 10px' }}>
                    {groupIsIncludedMultiPickChoice(group)
                      ? `Package includes ${includedPackagePickCount(group)} units at no extra charge (quantity counts toward the free total). Customer must select at least ${includedPackagePickCount(group)} unit${includedPackagePickCount(group) === 1 ? '' : 's'} total, and may add more at list price.`
                      : 'Package includes one choice at no extra charge. Customers may select any combination of options; additional options or quantities are charged at list price.'}
                  </p>
                ) : groupIsUpgradeFromIncluded(group) ? (
                  <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '12px 0 10px' }}>
                    Package includes a default choice. Select another option to upgrade.
                  </p>
                ) : null}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    paddingTop: groupHasIncludedOption(group) ? 0 : 12,
                  }}
                >
                  {(group.options || []).map((option) => {
                    const parentId = option.show_when_option_id || group.show_when_option_id;
                    const parentLabel = parentId
                      ? findPortalOptionLabel(groups, parentId)
                      : null;

                    return (
                      <OptionRow
                        key={option.id}
                        group={group}
                        option={option}
                        inventoryPrices={inventoryPrices}
                        readOnly={readOnly}
                        parentLabel={parentLabel}
                        quantity={Number.parseInt(selections?.[option.id], 10) || 0}
                        selections={selections}
                        onChange={(qty) => handleOptionChange(group, option.id, qty)}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
