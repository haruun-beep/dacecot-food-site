/* ============================================================
   da Cecot — pasta-shop delivery by zone and day (lib/delivery/*).

   What a silent wrong answer costs here: a customer booked for a day we don't
   drive to their zone, a fee the browser chose, a courier window built on the
   server's clock instead of Edmonton's, or the driver called with a bag still
   unpacked. Plain node, no framework. Run: npm test
   ============================================================ */

const assert = require('assert');
const zones = require('../lib/delivery/zones');
const uber = require('../lib/delivery/uber');
const day = require('../lib/delivery/day');
const { normalize } = require('../lib/orders/submission');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push({ name, message: e && e.message }); }
}

const fakeContent = (obj) => ({ get: (k) => obj[k] });
const S = zones.settingsFrom(fakeContent({ deliveryEnabled: true }));

/* Edmonton is UTC-6 in October 2026. 2026-10-26 is a Monday. */
const SUN_8PM = Date.parse('2026-10-26T02:00:00Z');   // Sun Oct 25, 20:00 Edmonton
const SUN_9PM = Date.parse('2026-10-26T03:00:00Z');   // Sun Oct 25, 21:00 Edmonton
const MON_8AM = Date.parse('2026-10-26T14:00:00Z');   // Mon Oct 26, 08:00 Edmonton

test('a zone line reads name, days, fee and postal areas', () => {
  const z = zones.parseZoneLine('South | Monday | 9.99 | T6H, T6J t6k');
  assert.deepStrictEqual(z, { id: 'south', name: 'South', days: [1], feeCents: 999, fsas: ['T6H', 'T6J', 'T6K'] });
  assert.deepStrictEqual(zones.parseZoneLine('Central | Mon, Friday | $7.99 | T6E').days, [1, 5]);
  assert.strictEqual(zones.parseZoneLine('nonsense'), null);
  assert.strictEqual(zones.parseZoneLine('X | Funday | 9.99 | T6E'), null, 'an unknown weekday is refused');
  assert.strictEqual(zones.parseZoneLine('X | Monday | free | T6E'), null, 'a non-price fee is refused');
});

test('the default map has no postal area in two zones, and settings read Erika\'s values', () => {
  const all = S.zones.flatMap((z) => z.fsas);
  assert.strictEqual(new Set(all).size, all.length);
  assert.strictEqual(S.cutoffHour, 21);
  assert.strictEqual(S.pickupReady, 15 * 60 + 30);
  assert.deepStrictEqual([S.windowStart, S.windowEnd], [16 * 60, 19 * 60]);
  const custom = zones.settingsFrom(fakeContent({ deliveryEnabled: 'true', deliveryZones: ['North | Tuesday | 14 | T5X', 'Also | Tuesday | 5 | T5X, T5Y'], deliveryCutoffHour: 18, deliveryWindow: '5 PM - 8 PM', deliveryPickupTime: '4:15 PM', deliveryMinOrder: 25 }));
  assert.strictEqual(custom.enabled, true);
  assert.strictEqual(custom.cutoffHour, 18);
  assert.deepStrictEqual([custom.windowStart, custom.windowEnd], [17 * 60, 20 * 60]);
  assert.strictEqual(custom.pickupReady, 16 * 60 + 15);
  assert.strictEqual(custom.minOrderCents, 2500);
  assert.deepStrictEqual(custom.zones.map((z) => z.fsas), [['T5X'], ['T5Y']], 'first line keeps a contested postal area');
});

test('a postal code finds its zone, outside the map finds nothing', () => {
  assert.strictEqual(zones.normalizePostal(' t6j-5w3 '), 'T6J 5W3');
  assert.strictEqual(zones.normalizePostal('90210'), null);
  assert.strictEqual(zones.zoneForPostal('T6J 5W3', S).id, 'south');
  assert.strictEqual(zones.zoneForPostal('t5x4e1', S).id, 'north');
  assert.strictEqual(zones.zoneForPostal('T8N 1A1', S), null);
});

