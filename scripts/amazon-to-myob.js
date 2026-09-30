// Amazon Direct Fulfillment -> MYOB: sales order -> shipment (confirmed) -> invoice (released).
// DRY RUN by default: builds and validates, writes nothing. --write runs the pipeline (sandbox only; the MYOB
// client refuses other URLs). Re-runnable: each order resumes from whatever step it reached last time.
// Input: Vendor Central DF order CSV (buyer columns are never read). Later the same builder takes API orders.
// Usage: node --env-file=.env scripts/amazon-to-myob.js <orders.csv> [--out plan.json] [--write [--limit N] [--only ORDERID] [--post-date YYYY-MM-DD]]
import { withMyob, flat } from '../src/myob.js';
import { readFileSync, writeFileSync } from 'node:fs';

const CUSTOMER = 'ENAMA1', WAREHOUSE = '02', UOM = 'EA';
const orderSelect = { $expand: 'Shipments', $select: 'OrderType,OrderNbr,Status,Hold,CustomerOrder,Shipments/ShipmentNbr,Shipments/Status,Shipments/InvoiceNbr,Shipments/InvoiceType' };
const KEEP = ['Order ID', 'Order Status', 'Order Place Date', 'Shipped Date', 'Item Cost', 'SKU', 'ASIN', 'Item Quantity', 'Quantity Shipped'];

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, '').trim());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(KEEP.map(k => [k, (r[head.indexOf(k)] ?? '').trim()])));
}
const money = s => Number(s.replace(/[$,]/g, ''));
const date = s => { const m = s.match(/(\d+) (\w{3})\w* (\d{4}), (\d+):(\d+):(\d+) (am|pm) GMT/i); if (!m) return null;
  const mon = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[2]) / 3; let h = +m[4] % 12 + (m[7].toLowerCase() === 'pm' ? 12 : 0);
  return new Date(Date.UTC(+m[3], mon, +m[1], h, +m[5], +m[6])); };
const auDate = d => new Date(d.getTime() + 10 * 3600e3).toISOString().slice(0, 10); // AEST calendar date

const file = process.argv[2];
const arg = k => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null;
// --post-date: sandbox only. The sandbox copy has no financial periods after its April 2026 snapshot, so shipments
// and invoices (and the order itself, since MYOB won't ship before the order date) are dated this instead.
const POST_DATE = arg('--post-date');
const WRITE = process.argv.includes('--write'), LIMIT = Number(arg('--limit') || 1), ONLY = arg('--only');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const lines = parseCsv(readFileSync(file, 'utf8'));

// One MYOB order per Amazon order; shipped quantities only.
const orders = new Map(), skipped = { notShipped: 0, zeroQty: 0 };
for (const l of lines) {
  if (l['Order Status'] !== 'SHIPPED') { skipped.notShipped++; continue; }
  const qty = Number(l['Quantity Shipped']); if (!qty) { skipped.zeroQty++; continue; }
  const id = l['Order ID'];
  if (!orders.has(id)) orders.set(id, { id, placed: date(l['Order Place Date']), shipped: date(l['Shipped Date']), lines: [] });
  orders.get(id).lines.push({ sku: l.SKU, qty, price: money(l['Item Cost']) });
}

