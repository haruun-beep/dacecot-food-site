/* ============================================================
   da Cecot — delivery zones, days and cutoff. Pure functions, no I/O.

   Erika sets everything in Site Content → Delivery:
     deliveryEnabled     toggle
     deliveryZones       one zone per line:  "South | Monday | 9.99 | T6H, T6J, T6K"
                         name | delivery day(s), comma-separated | fee in dollars | postal areas
     deliveryCutoffHour  orders for a day close at this hour (24h) the day before
     deliveryPickupTime  when the courier should be at the shop, e.g. "3:30 PM"
     deliveryWindow      what customers are promised, e.g. "4:00 PM - 7:00 PM"
     deliveryMinOrder    minimum food total in dollars (0 = none)

   A postal area is the first three characters of a postal code (the FSA). The
   customer's postal code picks the zone; the zone's weekdays are the only days
   the shop page offers. All "today" and cutoff maths runs on Edmonton's clock,
   never the server's.
   ============================================================ */

const R = require('../orders/reservations');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* The default map is the one from the October 2026 proposal and demo. Erika
   replaces it with her own in the admin; it only has to be plausible here. */
const DEFAULT_ZONES = [
  'Central | Friday | 7.99 | T5H, T5J, T5K, T6E, T6G',
  'South | Monday | 9.99 | T6H, T6J, T6K, T6L, T6N, T6R, T6T, T6V, T6W, T6X',
  'North | Tuesday | 12.99 | T5A, T5B, T5C, T5E, T5G, T5L, T5X, T5Y, T5Z',
  'West | Wednesday | 12.99 | T5M, T5N, T5P, T5R, T5S, T5T, T6M',
  'East | Thursday | 11.99 | T5W, T6A, T6B, T6C'
];

function str(v) { return v == null ? '' : String(v).trim(); }

function dayIndex(name) {
  const s = str(name).toLowerCase();
  if (!s) return -1;
  return DAY_NAMES.findIndex((d) => d.toLowerCase() === s || d.toLowerCase().slice(0, 3) === s.slice(0, 3));
}

function slug(name) {
  return str(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zone';
}

// "9.99" / "$9.99" / "10" → cents. Null when it is not a price.
function dollarsToCents(s) {
  const m = /^\$?\s*(\d+)(?:\.(\d{1,2}))?$/.exec(str(s));
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0);
}

// One admin line → zone, or null when the line cannot be read.
function parseZoneLine(line) {
  const parts = str(line).split('|').map((p) => p.trim());
  if (parts.length < 4) return null;
  const name = parts[0];
  const days = parts[1].split(/[,/&]+/).map(dayIndex).filter((d) => d >= 0);
  const feeCents = dollarsToCents(parts[2]);
  const fsas = parts[3].toUpperCase().split(/[\s,]+/).filter((f) => /^[A-Z]\d[A-Z]$/.test(f));
  if (!name || !days.length || feeCents == null || !fsas.length) return null;
  return { id: slug(name), name, days, feeCents, fsas };
}

// "3:30 PM" → minutes from midnight (reservations.parseTime handles the forms).
function minutesOf(s, fallback) {
  const m = R.parseTime(s);
  return m == null ? fallback : m;
}

// "4:00 PM - 7:00 PM" → [start, end] minutes.
function parseWindow(s, fallback) {
  const parts = str(s).split(/\s*(?:-|–|to)\s*/i);
  if (parts.length === 2) {
    const a = R.parseTime(parts[0]), b = R.parseTime(parts[1]);
    if (a != null && b != null && b > a) return [a, b];
  }
  return fallback;
}

/* content = the lib/cms/content loader (or anything with .get(key)). */
function settingsFrom(content) {
  const get = (k) => (content && typeof content.get === 'function') ? content.get(k) : undefined;
  const lines = Array.isArray(get('deliveryZones')) && get('deliveryZones').length ? get('deliveryZones') : DEFAULT_ZONES;
  const zones = [];
  const seen = new Set();
  lines.forEach((line) => {
    const z = parseZoneLine(line);
    if (!z || seen.has(z.id)) return;
    // An FSA claimed by an earlier zone stays there — first line wins.
    z.fsas = z.fsas.filter((f) => !zones.some((o) => o.fsas.includes(f)));
    if (!z.fsas.length) return;
    seen.add(z.id);
    zones.push(z);
  });
  const cutoffRaw = Number(get('deliveryCutoffHour'));
  const cutoffHour = Number.isFinite(cutoffRaw) && cutoffRaw >= 0 && cutoffRaw <= 23 ? Math.floor(cutoffRaw) : 21;
  const pickupReady = minutesOf(get('deliveryPickupTime'), 15 * 60 + 30);
  const win = parseWindow(get('deliveryWindow'), [16 * 60, 19 * 60]);
  const minRaw = Number(get('deliveryMinOrder'));
  const enabledRaw = get('deliveryEnabled');
  return {
    enabled: enabledRaw === true || enabledRaw === 'true',
    zones,
    cutoffHour,
    pickupReady,
    pickupDeadline: pickupReady + 30,
    windowStart: win[0],
    windowEnd: win[1],
    minOrderCents: Number.isFinite(minRaw) && minRaw > 0 ? Math.round(minRaw * 100) : 0
  };
}