test('next delivery days honour the cutoff on Edmonton\'s clock and never offer today', () => {
  const south = zones.zoneById('south', S);
  assert.deepStrictEqual(zones.nextDeliveryDays(south, S, SUN_8PM, 2).map((d) => d.key), ['2026-10-26', '2026-11-02']);
  assert.strictEqual(zones.nextDeliveryDays(south, S, SUN_8PM, 1)[0].cutoffLabel, '9 PM on Sun Oct 25');
  assert.deepStrictEqual(zones.nextDeliveryDays(south, S, SUN_9PM, 2).map((d) => d.key), ['2026-11-02', '2026-11-09']);
  assert.strictEqual(zones.nextDeliveryDays(south, S, MON_8AM, 1)[0].key, '2026-11-02');
});

test('validateOrder refuses what the page would never offer', () => {
  const base = { delivery_postal: 'T6J 5W3', delivery_address: '2210 Rabbit Hill Rd NW', delivery_date: '2026-10-26' };
  const ok = zones.validateOrder(base, S, SUN_8PM);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.feeCents, 999);
  assert.strictEqual(ok.zone.name, 'South');
  assert.strictEqual(ok.window, '4 PM – 7 PM');
  assert.strictEqual(zones.validateOrder(base, S, SUN_9PM).status, 409, 'after the cutoff');
  assert.strictEqual(zones.validateOrder(Object.assign({}, base, { delivery_postal: 'T8N 1A1' }), S, SUN_8PM).status, 409, 'outside the map');
  assert.strictEqual(zones.validateOrder(Object.assign({}, base, { delivery_postal: 'T6' }), S, SUN_8PM).status, 400);
  assert.strictEqual(zones.validateOrder(Object.assign({}, base, { delivery_date: '2026-10-27' }), S, SUN_8PM).status, 409, 'a Tuesday is not a south day');
  assert.strictEqual(zones.validateOrder(Object.assign({}, base, { delivery_address: '' }), S, SUN_8PM).status, 400);
  const off = zones.settingsFrom(fakeContent({ deliveryEnabled: false }));
  assert.strictEqual(zones.validateOrder(base, off, SUN_8PM).status, 409, 'delivery switched off');
});

test('the stored order carries the server\'s fee, never the browser\'s, and adds it to the total', () => {
  const rec = normalize({ _subject: 'Pasta Shop Order: Lasagna tray', item: 'Lasagna tray', price: '$38.00', quantity: '2',
    fulfillment: 'delivery', delivery_postal: 'T6J 5W3', delivery_address: '2210 Rabbit Hill Rd NW', delivery_date: '2026-10-26',
    delivery_zone: 'South', delivery_window: '4 PM – 7 PM', delivery_fee_cents: 999, name: 'Test', phone: '780-555-0100', email: 'a@b.co' });
  assert.strictEqual(rec.type, 'order');
  assert.strictEqual(rec.amount_cents, 7600 + 999);
  assert.strictEqual(rec.details.delivery_fee_cents, 999);
  assert.strictEqual(rec.details.delivery_date, '2026-10-26');
  const pickup = normalize({ _subject: 'Pasta Shop Order: Gnocchi', item: 'Gnocchi', price: '$13.00', quantity: '1', fulfillment: 'pickup', pickup_day: '2026-10-28', pickup_time: '5:00 PM', delivery_fee_cents: 999, delivery_postal: 'T6J 5W3' });
  assert.strictEqual(pickup.amount_cents, 1300, 'a pickup order ignores any delivery fee sent with it');
  assert.strictEqual(pickup.details.delivery_postal, undefined);
  assert.strictEqual(pickup.details.fulfillment, undefined);
});

