/* ============================================================
   da Cecot — Uber Direct client.

   Env (Vercel → Settings → Environment Variables); with none of them set the
   module reports "not configured" and the admin button says so — nothing is
   ever dispatched by accident:
     UBER_DIRECT_CLIENT_ID      from Uber Direct dashboard → Developer
     UBER_DIRECT_CLIENT_SECRET
     UBER_DIRECT_CUSTOMER_ID    the organisation / customer id (uuid or cus_…)
     UBER_DIRECT_SANDBOX        "true" while testing: deliveries get a robo-courier
     UBER_DIRECT_API_BASE_URL   optional, default https://api.uber.com
     UBER_DIRECT_AUTH_BASE_URL  optional, default https://auth.uber.com

   One delivery per customer. Uber groups deliveries that share a pickup and a
   window onto one courier and reports batch_id + dropoff_sequence_number; the
   merchant cannot ask for a multi-stop delivery, so we never try. Each stop is
   quoted (fee locked for 15 minutes) and created with that quote id.

   Read from developer.uber.com/docs/deliveries/api-reference/daas, 2026-10-24.
   ============================================================ */

const R = require('../orders/reservations');

const SHOP = {
  name: 'da Cecot Food',
  street: '10430 82 Ave NW',
  postal: 'T6E 2A1',
  phone: '+18258884218',
  storeId: 'dacecot-whyte-ave',
  notes: 'Pasta shop on Whyte Ave at 104 St. Ask for the delivery bags at the counter.'
};

function env(k, d) { const v = process.env[k]; return v == null || String(v).trim() === '' ? d : String(v).trim(); }
function configured() { return !!(env('UBER_DIRECT_CLIENT_ID') && env('UBER_DIRECT_CLIENT_SECRET') && env('UBER_DIRECT_CUSTOMER_ID')); }
function sandbox() { return /^(1|true|yes)$/i.test(env('UBER_DIRECT_SANDBOX', '')); }
function apiBase() { return env('UBER_DIRECT_API_BASE_URL', 'https://api.uber.com').replace(/\/$/, ''); }
function authBase() { return env('UBER_DIRECT_AUTH_BASE_URL', 'https://auth.uber.com').replace(/\/$/, ''); }