function normalizePostal(raw) {
  const s = str(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(s) ? s.slice(0, 3) + ' ' + s.slice(3) : null;
}
function fsaOf(raw) {
  const p = normalizePostal(raw);
  return p ? p.slice(0, 3) : null;
}
function zoneForPostal(raw, settings) {
  const fsa = fsaOf(raw);
  if (!fsa) return null;
  return settings.zones.find((z) => z.fsas.includes(fsa)) || null;
}
function zoneById(id, settings) {
  return settings.zones.find((z) => z.id === id) || null;
}
function zonesForDay(dateKey, settings) {
  const dow = new Date(dateKey + 'T00:00:00Z').getUTCDay();
  return settings.zones.filter((z) => z.days.includes(dow));
}

/* Edmonton's date and hour at an instant. */
function edmontonNow(nowMs) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Edmonton', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
    .formatToParts(new Date(nowMs)).forEach((p) => { parts[p.type] = p.value; });
  return { key: parts.year + '-' + parts.month + '-' + parts.day, hour: (+parts.hour) % 24 };
}

function fmtClock(min) {
  const h = Math.floor(min / 60), mm = min % 60, ap = h >= 12 ? 'PM' : 'AM', h12 = (h % 12) || 12;
  return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ' ' + ap;
}
function fmtHour(h) { return fmtClock(h * 60); }
function windowLabel(settings) { return fmtClock(settings.windowStart) + ' – ' + fmtClock(settings.windowEnd); }

function formatDay(key, withYear) {
  const d = new Date(key + 'T00:00:00Z');
  return DAY_NAMES[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + (withYear ? ', ' + d.getUTCFullYear() : '');
}
function shortDay(key) {
  const d = new Date(key + 'T00:00:00Z');
  return DAY_NAMES[d.getUTCDay()].slice(0, 3) + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

/* The next delivery days a zone can still take an order for. Tomorrow is
   offered only before the cutoff hour; today never is. */
function nextDeliveryDays(zone, settings, nowMs, count, horizonDays) {
  count = count || 3; horizonDays = horizonDays || 28;
  const now = edmontonNow(nowMs == null ? Date.now() : nowMs);
  const out = [];
  for (let i = 1; i <= horizonDays && out.length < count; i++) {
    const key = R.addDaysISO(now.key, i);
    const dow = new Date(key + 'T00:00:00Z').getUTCDay();
    if (!zone.days.includes(dow)) continue;
    if (i === 1 && now.hour >= settings.cutoffHour) continue;
    out.push({ key, label: formatDay(key), cutoffLabel: fmtHour(settings.cutoffHour) + ' on ' + shortDay(R.addDaysISO(key, -1)) });
  }
  return out;
}

function isOpenFor(zone, dateKey, settings, nowMs) {
  return nextDeliveryDays(zone, settings, nowMs, 8).some((d) => d.key === dateKey);
}

/* Server-side check of a delivery order. Mirrors what the page offers, so a
   stale tab or a hand-made POST cannot book a zone we don't serve, a day we
   don't drive, or a fee of its own choosing. */
function validateOrder(data, settings, nowMs) {
  data = data || {};
  if (!settings.enabled) return { ok: false, status: 409, error: 'Delivery is not available right now — please choose pickup on Whyte Ave.' };
  const postal = normalizePostal(data.delivery_postal);
  if (!postal) return { ok: false, status: 400, error: 'Please enter a full Canadian postal code for delivery.' };
  const zone = zoneForPostal(postal, settings);
  if (!zone) return { ok: false, status: 409, error: 'We don’t deliver to ' + postal.slice(0, 3) + ' yet — pickup on Whyte Ave is always open.' };
  const address = str(data.delivery_address);
  if (address.length < 5) return { ok: false, status: 400, error: 'Please enter your street address for delivery.' };
  const dateKey = R.parseDate(data.delivery_date);
  if (!dateKey) return { ok: false, status: 400, error: 'Please choose a delivery day.' };
  if (!isOpenFor(zone, dateKey, settings, nowMs)) {
    const next = nextDeliveryDays(zone, settings, nowMs, 1)[0];
    return { ok: false, status: 409, error: 'Orders for ' + formatDay(dateKey) + ' have closed' + (next ? ' — the next ' + zone.name.toLowerCase() + ' delivery is ' + next.label + '.' : '.') };
  }
  return { ok: true, zone, postal, address, dateKey, feeCents: zone.feeCents, window: windowLabel(settings) };
}

/* What the shop page embeds so the browser can show zones and days without a
   round trip. Fees are dollars for display; the server recomputes them. */
function clientConfig(settings) {
  return {
    enabled: settings.enabled,
    cutoffHour: settings.cutoffHour,
    window: windowLabel(settings),
    minOrderCents: settings.minOrderCents,
    zones: settings.zones.map((z) => ({ id: z.id, name: z.name, days: z.days, dayNames: z.days.map((d) => DAY_NAMES[d]), feeCents: z.feeCents, fsas: z.fsas }))
  };
}

module.exports = {
  DAY_NAMES, DEFAULT_ZONES, parseZoneLine, dollarsToCents, settingsFrom,
  normalizePostal, fsaOf, zoneForPostal, zoneById, zonesForDay,
  edmontonNow, nextDeliveryDays, isOpenFor, validateOrder, clientConfig,
  formatDay, shortDay, fmtClock, fmtHour, windowLabel
};
