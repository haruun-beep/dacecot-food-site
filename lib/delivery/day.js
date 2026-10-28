/* ============================================================
   da Cecot — a delivery day as the kitchen sees it. Pure functions.

   An order is a delivery order when details.fulfillment === 'delivery'; its day
   is details.delivery_date (YYYY-MM-DD). Packing and dispatch state live on
   the order (details.packed, details.uber), so a "run" is simply the set of
   dispatched orders on a day — there is no second table to drift from.
   ============================================================ */

const R = require('../orders/reservations');
const zones = require('./zones');
const uber = require('./uber');

function isDeliveryOrder(o) {
  const d = (o && o.details) || {};
  return o && o.type === 'order' && d.fulfillment === 'delivery' && !!d.delivery_date && !d.cancelled;
}

function ordersForDay(list, dateKey) {
  return (list || []).filter((o) => isDeliveryOrder(o) && o.details.delivery_date === dateKey)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function compact(o) {
  const d = o.details || {};
  return {
    id: o.id,
    ref: String(o.id).slice(0, 8).toUpperCase(),
    name: o.name, phone: o.phone, email: o.email,
    item: d.item || '', quantity: d.quantity || '1', notes: d.notes || '', allergies: d.allergies || '',
    address: d.delivery_address || '', postal: d.delivery_postal || '', zone: d.delivery_zone || '',
    amount_cents: o.amount_cents, payment_status: o.payment_status,
    delivery_fee_cents: Number(d.delivery_fee_cents) || 0,
    packed: !!d.packed, packed_at: d.packed_at || null,
    uber: d.uber || null
  };
}

/* May the driver be called for these orders? */
function canDispatch(orders) {
  if (!orders.length) return { ok: false, reason: 'No delivery orders on this day.' };
  if (orders.some((o) => o.details && o.details.uber && o.details.uber.delivery_id)) return { ok: false, reason: 'The driver has already been called for this day.' };
  const unpacked = orders.filter((o) => !(o.details && o.details.packed));
  if (unpacked.length) return { ok: false, reason: unpacked.length + ' of ' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + ' not packed yet.' };
  return { ok: true };
}

function runOf(orders) {
  const stops = orders.filter((o) => o.details && o.details.uber && o.details.uber.delivery_id).map(compact)
    .sort((a, b) => (a.uber.sequence || 99) - (b.uber.sequence || 99) || String(a.uber.dispatched_at || '').localeCompare(String(b.uber.dispatched_at || '')));
  if (!stops.length) return null;
  const charged = stops.reduce((s, x) => s + x.delivery_fee_cents, 0);
  const uberCents = stops.reduce((s, x) => s + (Number(x.uber.fee_cents) || 0), 0);
  const batches = Array.from(new Set(stops.map((s) => s.uber.short_batch_id).filter(Boolean)));
  const courier = (stops.find((s) => s.uber.courier && s.uber.courier.name) || {}).uber;
  return {
    stops: stops.map((s) => Object.assign({}, s, { statusLabel: uber.statusLabel(s.uber.status) })),
    batches,
    courier: courier ? courier.courier : null,
    chargedCents: charged, uberCents: uberCents, marginCents: charged - uberCents,
    delivered: stops.filter((s) => s.uber.status === 'delivered').length,
    complete: stops.every((s) => ['delivered', 'canceled', 'returned'].includes(s.uber.status))
  };
}

/* Seven days from weekStart (an Edmonton date key). */
function week(list, settings, weekStartKey) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const key = R.addDaysISO(weekStartKey, i);
    const orders = ordersForDay(list, key);
    const z = zones.zonesForDay(key, settings);
    const run = runOf(orders);
    const gate = canDispatch(orders);
    days.push({
      key, label: zones.formatDay(key), short: zones.shortDay(key),
      zones: z.map((x) => x.name),
      orders: orders.map(compact),
      packed: orders.filter((o) => o.details.packed).length,
      canDispatch: gate.ok, dispatchBlocked: gate.ok ? null : gate.reason,
      run
    });
  }
  return days;
}

module.exports = { isDeliveryOrder, ordersForDay, compact, canDispatch, runOf, week };