test('the Uber payload is one delivery per order with Edmonton windows and a locked quote', () => {
  const order = { id: 'b1e2c3d4-0000-0000-0000-000000000000', name: 'Priya N.', phone: '(780) 555-0141', amount_cents: 4999,
    details: { item: 'Lasagna tray', quantity: '1', delivery_address: '4312 Riverbend Rd NW', delivery_postal: 'T6H 5R2', delivery_date: '2026-10-26', notes: 'Side door' } };
  const q = uber.buildQuoteRequest(order, S);
  assert.strictEqual(q.pickup_ready_dt, '2026-10-26T21:30:00.000Z', '3:30 PM MDT');
  assert.strictEqual(q.pickup_deadline_dt, '2026-10-26T22:00:00.000Z');
  assert.strictEqual(q.dropoff_ready_dt, '2026-10-26T22:00:00.000Z', 'dropoff opens when the pickup window ends');
  assert.strictEqual(q.dropoff_deadline_dt, '2026-10-27T01:00:00.000Z', '7 PM MDT');
  assert.strictEqual(JSON.parse(q.dropoff_address).zip_code, 'T6H 5R2');
  assert.strictEqual(q.dropoff_phone_number, '+17805550141');
  const body = uber.buildDeliveryRequest(order, S, 'dqt_123');
  assert.strictEqual(body.quote_id, 'dqt_123');
  assert.strictEqual(body.external_id, order.id);
  assert.strictEqual(body.idempotency_key, 'dacecot-' + order.id);
  assert.strictEqual(body.manifest_items[0].name, 'Lasagna tray');
  assert.strictEqual(body.dropoff_notes, 'Side door');
  assert.strictEqual(body.test_specifications, undefined, 'no robo-courier unless UBER_DIRECT_SANDBOX');
  // Winter: the same clock reads an hour later in UTC after Nov 1.
  const winter = uber.buildQuoteRequest({ details: Object.assign({}, order.details, { delivery_date: '2026-11-09' }) }, S);
  assert.strictEqual(winter.pickup_ready_dt, '2026-11-09T22:30:00.000Z', '3:30 PM MST');
});

test('summarize keeps what the kitchen needs from Uber\'s reply', () => {
  const info = uber.summarize({ id: 'del_1', quote_id: 'dqt_1', fee: 1359, batch_id: 'bat_abcdef123456', dropoff_sequence_number: 2, status: 'pickup', tracking_url: 'https://delivery.uber.com/orders/x', courier: { name: 'Alex I.', phone_number: '+1555', vehicle_type: 'car' }, live_mode: true }, null);
  assert.strictEqual(info.fee_cents, 1359);
  assert.strictEqual(info.short_batch_id, '123456');
  assert.strictEqual(info.sequence, 2);
  assert.strictEqual(info.courier.name, 'Alex I.');
  const later = uber.summarize({ status: 'delivered' }, info);
  assert.strictEqual(later.delivery_id, 'del_1', 'a partial reply keeps earlier fields');
  assert.strictEqual(later.status, 'delivered');
});

test('the driver is called only when every bag on the day is packed, and only once', () => {
  const mk = (id, extra) => ({ id, type: 'order', name: id, created_at: '2026-10-25T01:00:00Z', amount_cents: 4999, details: Object.assign({ fulfillment: 'delivery', delivery_date: '2026-10-26', delivery_fee_cents: 999 }, extra) });
  const list = [mk('a', {}), mk('b', { packed: true }), mk('c', { fulfillment: 'pickup' }), mk('d', { cancelled: true, packed: true }), mk('e', { delivery_date: '2026-10-27', packed: true })];
  const monday = day.ordersForDay(list, '2026-10-26');
  assert.deepStrictEqual(monday.map((o) => o.id), ['a', 'b'], 'pickup and cancelled orders are not on the run');
  assert.strictEqual(day.canDispatch(monday).ok, false);
  assert.match(day.canDispatch(monday).reason, /1 of 2/);
  monday[0].details.packed = true;
  assert.strictEqual(day.canDispatch(monday).ok, true);
  monday[0].details.uber = { delivery_id: 'del_1', fee_cents: 1359, status: 'pending', sequence: 2 };
  assert.strictEqual(day.canDispatch(monday).ok, false, 'already dispatched');
  monday[1].details.uber = { delivery_id: 'del_2', fee_cents: 1799, status: 'delivered', sequence: 1 };
  const run = day.runOf(monday);
  assert.deepStrictEqual(run.stops.map((s) => s.id), ['b', 'a'], 'stops in Uber\'s sequence');
  assert.strictEqual(run.chargedCents, 1998);
  assert.strictEqual(run.uberCents, 3158);
  assert.strictEqual(run.marginCents, -1160);
  assert.strictEqual(run.delivered, 1);
  const wk = day.week(list, S, '2026-10-24');
  assert.strictEqual(wk.length, 7);
  assert.strictEqual(wk[2].key, '2026-10-26');
  assert.deepStrictEqual(wk[2].zones, ['South']);
  assert.strictEqual(wk[3].orders.length, 1);
});