/* ---------- OAuth client-credentials token, cached per process ---------- */
let cached = null;      // { token, expiresAt }
let inFlight = null;
async function getToken(fetchImpl) {
  const f = fetchImpl || fetch;
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (!inFlight) {
    inFlight = (async () => {
      const form = new URLSearchParams({
        client_id: env('UBER_DIRECT_CLIENT_ID'), client_secret: env('UBER_DIRECT_CLIENT_SECRET'),
        grant_type: 'client_credentials', scope: env('UBER_DIRECT_SCOPE', 'eats.deliveries')
      });
      const r = await f(authBase() + '/oauth/v2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch (e) {}
      if (!r.ok || !json || !json.access_token) {
        throw new Error('Uber Direct sign-in failed (' + r.status + ')' + (json && json.error ? ': ' + json.error : ''));
      }
      const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600;
      cached = { token: json.access_token, expiresAt: Date.now() + ttl * 1000 - 60 * 1000 };
      return cached.token;
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
}
function invalidateToken() { cached = null; }

async function request(method, path, body, fetchImpl) {
  const f = fetchImpl || fetch;
  const attempt = async () => {
    const token = await getToken(f);
    const init = { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return f(apiBase() + path, init);
  };
  let r = await attempt();
  if (r.status === 401) { invalidateToken(); r = await attempt(); }
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (json && (json.message || json.code || json.error)) || ('HTTP ' + r.status);
    const err = new Error('Uber Direct ' + method + ' ' + path.replace(/\/customers\/[^/]+/, '/customers/…') + ': ' + msg);
    err.status = r.status; err.body = json;
    throw err;
  }
  return json || {};
}

function customerPath(rest) { return '/v1/customers/' + encodeURIComponent(env('UBER_DIRECT_CUSTOMER_ID')) + rest; }
async function createQuote(body, fetchImpl) { return request('POST', customerPath('/delivery_quotes'), body, fetchImpl); }
async function createDelivery(body, fetchImpl) { return request('POST', customerPath('/deliveries'), body, fetchImpl); }
async function getDelivery(id, fetchImpl) { return request('GET', customerPath('/deliveries/' + encodeURIComponent(id)), undefined, fetchImpl); }

/* ---------- pure payload builders (tested) ---------- */
function addressJson(street, postal) {
  return JSON.stringify({ street_address: [String(street)], city: 'Edmonton', state: 'AB', zip_code: String(postal), country: 'CA' });
}
function phoneE164(s) {
  const digits = String(s == null ? '' : s).replace(/[^\d]/g, '');
  if (!digits) return null;
  return '+' + (digits.length === 10 ? '1' + digits : digits);
}
function iso(dateKey, minutes) { return new Date(R.edmontonInstant(dateKey, minutes)).toISOString(); }

function windows(order, settings) {
  const d = order.details || {};
  const dateKey = d.delivery_date;
  return {
    pickup_ready_dt: iso(dateKey, settings.pickupReady),
    pickup_deadline_dt: iso(dateKey, settings.pickupDeadline),
    dropoff_ready_dt: iso(dateKey, Math.max(settings.pickupDeadline, settings.windowStart)),
    dropoff_deadline_dt: iso(dateKey, Math.max(settings.windowEnd, settings.windowStart + 20))
  };
}

function buildQuoteRequest(order, settings) {
  const d = order.details || {};
  return Object.assign({
    pickup_address: addressJson(SHOP.street, SHOP.postal),
    dropoff_address: addressJson(d.delivery_address, d.delivery_postal),
    pickup_phone_number: SHOP.phone,
    dropoff_phone_number: phoneE164(order.phone) || SHOP.phone,
    manifest_total_value: Math.max(0, Number(order.amount_cents) || 0),
    external_store_id: SHOP.storeId
  }, windows(order, settings));
}

function buildDeliveryRequest(order, settings, quoteId) {
  const d = order.details || {};
  const qty = Math.max(1, parseInt(d.quantity, 10) || 1);
  const body = Object.assign({
    pickup_name: SHOP.name,
    pickup_business_name: SHOP.name,
    pickup_address: addressJson(SHOP.street, SHOP.postal),
    pickup_phone_number: SHOP.phone,
    pickup_notes: SHOP.notes,
    dropoff_name: String(order.name || 'Customer').slice(0, 100),
    dropoff_address: addressJson(d.delivery_address, d.delivery_postal),
    dropoff_phone_number: phoneE164(order.phone) || SHOP.phone,
    dropoff_notes: String(d.notes || '').slice(0, 280) || undefined,
    manifest_items: [{ name: String(d.item || 'Pasta shop order').slice(0, 100), quantity: qty, size: 'small' }],
    manifest_reference: String(order.id).slice(0, 8).toUpperCase(),
    manifest_total_value: Math.max(0, Number(order.amount_cents) || 0),
    deliverable_action: 'deliverable_action_meet_at_door',
    undeliverable_action: 'return',
    external_store_id: SHOP.storeId,
    external_id: String(order.id),
    idempotency_key: 'dacecot-' + String(order.id)
  }, windows(order, settings));
  if (quoteId) body.quote_id = quoteId;
  if (sandbox()) body.test_specifications = { robo_courier_specification: { mode: 'auto' } };
  Object.keys(body).forEach((k) => { if (body[k] === undefined) delete body[k]; });
  return body;
}

/* The slice of Uber's delivery object we keep on the order. */
function summarize(resp, prev) {
  resp = resp || {};
  const c = resp.courier || null;
  return Object.assign({}, prev || {}, {
    delivery_id: resp.id || (prev && prev.delivery_id) || null,
    quote_id: resp.quote_id || (prev && prev.quote_id) || null,
    fee_cents: Number.isFinite(Number(resp.fee)) ? Number(resp.fee) : (prev && prev.fee_cents) || null,
    batch_id: resp.batch_id || (prev && prev.batch_id) || null,
    short_batch_id: resp.short_batch_id || (resp.batch_id ? String(resp.batch_id).slice(-6).toUpperCase() : (prev && prev.short_batch_id) || null),
    sequence: resp.dropoff_sequence_number != null ? Number(resp.dropoff_sequence_number) : (prev && prev.sequence) || null,
    status: resp.status || (prev && prev.status) || 'pending',
    tracking_url: resp.tracking_url || (prev && prev.tracking_url) || null,
    dropoff_eta: resp.dropoff_eta || (prev && prev.dropoff_eta) || null,
    courier: c ? { name: c.name || null, phone: c.phone_number || null, vehicle: c.vehicle_type || null } : (prev && prev.courier) || null,
    live_mode: resp.live_mode != null ? !!resp.live_mode : (prev ? prev.live_mode : null),
    updated_at: new Date().toISOString()
  });
}

/* Quote, then create, one order. Throws with a readable message. */
async function dispatchOrder(order, settings, fetchImpl) {
  const q = await createQuote(buildQuoteRequest(order, settings), fetchImpl);
  const resp = await createDelivery(buildDeliveryRequest(order, settings, q && q.id), fetchImpl);
  const info = summarize(resp, null);
  if (info.fee_cents == null && q && Number.isFinite(Number(q.fee))) info.fee_cents = Number(q.fee);
  info.dispatched_at = new Date().toISOString();
  return info;
}

async function refreshOrder(prev, fetchImpl) {
  if (!prev || !prev.delivery_id) return prev;
  const resp = await getDelivery(prev.delivery_id, fetchImpl);
  return summarize(resp, prev);
}

const STATUS_LABEL = {
  pending: 'Booked', pickup: 'Courier heading to shop', pickup_complete: 'Picked up', dropoff: 'Driving to door',
  delivered: 'Delivered', canceled: 'Cancelled', returned: 'Returned', ongoing: 'On the road'
};
function statusLabel(s) { return STATUS_LABEL[s] || (s ? String(s).replace(/_/g, ' ') : 'Booked'); }

module.exports = {
  SHOP, configured, sandbox, getToken, invalidateToken, request, createQuote, createDelivery, getDelivery,
  addressJson, phoneE164, buildQuoteRequest, buildDeliveryRequest, summarize, dispatchOrder, refreshOrder, statusLabel
};
