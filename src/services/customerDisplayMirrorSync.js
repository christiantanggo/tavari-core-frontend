/**
 * POS → customer display: debounced push to Supabase via push_customer_display_mirror RPC.
 * Server normalizes payload (drops stale sale_complete / receipt_navigation when cart has line items).
 * Same-browser popups still use localStorage keys; this module only ships them to the mirror.
 */
import { supabase } from '../supabaseClient';

/** Must match LS_CUSTOMER_DISPLAY_POS_LOCKED in customerDisplayLocalState.js */
const LS_POS_LOCKED = 'tavari_customer_display_pos_locked';

const DEBOUNCE_MS = 150;
const HEARTBEAT_PUSH_MS = 75 * 1000;
let pushTimer = null;
const lastPayloadByBusiness = new Map();
const lastPushAtByBusiness = new Map();

function readPosLockedFromStorage() {
  try {
    return localStorage.getItem(LS_POS_LOCKED) === '1';
  } catch {
    return false;
  }
}

export function scheduleCustomerDisplayMirrorPush(businessId) {
  if (!businessId || typeof window === 'undefined') return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushCustomerDisplayMirror(businessId);
  }, DEBOUNCE_MS);
}

/** Cancel debounce and push immediately (cart clear, route leave, heartbeat). */
export function flushCustomerDisplayMirrorPush(businessId, options = {}) {
  if (!businessId || typeof window === 'undefined') return;
  clearTimeout(pushTimer);
  pushTimer = null;
  void pushCustomerDisplayMirror(businessId, options);
}

function readMirrorPayload() {
  return {
    cart: localStorage.getItem('tavari_customer_display_cart'),
    payment: localStorage.getItem('tavari_customer_display_payment'),
    sale_complete: localStorage.getItem('tavari_customer_display_sale_complete'),
    receipt_navigation: localStorage.getItem('tavari_customer_display_receipt_navigation'),
    pos_locked: readPosLockedFromStorage() ? '1' : null
  };
}

async function pushCustomerDisplayMirror(businessId, options = {}) {
  try {
    const payload = readMirrorPayload();
    const payloadSignature = JSON.stringify(payload);
    const lastPayloadSignature = lastPayloadByBusiness.get(businessId);
    const lastPushAt = lastPushAtByBusiness.get(businessId) || 0;
    const heartbeatDue = Date.now() - lastPushAt >= HEARTBEAT_PUSH_MS;

    if (payloadSignature === lastPayloadSignature && !options.forceHeartbeat && !heartbeatDue) {
      return;
    }

    let {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed?.session;
    }
    if (!session) {
      console.warn('[customerDisplayMirrorSync] No session — customer display mirror not updated');
      return;
    }

    const { error: rpcError } = await supabase.rpc('push_customer_display_mirror', {
      p_business_id: businessId,
      p_payload: payload
    });

    if (rpcError) {
      const msg = (rpcError.message || '').toLowerCase();
      const code = rpcError.code || '';
      const fnMissing =
        code === 'PGRST202' ||
        code === '42883' ||
        msg.includes('could not find') ||
        msg.includes('does not exist');
      if (!fnMissing) {
        console.warn('[customerDisplayMirrorSync]', rpcError.message);
        return;
      }
      const { error: upError } = await supabase
        .from('pos_customer_display_mirror')
        .upsert(
          {
            business_id: businessId,
            payload,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'business_id' }
        );
      if (upError) {
        console.warn('[customerDisplayMirrorSync]', upError.message);
        return;
      }
    }

    lastPayloadByBusiness.set(businessId, payloadSignature);
    lastPushAtByBusiness.set(businessId, Date.now());
  } catch (e) {
    console.warn('[customerDisplayMirrorSync]', e?.message || e);
  }
}