/* dispatchOrder against a fake Uber: signs in once, quotes, then creates with
   that quote id and the order's idempotency key, and keeps what Uber returns. */
(async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    const isJson = /json/.test(String(init.headers['Content-Type'] || ''));
    calls.push({ url, method: init.method, body: init.body && isJson ? JSON.parse(init.body) : (init.body || null), auth: init.headers.Authorization });
    const reply = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
    if (/\/oauth\/v2\/token$/.test(url)) return reply({ access_token: 'tok_1', expires_in: 3600 });
    if (/\/delivery_quotes$/.test(url)) return reply({ id: 'dqt_9', fee: 1359 });
    if (/\/deliveries$/.test(url)) return reply({ id: 'del_9', quote_id: 'dqt_9', fee: 1359, batch_id: 'bat_xyz123', dropoff_sequence_number: 1, status: 'pending', tracking_url: 'https://delivery.uber.com/orders/9' });
    return { ok: false, status: 404, text: async () => '{}' };
  };
  const prevEnv = {};
  ['UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'UBER_DIRECT_CUSTOMER_ID'].forEach((k) => { prevEnv[k] = process.env[k]; process.env[k] = 'test-' + k; });
  try {
    uber.invalidateToken();
    const order = { id: 'o-1', name: 'Priya N.', phone: '7805550141', amount_cents: 4999, details: { item: 'Lasagna tray', quantity: '1', delivery_address: '4312 Riverbend Rd NW', delivery_postal: 'T6H 5R2', delivery_date: '2026-11-02' } };
    const info = await uber.dispatchOrder(order, S, fakeFetch);
    test('dispatchOrder: token once, quote, create with the quote id and idempotency key', () => {
      assert.deepStrictEqual(calls.map((c) => c.method + ' ' + c.url.replace(/^https?:\/\/[^/]+/, '')), ['POST /oauth/v2/token', 'POST /v1/customers/test-UBER_DIRECT_CUSTOMER_ID/delivery_quotes', 'POST /v1/customers/test-UBER_DIRECT_CUSTOMER_ID/deliveries']);
      assert.strictEqual(calls[2].auth, 'Bearer tok_1');
      assert.strictEqual(calls[2].body.quote_id, 'dqt_9');
      assert.strictEqual(calls[2].body.idempotency_key, 'dacecot-o-1');
      assert.strictEqual(info.delivery_id, 'del_9');
      assert.strictEqual(info.fee_cents, 1359);
      assert.strictEqual(info.short_batch_id, 'XYZ123');
      assert.ok(info.dispatched_at);
    });
  } catch (e) {
    failures.push({ name: 'dispatchOrder against a fake Uber', message: e && e.message });
  } finally {
    Object.keys(prevEnv).forEach((k) => { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; });
    uber.invalidateToken();
  }
  console.log('delivery: ' + passed + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
  failures.forEach((f) => console.log('  ✗ ' + f.name + '\n      ' + f.message));
  if (failures.length) process.exit(1);
})();
