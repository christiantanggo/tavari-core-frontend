// ChargeNow / Bajie shared power bank — operator dashboard (proxied via Edge Function).
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FiSearch,
  FiShoppingBag,
  FiMapPin,
  FiCpu,
  FiCopy,
  FiSettings,
  FiHome,
  FiDollarSign,
  FiMonitor,
  FiBell,
} from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import { chargenowInvoke, formatChargenowResponse } from '../../services/chargenow/chargenowApi';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';

/** Tab defs for {@link TavariTabSystemComponent} (same pattern as WaiversModuleLayout). */
const POWER_BANK_TABS = [
  { id: 'settings', label: 'Setup', icon: FiSettings },
  { id: 'device', label: 'Device', icon: FiSearch },
  { id: 'order', label: 'Rent order', icon: FiShoppingBag },
  { id: 'nearby', label: 'Nearby', icon: FiMapPin },
  { id: 'cabinet', label: 'Cabinets', icon: FiCpu },
  { id: 'shop', label: 'Shop', icon: FiHome },
  { id: 'pricing', label: 'Pricing', icon: FiDollarSign },
  { id: 'ads', label: 'Ads & push', icon: FiMonitor },
  { id: 'webhooks', label: 'Webhook log', icon: FiBell },
];

const shellStyles = {
  minHeight: '100vh',
  backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
  padding: '20px',
  paddingTop: '80px',
  boxSizing: 'border-box',
};

function PillButton({ children, onClick, disabled, variant = 'primary' }) {
  const bg =
    variant === 'danger'
      ? TavariStyles.colors.danger
      : TavariStyles.colors.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 18px',
        borderRadius: 8,
        border: 'none',
        background: disabled ? TavariStyles.colors.gray400 : bg,
        color: '#fff',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: TavariStyles.typography.fontSize.sm,
      }}
    >
      {children}
    </button>
  );
}

const cardStyle = {
  background: TavariStyles.colors.white,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  border: `1px solid ${TavariStyles.colors.gray200}`,
};

const labelStyle = {
  display: 'block',
  fontSize: TavariStyles.typography.fontSize.sm,
  fontWeight: 600,
  marginBottom: 6,
  color: TavariStyles.colors.gray700,
};

const inputStyle = {
  width: '100%',
  maxWidth: 'min(100%, 560px)',
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  fontSize: TavariStyles.typography.fontSize.sm,
  marginBottom: 12,
  boxSizing: 'border-box',
};

const textareaStyle = {
  ...inputStyle,
  maxWidth: '100%',
  minHeight: 120,
  fontFamily: TavariStyles.typography.fontFamilyMono,
  fontSize: 13,
};

