import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { FiPlus, FiSave, FiTrash2 } from 'react-icons/fi';

import toast from 'react-hot-toast';

import { TavariStyles } from '../../utils/TavariStyles';

import { formatBookingMoney, computeBookingPricingWithPortalAddonSubtotal } from '../../utils/bookingPricing';

import {

  buildPortalOptionSelectionsFromBooking,

  listNonPortalAddonItems,

} from '../../helpers/Bookings/bookingOptionsDisplay';

import {

  activityHasPortalOptions,

  buildPortalOptionCheckoutRowsFromConfig,

  collectPortalOptionInventoryItemIds,

  enrichPortalOptionsConfig,

  listSelectedPortalOptionsForDisplayFromConfig,

  removePortalOrderSelection,

  validatePortalOptionsConfig,

} from '../../utils/bookingActivityOptions';

import { fetchBundleDataForInventoryIds } from '../../utils/posInventoryBundles';

import { supabase } from '../../supabaseClient';

import bookingService from '../../services/Bookings/BookingService';

import PortalActivityOptionsEditor from './PortalActivityOptionsEditor';

import PortalOrderReviewList from './PortalOrderReviewList';

import BookingAdditionalItemModal from './BookingAdditionalItemModal';



const cardStyle = {

  backgroundColor: 'white',

  padding: '24px',

  borderRadius: '12px',

  border: '1px solid #e5e7eb',

  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',

};