await withMyob(async myob => {
  const errors = [];
  // 1. Items exist and are active.
  const skus = [...new Set([...orders.values()].flatMap(o => o.lines.map(l => l.sku)))];
  // Stock items plus non-stock kits (bundles such as BKF-KP are KITASSEMBLY non-stock items).
  const items = new Map([...await myob.getAll('StockItem', { $select: 'InventoryID,ItemStatus' }), ...await myob.getAll('NonStockItem', { $select: 'InventoryID,ItemStatus' })]
    .map(flat).map(i => [i.InventoryID.trim(), i.ItemStatus]));
  for (const s of skus) if (!items.has(s)) errors.push(`SKU ${s} not in MYOB`); else if (items.get(s) !== 'Active') errors.push(`SKU ${s} is ${items.get(s)}`);
  // 2. Customer exists and is active.
  const cust = flat(await myob.get(`Customer/${CUSTOMER}`, { $select: 'CustomerID,Status' }));
  if (cust.Status !== 'Active') errors.push(`Customer ${CUSTOMER} is ${cust.Status}`);
  // 3. Already in MYOB? (duplicate guard on CustomerOrder)
  const existing = new Set((await myob.getAll('SalesOrder', { $filter: `CustomerID eq '${CUSTOMER}'`, $select: 'CustomerOrder' })).map(flat).map(o => o.CustomerOrder));
  const toCreate = [...orders.values()].filter(o => !existing.has(o.id));
  // 4. Price check against the last MYOB price for each SKU (is Item Cost ex GST?).
  const past = await myob.getAll('SalesOrder', { $filter: `CustomerID eq '${CUSTOMER}'`, $expand: 'Details', $select: 'Date,Details/InventoryID,Details/UnitPrice' });
  const lastPrice = {};
  for (const p of past.sort((a, b) => String(a.Date?.value).localeCompare(String(b.Date?.value))))
    for (const d of p.Details || []) lastPrice[d.InventoryID.value] = d.UnitPrice.value;
  const ratios = []; for (const o of toCreate) for (const l of o.lines) if (lastPrice[l.sku]) ratios.push(l.price / lastPrice[l.sku]);
  ratios.sort((a, b) => a - b);

  const payloads = toCreate.map(o => ({
    OrderType: { value: 'SO' }, CustomerID: { value: CUSTOMER }, CustomerOrder: { value: o.id },
    Date: { value: auDate(o.placed) }, Description: { value: `Amazon DF ${o.id}` }, Hold: { value: true },
    Details: o.lines.map(l => ({ InventoryID: { value: l.sku }, WarehouseID: { value: WAREHOUSE }, UOM: { value: UOM }, OrderQty: { value: l.qty }, UnitPrice: { value: l.price } })),
  }));
  const total = toCreate.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty * l.price, 0), 0);
  const units = toCreate.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
  const days = toCreate.map(o => auDate(o.placed)).sort();

  console.log(`PLAN${WRITE ? '' : ' (dry run, nothing written)'}  file lines ${lines.length}  skipped: not shipped ${skipped.notShipped}, zero qty ${skipped.zeroQty}`);
  console.log(`Amazon orders ${orders.size}  already in MYOB ${orders.size - toCreate.length}  to create ${toCreate.length}  (${days[0]} .. ${days.at(-1)})`);
  console.log(`lines ${payloads.reduce((a, p) => a + p.Details.length, 0)}  units ${units}  value ex GST $${total.toFixed(2)}  + GST $${(total * 0.1).toFixed(2)}`);
  if (ratios.length) console.log(`Item Cost vs last MYOB price: ${ratios.length} lines compared, median ratio ${ratios[ratios.length >> 1].toFixed(3)}, 10th-90th pct ${ratios[Math.floor(ratios.length * .1)].toFixed(3)}-${ratios[Math.floor(ratios.length * .9)].toFixed(3)}, SKUs never sold to Amazon in MYOB before: ${skus.filter(s => !lastPrice[s]).length}`);
  console.log(errors.length ? `ERRORS (${errors.length}):\n  ` + errors.join('\n  ') : 'Validation: OK (all SKUs active, customer active)');
  console.log('sample payload:', JSON.stringify(payloads.find(p => p.Details.length > 1) || payloads[0]));
  if (out) writeFileSync(out, JSON.stringify(payloads, null, 1));
  if (!WRITE) return;
  if (errors.length) throw new Error('Validation failed; not writing');

  // Every order in the file, including ones already started, so a re-run finishes partial orders.
  const queue = [...orders.values()].filter(o => !ONLY || o.id === ONLY).slice(0, LIMIT);
  console.log(`\nWRITE to ${myob.cfg.BASE_URL}: ${queue.length} order(s)`);
  const results = [];
  for (const o of queue) {
    const log = { amazonOrder: o.id, steps: [] };
    try { await pushOrder(myob, o, log); log.ok = true; }
    catch (e) { log.ok = false; log.error = e.message.slice(0, 600); }
    results.push(log);
    console.log(`${log.ok ? 'OK    ' : 'FAILED'} ${o.id}  ${log.steps.join(' -> ')}${log.error ? '\n       ' + log.error : ''}`);
  }
  writeFileSync(arg('--log') || 'amazon-push-log.json', JSON.stringify(results, null, 1));
  console.log(`done: ${results.filter(r => r.ok).length} ok, ${results.filter(r => !r.ok).length} failed`);
});

async function findOrder(myob, id) {
  const r = await myob.get('SalesOrder', { ...orderSelect, $filter: `CustomerID eq '${CUSTOMER}' and CustomerOrder eq '${id}'` });
  if (r.length > 1) throw new Error(`${r.length} MYOB orders already carry reference ${id}; fix duplicates by hand`);
  return r[0];
}