const PowerBankDashboard = () => {
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'admin', 'owner'],
    requireBusiness: true,
    componentName: 'PowerBankDashboard',
  });

  const { isEnabled: moduleEnabled, loading: moduleLoading } = useModuleEnabled('power_bank');

  const [activeTab, setActiveTab] = useState('settings');
  const [loading, setLoading] = useState(false);
  const [lastJson, setLastJson] = useState('');

  const [vendorShopId, setVendorShopId] = useState('');
  const [settingsNotes, setSettingsNotes] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);

  const [webhookRows, setWebhookRows] = useState([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);

  const baseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const rentCallbackUrl = useMemo(() => {
    if (!baseUrl || !auth.selectedBusinessId) return '';
    const u = new URL(`${baseUrl.replace(/\/$/, '')}/functions/v1/chargenow-rent-callback`);
    u.searchParams.set('business_id', auth.selectedBusinessId);
    return u.toString();
  }, [baseUrl, auth.selectedBusinessId]);

  const cabinetEventUrl = useMemo(() => {
    if (!baseUrl || !auth.selectedBusinessId) return '';
    const u = new URL(`${baseUrl.replace(/\/$/, '')}/functions/v1/chargenow-cabinet-event`);
    u.searchParams.set('business_id', auth.selectedBusinessId);
    return u.toString();
  }, [baseUrl, auth.selectedBusinessId]);

  const loadBusinessSettings = useCallback(async () => {
    if (!auth.selectedBusinessId) return;
    setSettingsLoading(true);
    try {
      const { data, error } = await supabase
        .from('business_chargenow_settings')
        .select('vendor_shop_id, notes')
        .eq('business_id', auth.selectedBusinessId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      setVendorShopId(data?.vendor_shop_id || '');
      setSettingsNotes(data?.notes || '');
    } catch (e) {
      console.warn(e);
      if (!String(e.message || '').includes('does not exist')) {
        toast.error(e.message || 'Could not load Power Bank settings');
      }
    } finally {
      setSettingsLoading(false);
    }
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    loadBusinessSettings();
  }, [loadBusinessSettings]);

  const saveBusinessSettings = async () => {
    if (!auth.selectedBusinessId) return;
    setSettingsLoading(true);
    try {
      const { error } = await supabase.from('business_chargenow_settings').upsert(
        {
          business_id: auth.selectedBusinessId,
          vendor_shop_id: vendorShopId.trim() || null,
          notes: settingsNotes.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'business_id' },
      );
      if (error) throw error;
      toast.success('Saved');
    } catch (e) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSettingsLoading(false);
    }
  };

  const loadWebhooks = useCallback(async () => {
    if (!auth.selectedBusinessId) return;
    setWebhooksLoading(true);
    try {
      const { data, error } = await supabase
        .from('chargenow_webhook_events')
        .select('id, event_source, payload, created_at')
        .eq('business_id', auth.selectedBusinessId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setWebhookRows(data || []);
    } catch (e) {
      console.warn(e);
      if (!String(e.message || '').includes('does not exist')) {
        toast.error(e.message || 'Could not load webhook log');
      }
      setWebhookRows([]);
    } finally {
      setWebhooksLoading(false);
    }
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    if (activeTab === 'webhooks' && auth.selectedBusinessId) loadWebhooks();
  }, [activeTab, auth.selectedBusinessId, loadWebhooks]);

  const copyText = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed');
    }
  };

  const run = async (payload) => {
    if (!auth.isReady) return;
    if (!auth.selectedBusinessId) {
      toast.error('Select a business');
      return;
    }
    setLoading(true);
    setLastJson('');
    try {
      const out = await chargenowInvoke(auth.selectedBusinessId, payload);
      setLastJson(formatChargenowResponse(out));
      if (out?.error) toast.error(String(out.error));
      else if (out?.ok === false) toast.error(`Vendor HTTP ${out.status || '?'}`);
      else toast.success('OK');
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Request failed');
      setLastJson(formatChargenowResponse({ error: e?.message }));
    } finally {
      setLoading(false);
    }
  };

  /* ---- form state ---- */
  const [deviceId, setDeviceId] = useState('');
  const [tradeNo, setTradeNo] = useState('');
  const [callbackURL, setCallbackURL] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [coordType, setCoordType] = useState('GCJ-02');
  const [zoomLevel, setZoomLevel] = useState('5');
  const [cabinetLookupId, setCabinetLookupId] = useState('');
  const [bindQr, setBindQr] = useState('');
  const [bindShopId, setBindShopId] = useState('');
  const [slotNum, setSlotNum] = useState('1');
  const [operationType, setOperationType] = useState('pop');
  const [rentOrderId, setRentOrderId] = useState('');

  const [shopDetailId, setShopDetailId] = useState('');
  const [shopUpdateJson, setShopUpdateJson] = useState(
    '{\n  "pNewid": "",\n  "pName": "",\n  "pJingdu": "",\n  "pWeidu": "",\n  "pAddress": ""\n}',
  );

  const [pricePageJson, setPricePageJson] = useState(
    '{\n  "size": 10,\n  "current": 1,\n  "shopId": "",\n  "name": ""\n}',
  );
  const [priceId, setPriceId] = useState('');
  const [priceSaveJson, setPriceSaveJson] = useState(
    '{\n  "name": "Strategy",\n  "type": 1,\n  "customType": 0,\n  "depositAmount": 0,\n  "timeoutAmount": 0,\n  "timeoutDay": 0,\n  "freeMinutes": 0,\n  "price": 0,\n  "priceTime": 1,\n  "priceUnit": 0,\n  "dailyMaxPrice": 0\n}',
  );
  const [priceDeleteIds, setPriceDeleteIds] = useState('');
  const [bindPriceId, setBindPriceId] = useState('');
  const [bindCustomType, setBindCustomType] = useState('0');

  const [bindAdJson, setBindAdJson] = useState(
    '{\n  "cabinetIdList": [],\n  "isRestart": false,\n  "adConfigList": []\n}',
  );
  const [eventPushJson, setEventPushJson] = useState(
    '{\n  "pushUrl": "",\n  "eventSubscriptions": []\n}',
  );

  React.useEffect(() => {
    if (rentCallbackUrl && !callbackURL) setCallbackURL(rentCallbackUrl);
  }, [rentCallbackUrl, callbackURL]);

  React.useEffect(() => {
    if (vendorShopId && !shopDetailId) setShopDetailId(vendorShopId);
  }, [vendorShopId, shopDetailId]);

  const parseJsonField = (text, label) => {
    try {
      return JSON.parse(text);
    } catch {
      toast.error(`${label}: invalid JSON`);
      return null;
    }
  };

  const renderBody = () => {
    if (!auth.isReady || moduleLoading) {
      return (
        <div style={shellStyles}>
          <p style={{ color: TavariStyles.colors.gray600 }}>Loading…</p>
        </div>
      );
    }

    if (!moduleEnabled) {
      return (
        <div style={shellStyles}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <div style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Power Bank module is off</h2>
              <p style={{ color: TavariStyles.colors.gray600 }}>
                Enable <strong>Power Bank</strong> under Tavari Modules for this business to use ChargeNow tools.
              </p>
              <Link
                to="/dashboard/modules"
                style={{ color: TavariStyles.colors.primary, fontWeight: 600 }}
              >
                Open Tavari Modules
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={shellStyles}>
        <TavariModuleHeader
          title="Power Bank"
          description="Manage ChargeNow shops, cabinets, rent orders, pricing, screen ads, and webhook logs. Authenticate the vendor API via Edge Function secrets (CHARGENOW_API_USERNAME, CHARGENOW_API_PASSWORD); optional CHARGENOW_BASE_URL."
          actionLabel="Setup & webhooks"
          actionIcon={<FiSettings size={18} />}
          onAction={() => setActiveTab('settings')}
        />
        <TavariTabSystemComponent
          tabs={POWER_BANK_TABS}
          mode="state"
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id)}
          ariaLabel="Power Bank module"
        />

        <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 24 }}>
        {activeTab === 'settings' && (
          <>
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Vendor shop mapping</div>
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
                Save your ChargeNow <strong>shop id</strong> for shortcuts on other tabs. Stored per Tavari business.
              </p>
              <label style={labelStyle}>Vendor shop ID</label>
              <input
                style={inputStyle}
                value={vendorShopId}
                onChange={(e) => setVendorShopId(e.target.value)}
                disabled={settingsLoading}
              />
              <label style={labelStyle}>Notes (internal)</label>
              <textarea
                style={textareaStyle}
                minHeight={60}
                value={settingsNotes}
                onChange={(e) => setSettingsNotes(e.target.value)}
                disabled={settingsLoading}
              />
              <PillButton disabled={settingsLoading} onClick={saveBusinessSettings}>
                Save settings
              </PillButton>
            </div>

            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Webhook URLs (include business scope)</div>
              <p style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                Register these in ChargeNow. Query <code>business_id</code> ties events to this Tavari business in{' '}
                <strong>Webhook log</strong>.
              </p>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, marginBottom: 8 }}>
                <strong>Rent callback</strong>{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => copyText('Rent callback', rentCallbackUrl)}
                >
                  <FiCopy />
                </button>
              </div>
              <pre
                style={{
                  ...inputStyle,
                  maxWidth: '100%',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  background: TavariStyles.colors.gray50,
                }}
              >
                {rentCallbackUrl || 'Select business + set VITE_SUPABASE_URL'}
              </pre>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, marginBottom: 8 }}>
                <strong>Cabinet event push</strong>{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => copyText('Cabinet event URL', cabinetEventUrl)}
                >
                  <FiCopy />
                </button>
              </div>
              <pre
                style={{
                  ...inputStyle,
                  maxWidth: '100%',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  background: TavariStyles.colors.gray50,
                }}
              >
                {cabinetEventUrl || 'Select business + set VITE_SUPABASE_URL'}
              </pre>
            </div>

            <ModuleDeactivationPanel moduleKey="power_bank" />
          </>
        )}

        {activeTab === 'device' && (
          <div style={cardStyle}>
            <label style={labelStyle}>deviceId (SN or ID)</label>
            <input
              style={inputStyle}
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="e.g. BJH02347"
            />
            <PillButton disabled={loading} onClick={() => run({ action: 'rentCabinetQuery', deviceId })}>
              Get device info
            </PillButton>
          </div>
        )}

        {activeTab === 'order' && (
          <div style={cardStyle}>
            <label style={labelStyle}>tradeNo</label>
            <input
              style={inputStyle}
              value={tradeNo}
              onChange={(e) => setTradeNo(e.target.value)}
              placeholder="Order / trade number"
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <PillButton disabled={loading} onClick={() => run({ action: 'rentOrderDetail', tradeNo })}>
                Order detail
              </PillButton>
              <PillButton
                variant="danger"
                disabled={loading}
                onClick={() => run({ action: 'rentOrderClose', tradeNo })}
              >
                Mark completed (close)
              </PillButton>
            </div>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <label style={labelStyle}>Create rent order — deviceId</label>
            <input
              style={inputStyle}
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Cabinet device id"
            />
            <label style={labelStyle}>callbackURL</label>
            <input
              style={inputStyle}
              value={callbackURL}
              onChange={(e) => setCallbackURL(e.target.value)}
              placeholder={rentCallbackUrl}
            />
            <PillButton
              disabled={loading}
              onClick={() => run({ action: 'rentOrderCreate', deviceId, callbackURL })}
            >
              Create rent order
            </PillButton>
          </div>
        )}

        {activeTab === 'nearby' && (
          <div style={cardStyle}>
            <label style={labelStyle}>Latitude</label>
            <input style={inputStyle} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="22.989442" />
            <label style={labelStyle}>Longitude</label>
            <input style={inputStyle} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="113.327761" />
            <label style={labelStyle}>coordType</label>
            <input style={inputStyle} value={coordType} onChange={(e) => setCoordType(e.target.value)} />
            <label style={labelStyle}>zoomLevel (1–8)</label>
            <input style={inputStyle} value={zoomLevel} onChange={(e) => setZoomLevel(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() => run({ action: 'rentCabinetList', lat, lng, coordType, zoomLevel })}
            >
              List cabinets
            </PillButton>
          </div>
        )}

        {activeTab === 'cabinet' && (
          <div style={cardStyle}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Inventory</div>
            <PillButton disabled={loading} onClick={() => run({ action: 'cabinetGetAllDevice' })}>
              Query all devices
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <label style={labelStyle}>Cabinet id / QR</label>
            <input
              style={inputStyle}
              value={cabinetLookupId}
              onChange={(e) => setCabinetLookupId(e.target.value)}
              placeholder="e.g. SAB02371"
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <PillButton
                disabled={loading}
                onClick={() => run({ action: 'cabinetDetail', cabinetId: cabinetLookupId })}
              >
                Cabinet detail
              </PillButton>
              <PillButton
                disabled={loading}
                onClick={() => run({ action: 'cabinetBatteryList', cabinetId: cabinetLookupId })}
              >
                Battery list
              </PillButton>
              <PillButton
                disabled={loading}
                onClick={() => run({ action: 'cabinetSlotList', cabinetId: cabinetLookupId })}
              >
                Slot list
              </PillButton>
            </div>
            <label style={labelStyle}>Shop id (devices by shop)</label>
            <input
              style={inputStyle}
              value={shopDetailId || vendorShopId}
              onChange={(e) => setShopDetailId(e.target.value)}
              placeholder={vendorShopId || 'ChargeNow shop id'}
            />
            <PillButton
              disabled={loading}
              onClick={() => run({ action: 'cabinetGetDeviceByShopId', shopid: shopDetailId || vendorShopId })}
            >
              Devices by shop
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Bind cabinet → shop</div>
            <label style={labelStyle}>QR / device id</label>
            <input style={inputStyle} value={bindQr} onChange={(e) => setBindQr(e.target.value)} />
            <label style={labelStyle}>New shop id</label>
            <input style={inputStyle} value={bindShopId} onChange={(e) => setBindShopId(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() => run({ action: 'cabinetBind2Shop', qrcode: bindQr, newshopid: bindShopId })}
            >
              Bind to shop
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Operations</div>
            <label style={labelStyle}>slotNum</label>
            <input style={inputStyle} value={slotNum} onChange={(e) => setSlotNum(e.target.value)} />
            <label style={labelStyle}>operationType</label>
            <input
              style={inputStyle}
              value={operationType}
              onChange={(e) => setOperationType(e.target.value)}
              placeholder="pop, restart, lock, unlock, ..."
            />
            <PillButton
              disabled={loading}
              onClick={() =>
                run({
                  action: 'cabinetOperation',
                  cabinetid: cabinetLookupId,
                  slotNum: Number(slotNum),
                  operationType,
                  reason: '',
                })
              }
            >
              Device operation
            </PillButton>
            <div style={{ marginTop: 12 }}>
              <PillButton
                disabled={loading}
                onClick={() =>
                  run({
                    action: 'cabinetEjectByRepair',
                    cabinetid: cabinetLookupId,
                    slotNum: slotNum === '' ? 0 : Number(slotNum),
                  })
                }
              >
                Eject by repair
              </PillButton>
            </div>
            <label style={{ ...labelStyle, marginTop: 16 }}>rentOrderId (eject by rent)</label>
            <input style={inputStyle} value={rentOrderId} onChange={(e) => setRentOrderId(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() =>
                run({
                  action: 'cabinetEjectByRent',
                  cabinetid: cabinetLookupId,
                  rentOrderId,
                  slotNum: Number(slotNum),
                })
              }
            >
              Eject by rent
            </PillButton>
          </div>
        )}

        {activeTab === 'shop' && (
          <div style={cardStyle}>
            <label style={labelStyle}>Shop id</label>
            <input
              style={inputStyle}
              value={shopDetailId}
              onChange={(e) => setShopDetailId(e.target.value)}
              placeholder={vendorShopId || 'ChargeNow shop id'}
            />
            <PillButton disabled={loading} onClick={() => run({ action: 'shopDetail', shopid: shopDetailId })}>
              Get shop detail
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <label style={labelStyle}>Update shop (JSON — CdbShopEntity)</label>
            <textarea style={textareaStyle} value={shopUpdateJson} onChange={(e) => setShopUpdateJson(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() => {
                const payload = parseJsonField(shopUpdateJson, 'Shop');
                if (!payload) return;
                run({ action: 'shopUpdate', payload });
              }}
            >
              PUT shop/update
            </PillButton>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div style={cardStyle}>
            <label style={labelStyle}>Price strategy page query (JSON)</label>
            <textarea style={textareaStyle} value={pricePageJson} onChange={(e) => setPricePageJson(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() => {
                const payload = parseJsonField(pricePageJson, 'Page query');
                if (!payload) return;
                run({ action: 'priceStrategyPage', payload });
              }}
            >
              POST priceStrategy/page
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <label style={labelStyle}>priceId (detail)</label>
            <input style={inputStyle} value={priceId} onChange={(e) => setPriceId(e.target.value)} />
            <PillButton disabled={loading} onClick={() => run({ action: 'priceStrategyDetail', priceId })}>
              GET priceStrategy/detail
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <label style={labelStyle}>Create / update (JSON — OpenPriceStrategySaveDto)</label>
            <textarea style={{ ...textareaStyle, minHeight: 200 }} value={priceSaveJson} onChange={(e) => setPriceSaveJson(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() => {
                const payload = parseJsonField(priceSaveJson, 'Save DTO');
                if (!payload) return;
                run({ action: 'priceStrategySave', payload });
              }}
            >
              POST saveOrUpdate
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <label style={labelStyle}>Delete — numeric ids comma-separated</label>
            <input
              style={inputStyle}
              value={priceDeleteIds}
              onChange={(e) => setPriceDeleteIds(e.target.value)}
              placeholder="1, 2, 3"
            />
            <PillButton
              variant="danger"
              disabled={loading}
              onClick={() => {
                const ids = priceDeleteIds
                  .split(/[\s,]+/)
                  .map((s) => parseInt(s.trim(), 10))
                  .filter((n) => !Number.isNaN(n));
                if (!ids.length) {
                  toast.error('Enter at least one id');
                  return;
                }
                run({ action: 'priceStrategyDelete', ids });
              }}
            >
              POST delete
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <label style={labelStyle}>Bind shop — priceId</label>
            <input style={inputStyle} value={bindPriceId} onChange={(e) => setBindPriceId(e.target.value)} />
            <label style={labelStyle}>customType (0 universal / 1 POS)</label>
            <input style={inputStyle} value={bindCustomType} onChange={(e) => setBindCustomType(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() =>
                run({
                  action: 'priceStrategyBindShop',
                  payload: {
                    shopId: vendorShopId || shopDetailId,
                    priceId: Number(bindPriceId),
                    customType: Number(bindCustomType),
                  },
                })
              }
            >
              Bind shop to strategy
            </PillButton>
            <PillButton
              disabled={loading}
              onClick={() =>
                run({
                  action: 'priceStrategyUnbindShop',
                  payload: {
                    shopId: vendorShopId || shopDetailId,
                    customType: Number(bindCustomType),
                  },
                })
              }
            >
              Unbind shop
            </PillButton>
          </div>
        )}

        {activeTab === 'ads' && (
          <div style={cardStyle}>
            <label style={labelStyle}>POST cabinet/bindAd (OpenAdPublishDTO JSON)</label>
            <textarea style={{ ...textareaStyle, minHeight: 180 }} value={bindAdJson} onChange={(e) => setBindAdJson(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() => {
                const payload = parseJsonField(bindAdJson, 'bindAd');
                if (!payload) return;
                run({ action: 'cabinetBindAd', payload });
              }}
            >
              Publish ads
            </PillButton>
            <hr style={{ border: 0, borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: '20px 0' }} />
            <PillButton disabled={loading} onClick={() => run({ action: 'eventPushConfigGet' })}>
              GET event push config
            </PillButton>
            <label style={{ ...labelStyle, marginTop: 16 }}>POST event push config (JSON)</label>
            <textarea style={{ ...textareaStyle, minHeight: 160 }} value={eventPushJson} onChange={(e) => setEventPushJson(e.target.value)} />
            <PillButton
              disabled={loading}
              onClick={() => {
                const payload = parseJsonField(eventPushJson, 'Event push');
                if (!payload) return;
                run({ action: 'eventPushConfig', payload });
              }}
            >
              Save event push config
            </PillButton>
          </div>
        )}

        {activeTab === 'webhooks' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>Recent events (this business)</span>
              <PillButton disabled={webhooksLoading} onClick={loadWebhooks}>
                Refresh
              </PillButton>
            </div>
            <p style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
              Requires DB migration applied and webhook URLs using the <code>business_id</code> query form above.
            </p>
            {webhooksLoading ? (
              <p>Loading…</p>
            ) : webhookRows.length === 0 ? (
              <p style={{ color: TavariStyles.colors.gray500 }}>No events recorded yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: `1px solid ${TavariStyles.colors.gray300}` }}>
                      <th style={{ padding: 8 }}>When</th>
                      <th style={{ padding: 8 }}>Source</th>
                      <th style={{ padding: 8 }}>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhookRows.map((row) => (
                      <tr key={row.id} style={{ borderBottom: `1px solid ${TavariStyles.colors.gray200}` }}>
                        <td style={{ padding: 8, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                          {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: 8, verticalAlign: 'top' }}>{row.event_source}</td>
                        <td style={{ padding: 8, verticalAlign: 'top' }}>
                          <pre
                            style={{
                              margin: 0,
                              fontSize: 11,
                              maxHeight: 120,
                              overflow: 'auto',
                              background: TavariStyles.colors.gray50,
                              padding: 8,
                              borderRadius: 6,
                            }}
                          >
                            {JSON.stringify(row.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {lastJson && (
          <div style={cardStyle}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Last API response</div>
            <pre
              style={{
                margin: 0,
                fontSize: 13,
                overflow: 'auto',
                maxHeight: 420,
                background: TavariStyles.colors.gray900,
                color: TavariStyles.colors.gray100,
                padding: 14,
                borderRadius: 8,
              }}
            >
              {lastJson}
            </pre>
          </div>
        )}
        </div>
      </div>
    );
  };

  return (
    <POSAuthWrapper
      requiredRoles={['manager', 'admin', 'owner']}
      requireBusiness
      componentName="PowerBankDashboard"
    >
      {renderBody()}
    </POSAuthWrapper>
  );
};

export default PowerBankDashboard;
