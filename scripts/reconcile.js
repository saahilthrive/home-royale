// Read-only reconciliation of one store's WooCommerce orders against MYOB sales orders.
//   npm run reconcile -- <store> [--since 2025-01-01] [--snapshot 2026-04-09] [--cache DIR]
// Matches on the trailing digits of SalesOrder.CustomerOrder (buyer first name + Woo order number) across all
// customers, so it also shows which MYOB customers a store's orders land on. Prints aggregates only: no buyer
// names, emails or addresses. --cache keeps the raw pulls in DIR (they contain personal data: keep DIR out of git).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Woo, config } from '../src/woo.js';
import { store as getStore } from '../src/stores.js';
import { withMyob, flat } from '../src/myob.js';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: { since: { type: 'string', default: '2025-01-01' }, snapshot: { type: 'string', default: '2026-04-09' }, cache: { type: 'string' } },
});
const store = getStore(positionals[0]);

async function cached(name, fn) {
  const file = opt.cache && `${opt.cache}/${store.key}-${name}-${opt.since}.json`;
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const data = await fn();
  if (file) { mkdirSync(opt.cache, { recursive: true }); writeFileSync(file, JSON.stringify(data)); }
  return data;
}

const orders = await cached('woo', async () => {
  const woo = new Woo(config(store.envPrefix));
  return (await woo.all('orders', { after: opt.since + 'T00:00:00', orderby: 'date', order: 'asc' })).map(o => ({
    number: String(o.number), status: o.status, date: o.date_created.slice(0, 10), customerId: o.customer_id,
    firstName: o.billing?.first_name ?? '', shippingTotal: +o.shipping_total, discountTotal: +o.discount_total,
    lines: o.line_items.map(l => ({ sku: (l.sku || '').trim(), name: l.name, qty: l.quantity, total: +l.total })),
  }));
});

const myob = await cached('myob', () => withMyob(async m => {
  const since = new Date(Date.parse(opt.since) - 30 * 864e5).toISOString().slice(0, 10);
  const so = await m.getAll('SalesOrder', {
    $select: 'OrderType,OrderNbr,CustomerID,CustomerOrder,Date,Status,Details/InventoryID',
    $expand: 'Details', $filter: `Date ge datetimeoffset'${since}'`,
  });
  const ids = async e => (await m.getAll(e, { $select: 'InventoryID' })).map(r => flat(r).InventoryID);
  return {
    so: so.map(r => ({ ...flat(r), items: (r.Details || []).map(d => flat(d).InventoryID) })),
    stock: await ids('StockItem'), nonStock: await ids('NonStockItem'),
  };
}));