async function pushOrder(myob, o, log) {
  const step = s => log.steps.push(s);
  let so = await findOrder(myob, o.id);
  // 1. Sales order (insert-only, so a race or re-run can never create a second one).
  if (!so) {
    const created = await myob.put('SalesOrder', {
      OrderType: { value: 'SO' }, CustomerID: { value: CUSTOMER }, CustomerOrder: { value: o.id },
      Date: { value: POST_DATE || auDate(o.placed) }, RequestedOn: { value: POST_DATE || auDate(o.placed) },
      Description: { value: `Amazon DF ${o.id} placed ${auDate(o.placed)} shipped ${o.shipped ? auDate(o.shipped) : '-'}` }, Hold: { value: false },
      Details: o.lines.map(l => ({ InventoryID: { value: l.sku }, WarehouseID: { value: WAREHOUSE }, UOM: { value: UOM }, OrderQty: { value: l.qty }, UnitPrice: { value: l.price } })),
    }, { insertOnly: true });
    step(`SO ${created.OrderNbr.value} created (${created.Status.value})`);
    so = await findOrder(myob, o.id);
  } else step(`SO ${so.OrderNbr.value} exists (${so.Status.value})`);
  const keys = { OrderType: so.OrderType, OrderNbr: so.OrderNbr };
  if (so.Hold?.value) { await myob.put('SalesOrder', { ...keys, Hold: { value: false } }); step('released hold'); so = await findOrder(myob, o.id); }

  // 2. Shipment, dated when Amazon says it shipped.
  let sh = so.Shipments?.[0];
  if (!sh) {
    await myob.action('SalesOrder', 'SalesOrderCreateShipment', keys, { ShipmentDate: { value: POST_DATE || auDate(o.shipped || o.placed) }, WarehouseID: { value: WAREHOUSE } });
    so = await findOrder(myob, o.id); sh = so.Shipments?.[0];
    if (!sh) throw new Error('shipment was not created');
    step(`shipment ${sh.ShipmentNbr.value} created`);
  }
  const shKeys = { ShipmentNbr: sh.ShipmentNbr };
  if (sh.Status?.value === 'Open' || sh.Status?.value === 'On Hold') {
    if (sh.Status.value === 'On Hold') await myob.put('Shipment', { ...shKeys, Hold: { value: false } });
    await myob.action('Shipment', 'ConfirmShipment', shKeys);
    step(`shipment ${sh.ShipmentNbr.value} confirmed`);
    so = await findOrder(myob, o.id); sh = so.Shipments[0];
  }

  // 3. Invoice for the shipment, dated on the ship date (Shipment/PrepareInvoice would use today's date), then release it.
  if (!sh.InvoiceNbr?.value) {
    const created = await myob.put('SalesInvoice', {
      Type: { value: 'Invoice' }, CustomerID: { value: CUSTOMER }, Date: { value: POST_DATE || auDate(o.shipped || o.placed) },
      CustomerOrder: { value: o.id }, Description: { value: `Amazon DF ${o.id}` }, Hold: { value: false },
      Details: [{ OrderType: so.OrderType, OrderNbr: so.OrderNbr, ShipmentNbr: sh.ShipmentNbr }],
    }, { insertOnly: true });
    so = await findOrder(myob, o.id); sh = so.Shipments[0];
    step(`invoice ${created.ReferenceNbr.value} created`);
    if (!sh.InvoiceNbr?.value) sh = { ...sh, InvoiceNbr: created.ReferenceNbr, InvoiceType: created.Type };
  }
  const inv = (await myob.get('SalesInvoice', { $filter: `ReferenceNbr eq '${sh.InvoiceNbr.value}'`, $select: 'Type,ReferenceNbr,Status,Hold,Amount' }))[0];
  if (inv.Status.value === 'Balanced' || inv.Status.value === 'On Hold') {
    if (inv.Hold?.value) await myob.put('SalesInvoice', { Type: inv.Type, ReferenceNbr: inv.ReferenceNbr, Hold: { value: false } });
    await myob.action('SalesInvoice', 'ReleaseSalesInvoice', { Type: inv.Type, ReferenceNbr: inv.ReferenceNbr });
    step(`invoice ${inv.ReferenceNbr.value} released ($${inv.Amount.value})`);
  } else step(`invoice ${inv.ReferenceNbr.value} ${inv.Status.value} ($${inv.Amount.value})`);
}