const BookingOptionsTab = ({

  booking,

  businessId,

  canEdit = false,

  getAuditContext,

  onSaved,

  onPricingPreviewChange,

}) => {

  const activity = booking?.booking_activities || {};

  const addonSettingsRaw = activity?.addon_settings;

  const hasPortalOptions = activityHasPortalOptions(addonSettingsRaw);



  const [inventoryItems, setInventoryItems] = useState([]);

  const [bundleContext, setBundleContext] = useState({});

  const [inventoryLoading, setInventoryLoading] = useState(false);

  const [taxRows, setTaxRows] = useState([]);

  const [showAddItemModal, setShowAddItemModal] = useState(false);

  const [selections, setSelections] = useState(() => buildPortalOptionSelectionsFromBooking(booking));

  const [savedSelections, setSavedSelections] = useState(() => buildPortalOptionSelectionsFromBooking(booking));

  const [saving, setSaving] = useState(false);

  const [deletingLineId, setDeletingLineId] = useState(null);

  const [focusGroupId, setFocusGroupId] = useState(null);



  useEffect(() => {

    const next = buildPortalOptionSelectionsFromBooking(booking);

    setSelections(next);

    setSavedSelections(next);

  }, [booking?.id, booking?.booking_addon_items]);



  const loadTaxRows = useCallback(async () => {

    if (!businessId) {

      setTaxRows([]);

      return;

    }

    const { data, error } = await supabase

      .from('pos_tax_categories')

      .select('id, name, rate, category_type')

      .eq('business_id', businessId)

      .eq('is_active', true);

    if (error) {

      console.warn('Tax categories load failed', error);

      setTaxRows([]);

      return;

    }

    setTaxRows((data || []).filter((row) => row.category_type === 'tax'));

  }, [businessId]);



  const loadInventory = useCallback(async () => {

    const inventoryItemIds = collectPortalOptionInventoryItemIds(addonSettingsRaw);

    if (!businessId || inventoryItemIds.length === 0) {

      setInventoryItems([]);

      setBundleContext({});

      return;

    }



    setInventoryLoading(true);

    try {

      const { data, error } = await supabase

        .from('pos_inventory')

        .select('*')

        .eq('business_id', businessId)

        .or('is_active.eq.true,is_active.is.null')

        .in('id', inventoryItemIds)

        .order('name', { ascending: true });

      if (error) throw error;

      const items = data || [];

      const context = await fetchBundleDataForInventoryIds(supabase, businessId, items);

      setInventoryItems(items);

      setBundleContext(context);

    } catch (error) {

      console.error('Error loading portal option inventory:', error);

      setInventoryItems([]);

      setBundleContext({});

    } finally {

      setInventoryLoading(false);

    }

  }, [addonSettingsRaw, businessId]);



  useEffect(() => {

    loadInventory();

    loadTaxRows();

  }, [loadInventory, loadTaxRows]);



  const optionsConfig = useMemo(

    () => enrichPortalOptionsConfig(addonSettingsRaw, inventoryItems, bundleContext),

    [addonSettingsRaw, inventoryItems, bundleContext],

  );



  const additionalItems = useMemo(() => listNonPortalAddonItems(booking), [booking]);



  const checkoutRows = useMemo(

    () => buildPortalOptionCheckoutRowsFromConfig(

      optionsConfig,

      selections,

      inventoryItems,

      bundleContext,

      { skipVisibilityFilter: true },

    ),

    [optionsConfig, selections, inventoryItems, bundleContext],

  );



  const optionsSubtotal = useMemo(

    () => checkoutRows.reduce((sum, row) => sum + (Number(row.total_price) || 0), 0),

    [checkoutRows],

  );

  const orderReviewLines = useMemo(
    () =>
      listSelectedPortalOptionsForDisplayFromConfig(
        optionsConfig,
        selections,
        inventoryItems,
        bundleContext,
        {},
        { addonSettingsRaw }
      ),
    [optionsConfig, selections, inventoryItems, bundleContext, addonSettingsRaw]
  );



  const isDirty = useMemo(

    () => JSON.stringify(selections) !== JSON.stringify(savedSelections),

    [selections, savedSelections],

  );

  const effectivePricing = useMemo(

    () => computeBookingPricingWithPortalAddonSubtotal(booking, optionsSubtotal),

    [booking, optionsSubtotal],

  );

  useEffect(() => {

    if (!onPricingPreviewChange) return;

    if (!isDirty) {

      onPricingPreviewChange(null);

      return;

    }

    onPricingPreviewChange({ portalAddonSubtotal: optionsSubtotal });

  }, [isDirty, optionsSubtotal, onPricingPreviewChange]);

  const canModify = canEdit && booking?.status !== 'cancelled';

  const handleOrderReviewRemove = useCallback(
    (optionId) => {
      if (!canModify) return;
      setSelections((prev) =>
        removePortalOrderSelection(addonSettingsRaw, optionsConfig, prev, optionId)
      );
    },
    [canModify, addonSettingsRaw, optionsConfig]
  );

  const handleOrderReviewEdit = useCallback(
    (groupId) => {
      if (!canModify) return;
      setFocusGroupId(groupId);
    },
    [canModify]
  );



  const handleSave = async () => {

    if (!booking?.id || !canModify) return;



    setSaving(true);

    try {

      bookingService.setBusinessId(businessId);

      const audit = getAuditContext ? await getAuditContext() : {};

      await bookingService.syncPortalOptionSelectionsForBooking(

        booking.id,

        selections,

        { inventoryItems, bundleContext, audit },

      );

      setSavedSelections(selections);

      onPricingPreviewChange?.(null);

      toast.success('Options saved');

      await onSaved?.();

    } catch (error) {

      console.error('Error saving booking options:', error);

      toast.error(error?.message || 'Failed to save options');

    } finally {

      setSaving(false);

    }

  };



  const handleDeleteAdditionalItem = async (lineItemId) => {

    if (!booking?.id || !canModify || !lineItemId) return;

    setDeletingLineId(lineItemId);

    try {

      bookingService.setBusinessId(businessId);

      const audit = getAuditContext ? await getAuditContext() : {};

      await bookingService.deleteBookingAddonItem(lineItemId, audit);

      onPricingPreviewChange?.(null);

      toast.success('Item removed');

      await onSaved?.();

    } catch (error) {

      console.error('Error deleting additional item:', error);

      toast.error(error?.message || 'Failed to remove item');

    } finally {

      setDeletingLineId(null);

    }

  };



  const renderAdditionalItemsSection = () => (

    <section

      style={{

        marginBottom: hasPortalOptions ? 24 : 0,

        paddingBottom: hasPortalOptions ? 24 : 0,

        borderBottom: hasPortalOptions ? '1px solid #e5e7eb' : undefined,

      }}

    >

      <div

        style={{

          display: 'flex',

          justifyContent: 'space-between',

          alignItems: 'flex-start',

          gap: 12,

          marginBottom: 12,

        }}

      >

        <div>

          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: TavariStyles.colors.gray900 }}>

            Additional items

          </h3>

          <p style={{ margin: '4px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>

            One-off charges or extras added outside the activity option catalog.

          </p>

        </div>

        {canModify ? (

          <button

            type="button"

            onClick={() => setShowAddItemModal(true)}

            aria-label="Add additional item"

            style={{

              display: 'inline-flex',

              alignItems: 'center',

              justifyContent: 'center',

              width: 36,

              height: 36,

              borderRadius: 8,

              border: `1px solid ${TavariStyles.colors.primary}`,

              backgroundColor: `${TavariStyles.colors.primary}10`,

              color: TavariStyles.colors.primary,

              cursor: 'pointer',

              flexShrink: 0,

            }}

          >

            <FiPlus size={18} />

          </button>

        ) : null}

      </div>



      {additionalItems.length === 0 ? (

        <div

          style={{

            padding: '14px 16px',

            borderRadius: 8,

            border: '1px dashed #d1d5db',

            fontSize: 13,

            color: TavariStyles.colors.gray600,

            backgroundColor: '#fafafa',

          }}

        >

          No additional items yet.

          {canModify ? ' Tap + to add one.' : ''}

        </div>

      ) : (

        <div style={{ display: 'grid', gap: 8 }}>

          {additionalItems.map((item) => (

            <div

              key={item.lineItemId || item.name}

              style={{

                display: 'flex',

                justifyContent: 'space-between',

                alignItems: 'flex-start',

                gap: 16,

                padding: '12px 14px',

                border: '1px solid #e5e7eb',

                borderRadius: 8,

                backgroundColor: '#fafafa',

              }}

            >

              <div style={{ flex: 1, minWidth: 0 }}>

                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.addonName || item.name}</div>

                {item.description

                  && item.description !== 'Customer portal option'

                  && !item.description.startsWith('Manual booking item.') ? (

                    <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>

                      {item.description}

                    </div>

                  ) : null}

                {item.description?.startsWith('Manual booking item.') ? (

                  <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>

                    {item.description.replace(/^Manual booking item\.\s*/, '')}

                  </div>

                ) : null}

              </div>

              <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>

                <div>

                  <div style={{ fontSize: 14, fontWeight: 700 }}>Qty {item.quantity}</div>

                  <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 2 }}>

                    {formatBookingMoney(item.unitPrice)} each

                  </div>

                </div>

                {canModify ? (

                  <button

                    type="button"

                    onClick={() => handleDeleteAdditionalItem(item.lineItemId)}

                    disabled={deletingLineId === item.lineItemId}

                    aria-label={`Remove ${item.addonName || item.name}`}

                    style={{

                      display: 'inline-flex',

                      alignItems: 'center',

                      gap: 6,

                      padding: '6px 10px',

                      borderRadius: 6,

                      border: '1px solid #fecaca',

                      backgroundColor: '#fff',

                      color: '#dc2626',

                      fontSize: 13,

                      fontWeight: 600,

                      cursor: deletingLineId === item.lineItemId ? 'not-allowed' : 'pointer',

                      opacity: deletingLineId === item.lineItemId ? 0.6 : 1,

                    }}

                  >

                    <FiTrash2 size={14} />

                    {deletingLineId === item.lineItemId ? 'Removing…' : 'Remove'}

                  </button>

                ) : null}

              </div>

            </div>

          ))}

        </div>

      )}

    </section>

  );



  if (!hasPortalOptions && additionalItems.length === 0 && !canModify) {

    return (

      <div style={{ ...cardStyle, marginBottom: 0, color: TavariStyles.colors.gray600 }}>

        No activity options are configured for this booking.

      </div>

    );

  }



  return (

    <>

      <div style={cardStyle}>

        <div

          style={{

            display: 'flex',

            justifyContent: 'space-between',

            alignItems: 'flex-start',

            gap: 16,

            marginBottom: 20,

            flexWrap: 'wrap',

          }}

        >

          <div>

            <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>Options</h2>

            <p style={{ margin: '6px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>

              Add manual items or adjust activity options below, then save option changes when ready.

            </p>

          </div>

          {canModify && hasPortalOptions ? (

            <button

              type="button"

              onClick={handleSave}

              disabled={!isDirty || saving || inventoryLoading}

              style={{

                display: 'inline-flex',

                alignItems: 'center',

                gap: 8,

                padding: '10px 16px',

                borderRadius: 8,

                border: 'none',

                backgroundColor: isDirty && !saving ? TavariStyles.colors.primary : '#e5e7eb',

                color: isDirty && !saving ? '#fff' : '#9ca3af',

                fontWeight: 600,

                fontSize: 14,

                cursor: isDirty && !saving ? 'pointer' : 'not-allowed',

              }}

            >

              <FiSave size={16} />

              {saving ? 'Saving…' : 'Save options'}

            </button>

          ) : null}

        </div>



        {renderAdditionalItemsSection()}



        {inventoryLoading && hasPortalOptions ? (

          <div style={{ fontSize: 14, color: TavariStyles.colors.gray600, marginBottom: 16 }}>

            Loading option prices…

          </div>

        ) : null}



        {hasPortalOptions && orderReviewLines.length > 0 ? (
          <PortalOrderReviewList
            lines={orderReviewLines}
            title="Customer order"
            readOnly={!canModify}
            onRemove={canModify ? handleOrderReviewRemove : undefined}
            onEdit={canModify ? handleOrderReviewEdit : undefined}
          />
        ) : null}

        {hasPortalOptions ? (

          <PortalActivityOptionsEditor

            key={booking?.id}

            optionsConfig={optionsConfig}

            addonSettingsRaw={addonSettingsRaw}

            selections={selections}

            onSelectionsChange={canModify ? setSelections : undefined}

            readOnly={!canModify}

            focusGroupId={focusGroupId}

            onFocusGroupHandled={() => setFocusGroupId(null)}

          />

        ) : !canModify && additionalItems.length === 0 ? (

          <p style={{ margin: 0, fontSize: 14, color: TavariStyles.colors.gray600 }}>

            No activity options are configured for this booking.

          </p>

        ) : null}



        {hasPortalOptions || additionalItems.length > 0 ? (

          <div

            style={{

              marginTop: 20,

              paddingTop: 16,

              borderTop: '1px solid #e5e7eb',

              display: 'flex',

              justifyContent: 'space-between',

              fontSize: 14,

              fontWeight: 600,

            }}

          >

            <span>Booking total{isDirty ? ' (preview)' : ''}</span>

            <span>{formatBookingMoney(effectivePricing.totalPrice)}</span>

          </div>

        ) : null}

      </div>



      <BookingAdditionalItemModal

        open={showAddItemModal}

        bookingId={booking?.id}

        businessId={businessId}

        taxRows={taxRows}

        getAuditContext={getAuditContext}

        onClose={() => setShowAddItemModal(false)}

        onSaved={onSaved}

      />

    </>

  );

};



export default BookingOptionsTab;