// ---- index MYOB orders by Woo order number ----
const byNum = new Map();
for (const s of myob.so) {
  const m = /^\s*([A-Za-z][A-Za-z' .-]*?)?\s*-?\s*(\d+)\s*$/.exec(s.CustomerOrder || '');
  if (!m) continue;
  const list = byNum.get(m[2]) ?? [];
  list.push({ ...s, refName: (m[1] || '').trim().toLowerCase() });
  byNum.set(m[2], list);
}
const items = new Set([...myob.stock, ...myob.nonStock]);
const mapSku = sku => sku && store.skuRules.map(r => r(sku)).find(id => items.has(id));
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-');
const bucket = s => (['completed', 'processing', 'on-hold'].includes(s) ? 'live' : s);
const table = (head, rows) => console.log([head, head.map(() => '---'), ...rows].map(r => '| ' + r.join(' | ') + ' |').join('\n'));

// ---- match ----
const inWindow = orders.filter(o => o.date <= opt.snapshot);
for (const o of inWindow) {
  const cands = (byNum.get(o.number.replace(/\D/g, '')) || []).filter(s => s.OrderType === 'SO');
  const first = o.firstName.trim().toLowerCase().split(/\s+/)[0];
  const named = cands.filter(s => first && s.refName.startsWith(first));
  // A bare number also matches trade POs (e.g. "PO34880"), so accept number-only matches just on a fixed web customer.
  const onStore = store.customer.mode === 'fixed' ? cands.filter(s => s.CustomerID === store.customer.id) : [];
  o.match = named[0] || onStore[0] || null;
  o.matchKind = named.length ? 'number+name' : onStore.length ? 'number on store customer' : null;
  if (!o.match && cands.length) o.collision = true;
}

console.log(`# ${store.name}\nWoo orders since ${opt.since}: ${orders.length} (${inWindow.length} on or before MYOB snapshot ${opt.snapshot})\n`);

console.log('## Coverage by month (orders on or before the snapshot)');
const months = {};
for (const o of inWindow) {
  const m = (months[o.date.slice(0, 7)] ??= { live: 0, liveIn: 0, other: 0, otherIn: 0 });
  const k = bucket(o.status) === 'live' ? 'live' : 'other';
  m[k]++; if (o.match) m[k + 'In']++;
}
table(['Month', 'Woo completed/processing', 'In MYOB', '%', 'Woo cancelled/refunded/other', 'In MYOB'],
  Object.entries(months).sort().map(([k, v]) => [k, v.live, v.liveIn, pct(v.liveIn, v.live), v.other, v.otherIn]));

const matched = inWindow.filter(o => o.match);
const kinds = {}; for (const o of matched) kinds[o.matchKind] = (kinds[o.matchKind] || 0) + 1;
console.log(`\nStatuses: ${JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(inWindow, o => o.status)).map(([k, v]) => [k, v.length])))}`);
console.log(`Match quality: ${JSON.stringify(kinds)}; number found only on another customer with a different name (not counted): ${inWindow.filter(o => o.collision).length}\n`);

console.log('## MYOB customers the matched orders sit on');
const custs = Object.entries(Object.groupBy(matched, o => o.match.CustomerID)).sort((a, b) => b[1].length - a[1].length);
console.log(`${custs.length} customers. Top: ${custs.slice(0, 20).map(([c, v]) => `${c} ${v.length}`).join(', ')}`);
if (store.customer.mode === 'fixed') console.log(`On ${store.customer.id}: ${pct(matched.filter(o => o.match.CustomerID === store.customer.id).length, matched.length)}`);
const wooCust = Object.groupBy(matched.filter(o => o.customerId), o => o.customerId);
const consistent = Object.values(wooCust).filter(v => new Set(v.map(o => o.match.CustomerID)).size === 1).length;
const guests = matched.filter(o => !o.customerId);
console.log(`Woo account holders matched: ${Object.keys(wooCust).length}, of which always on one MYOB customer: ${consistent}`);
console.log(`Guest orders matched: ${guests.length}, on: ${Object.entries(Object.groupBy(guests, o => o.match.CustomerID)).map(([c, v]) => `${c} ${v.length}`).join(', ') || '-'}\n`);

console.log('## SKU mapping (all Woo orders since ' + opt.since + ')');
const skus = new Map();
for (const o of orders) for (const l of o.lines) {
  const k = l.sku || `(blank) ${l.name}`;
  const e = skus.get(k) ?? { lines: 0, name: l.name, sku: l.sku, rule: null };
  e.lines++; skus.set(k, e);
}
let totalLines = 0; const byRule = {};
for (const e of skus.values()) {
  totalLines += e.lines;
  const r = !e.sku ? 'blank SKU' : store.skuRules.findIndex(f => items.has(f(e.sku)));
  e.rule = r === -1 ? 'not in MYOB' : typeof r === 'number' ? `rule ${r}` : r;
  (byRule[e.rule] ??= { skus: 0, lines: 0 }), byRule[e.rule].skus++, (byRule[e.rule].lines += e.lines);
}
table(['Result', 'Distinct SKUs', 'Lines', '% of lines'], Object.entries(byRule).sort().map(([k, v]) => [k, v.skus, v.lines, pct(v.lines, totalLines)]));
console.log('(rule 0 = exact, rule N = Nth transform in src/stores.js)\n\nTop unmapped:');
table(['SKU', 'Product', 'Lines'], [...skus.values()].filter(e => e.rule === 'not in MYOB' || e.rule === 'blank SKU')
  .sort((a, b) => b.lines - a.lines).slice(0, 30).map(e => [e.sku || '(blank)', e.name.slice(0, 60), e.lines]));

// For matched orders: does the mapped item appear on the MYOB order? Validates the SKU rules against what staff keyed.
let agree = 0, mappable = 0;
for (const o of matched) for (const l of o.lines) { const id = mapSku(l.sku); if (id) { mappable++; if (o.match.items.includes(id)) agree++; } }
console.log(`\nMatched orders: mapped Woo line found on the MYOB order: ${agree}/${mappable} (${pct(agree, mappable)})`);

console.log('\n## Shipping and discounts (matched orders)');
const has = (o, id) => o.match.items.includes(id);
const ship = matched.filter(o => o.shippingTotal > 0), disc = matched.filter(o => o.discountTotal > 0);
console.log(`Woo shipping > 0: ${ship.length}; of those MYOB has ${store.freightItem}: ${ship.filter(o => has(o, store.freightItem)).length}`);
console.log(`Woo shipping = 0 but MYOB has ${store.freightItem}: ${matched.filter(o => !(o.shippingTotal > 0) && has(o, store.freightItem)).length}`);
console.log(`Woo discount > 0: ${disc.length}; of those MYOB has ${store.discountItem}: ${disc.filter(o => has(o, store.discountItem)).length}`);
const other = {}; for (const o of matched) for (const id of o.match.items) if (!myob.stock.includes(id)) other[id] = (other[id] || 0) + 1;
console.log(`Non-stock items on matched MYOB orders: ${Object.entries(other).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
