import React, { useEffect, useMemo, useState } from 'react';
import { FiShoppingCart, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  buildPeopleFromWaiversForPosCart,
  buildPosCartLinesFromAssignments,
  getPosPersonCheckInLookup,
  groupPosPeopleByWaiver,
  loadAdmissionInventoryForPos,
  loadFreeWithPurchasePromotions,
  resolveLoyaltyCustomerFromSelectedPeople,
  waiverPersonDisplayName,
} from '../../helpers/Waivers/waiverToPosCart';
import { resolveTodayCheckInRecord } from '../../services/Waivers/WaiverCheckInService';

/**
 * Pick people across one or more waivers → age + free-with-purchase tickets → POS cart.
 */
export default function WaiverSendToPosModal({
  waivers = [],
  focusWaiverId = null,
  businessId,
  checkInsToday,
  onClose,
  onSendToPos,
}) {
  const waiverList = useMemo(
    () => (Array.isArray(waivers) ? waivers.filter((w) => w?.id) : []),
    [waivers],
  );

  const people = useMemo(
    () => buildPeopleFromWaiversForPosCart(waiverList),
    [waiverList],
  );

  const groups = useMemo(() => groupPosPeopleByWaiver(people), [people]);

  const [selectedIds, setSelectedIds] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [fwpPromotions, setFwpPromotions] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const isCheckedInToday = (person) => {
    const lookup = getPosPersonCheckInLookup(person);
    const { rec } = resolveTodayCheckInRecord(
      checkInsToday,
      lookup.waiverId,
      lookup.waiverParticipantId,
      lookup.subjectType,
    );
    return !!rec;
  };

  useEffect(() => {
    const checkedInIds = people.filter(isCheckedInToday).map((p) => p.id);
    if (checkedInIds.length > 0) {
      setSelectedIds(checkedInIds);
      return;
    }
    if (focusWaiverId) {
      const focusIds = people
        .filter((p) => p.waiver_id === focusWaiverId)
        .map((p) => p.id);
      setSelectedIds(focusIds.length > 0 ? focusIds : people.map((p) => p.id));
      return;
    }
    setSelectedIds(people.map((p) => p.id));
  }, [people, checkInsToday, focusWaiverId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingInventory(true);
      try {
        const promos = await loadFreeWithPurchasePromotions(businessId);
        const items = await loadAdmissionInventoryForPos(businessId, promos);
        if (!cancelled) {
          setFwpPromotions(promos);
          setInventoryItems(items);
        }
      } catch (error) {
        console.error('[WaiverSendToPosModal] inventory load failed:', error);
        if (!cancelled) {
          toast.error(error?.message || 'Could not load admission tickets');
          setFwpPromotions([]);
          setInventoryItems([]);
        }
      } finally {
        if (!cancelled) setLoadingInventory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const selectedPeople = useMemo(
    () => people.filter((p) => selectedIds.includes(p.id)),
    [people, selectedIds],
  );

  const preview = useMemo(
    () =>
      buildPosCartLinesFromAssignments({
        people: selectedPeople,
        inventoryItems,
        promotions: fwpPromotions,
      }),
    [selectedPeople, inventoryItems, fwpPromotions],
  );

  const assignmentFor = (personId) => preview.assignments?.[personId] || null;

  const focusWaiver = useMemo(
    () => waiverList.find((w) => w.id === focusWaiverId) || waiverList[0] || null,
    [waiverList, focusWaiverId],
  );

  const handleConfirm = async () => {
    if (submitting) return;
    if (!preview.ok) {
      toast.error(preview.message || 'Could not build POS cart');
      return;
    }

    setSubmitting(true);
    try {
      await onSendToPos({
        cartItems: preview.cartItems,
        customer: resolveLoyaltyCustomerFromSelectedPeople(selectedPeople, focusWaiver),
        peopleCount: selectedPeople.length,
        waiverCount: new Set(selectedPeople.map((p) => p.waiver_id).filter(Boolean)).size,
      });
    } catch (error) {
      console.error('[WaiverSendToPosModal] send failed:', error);
      toast.error(error?.message || 'Could not send to POS');
      setSubmitting(false);
    }
  };

  const togglePerson = (personId, next) => {
    setSelectedIds((current) => {
      if (next) {
        return current.includes(personId) ? current : [...current, personId];
      }
      return current.filter((id) => id !== personId);
    });
  };

  const selectAllInGroup = (groupPeople, next) => {
    const ids = groupPeople.map((p) => p.id);
    setSelectedIds((current) => {
      if (next) {
        const set = new Set(current);
        ids.forEach((id) => set.add(id));
        return [...set];
      }
      return current.filter((id) => !ids.includes(id));
    });
  };

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="waiver-send-to-pos-title"
      >
        <div style={styles.header}>
          <div style={styles.headerTitleWrap}>
            <FiShoppingCart size={20} style={{ color: TavariStyles.colors.primary }} />
            <h3 id="waiver-send-to-pos-title" style={styles.title}>
              Send to POS
            </h3>
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        <p style={styles.subtitle}>
          Select everyone coming in — including people on other waivers. Free-with-purchase
          (e.g. free adults with kids) applies across the whole party.
        </p>

        {people.length === 0 ? (
          <p style={styles.empty}>No people with usable names/dates of birth on these waivers.</p>
        ) : (
          <div style={styles.list}>
            {groups.map((group) => {
              const groupSelectedCount = group.people.filter((p) =>
                selectedIds.includes(p.id),
              ).length;
              const allGroupSelected = groupSelectedCount === group.people.length;
              return (
                <div key={group.waiverId} style={styles.groupBlock}>
                  <div style={styles.groupHeader}>
                    <div>
                      <div style={styles.groupTitle}>{group.waiverLabel}</div>
                      <div style={styles.groupMeta}>
                        {group.people.length} on waiver
                        {groupSelectedCount > 0 ? ` · ${groupSelectedCount} selected` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      style={styles.groupToggleBtn}
                      onClick={() => selectAllInGroup(group.people, !allGroupSelected)}
                    >
                      {allGroupSelected ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                  {group.people.map((person) => {
                    const checked = selectedIds.includes(person.id);
                    const assigned = assignmentFor(person.id);
                    const label = waiverPersonDisplayName(person);
                    const roleLabel =
                      person.participant_type === 'primary'
                        ? 'Primary'
                        : person.participant_type === 'minor'
                          ? 'Minor'
                          : 'Adult';
                    const checkedIn = isCheckedInToday(person);
                    return (
                      <label key={person.id} style={styles.row}>
                        <TavariCheckbox
                          id={`waiver-pos-${person.id}`}
                          checked={checked}
                          onChange={(next) => togglePerson(person.id, next)}
                          label=""
                        />
                        <div style={styles.rowText}>
                          <span style={styles.personName}>
                            {label}
                            <span style={styles.roleBadge}>{roleLabel}</span>
                            {checkedIn ? (
                              <span style={styles.checkInBadge}>Checked in</span>
                            ) : null}
                          </span>
                          <span style={styles.ticketHint}>
                            {loadingInventory
                              ? 'Loading tickets…'
                              : assigned
                                ? assigned.inventory_item_name
                                : checked
                                  ? 'No matching ticket'
                                  : 'Not selected'}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {!loadingInventory && selectedPeople.length > 0 && preview.ok ? (
          <div style={styles.summary}>
            <strong>Cart preview</strong>
            <div style={styles.summaryMeta}>
              {selectedPeople.length} people
              {groups.length > 1
                ? ` from ${new Set(selectedPeople.map((p) => p.waiver_id)).size} waivers`
                : ''}
            </div>
            <ul style={styles.summaryList}>
              {preview.cartItems.map((item) => (
                <li key={item.id}>
                  {item.quantity}× {item.name}
                  {Number(item.price) > 0 ? ` — $${Number(item.price).toFixed(2)}` : ' — Free'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!loadingInventory && !preview.ok && selectedPeople.length > 0 ? (
          <p style={styles.error}>{preview.message}</p>
        ) : null}

        <div style={styles.footer}>
          <button type="button" style={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.primaryBtn,
              ...((submitting || loadingInventory || !preview.ok) ? styles.primaryBtnDisabled : {}),
            }}
            disabled={submitting || loadingInventory || !preview.ok}
            onClick={handleConfirm}
          >
            {submitting ? 'Sending…' : 'Open POS with tickets'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    padding: 16,
  },
  modal: {
    width: '100%',
    maxWidth: 560,
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
    padding: 20,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
  },
  closeBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 4,
    color: '#64748b',
  },
  subtitle: {
    margin: '0 0 16px',
    fontSize: 14,
    color: '#64748b',
    lineHeight: 1.4,
  },
  empty: {
    margin: '12px 0',
    color: '#64748b',
    fontSize: 14,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    maxHeight: 360,
    overflowY: 'auto',
    marginBottom: 12,
  },
  groupBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  groupTitle: {
    fontWeight: 700,
    fontSize: 14,
    color: '#0f172a',
  },
  groupMeta: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  groupToggleBtn: {
    border: '1px solid #cbd5e1',
    background: '#fff',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
    flexShrink: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#fff',
    cursor: 'pointer',
  },
  rowText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  personName: {
    fontWeight: 600,
    color: '#0f172a',
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  roleBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#0f766e',
    background: '#ecfdf5',
    borderRadius: 4,
    padding: '1px 6px',
  },
  checkInBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#1d4ed8',
    background: '#eff6ff',
    borderRadius: 4,
    padding: '1px 6px',
  },
  ticketHint: {
    fontSize: 13,
    color: '#64748b',
  },
  summary: {
    background: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 13,
    color: '#334155',
  },
  summaryMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748b',
  },
  summaryList: {
    margin: '8px 0 0',
    paddingLeft: 18,
  },
  error: {
    color: TavariStyles.colors.error,
    fontSize: 13,
    marginBottom: 12,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  secondaryBtn: {
    border: '1px solid #cbd5e1',
    background: '#fff',
    borderRadius: 8,
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 600,
    color: '#334155',
  },
  primaryBtn: {
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    borderRadius: 8,
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  primaryBtnDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
};
