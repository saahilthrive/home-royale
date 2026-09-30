// Read-only probe of several SP-API endpoints, to see which roles the app has. Prints status and counts only.
import { Amazon } from '../src/amazon.js';
const amz = new Amazon();
const AU = 'A39IBJ37TRP1C6';
const now = new Date(), d = n => new Date(now - n * 864e5).toISOString();
const probes = [
  ['Vendor Orders (retail POs, 30d)', '/vendor/orders/v1/purchaseOrders', { createdAfter: d(30), createdBefore: now.toISOString(), limit: 100 }, b => b.payload?.orders?.length],
  ['Vendor Shipments (30d)', '/vendor/shipping/v1/shipments', { createdAfter: d(30), createdBefore: now.toISOString(), limit: 50 }, b => b.payload?.shipments?.length],
  ['Catalog Items (AU search)', '/catalog/2022-04-01/items', { marketplaceIds: AU, keywords: 'home royale', pageSize: 10 }, b => b.numberOfResults],
  ['Reports list (any, 30d)', '/reports/2021-06-30/reports', { createdSince: d(30), pageSize: 100 }, b => b.reports?.length],
  ['DF Orders, no details (7d)', '/vendor/directFulfillment/orders/2021-12-28/purchaseOrders', { createdAfter: d(7), createdBefore: now.toISOString(), includeDetails: false, limit: 10 }, b => b.orders?.length],
  ['Seller participations', '/sellers/v1/marketplaceParticipations', {}, b => b.payload?.length],
];
for (const [name, path, params, count] of probes) {
  try { console.log(`OK      ${name}: ${count(await amz.get(path, params)) ?? '?'} records`); }
  catch (e) { const m = e.message.match(/\((\d+)\).*?"code":\s*"([^"]+)"/s); console.log(`FAILED  ${name}: ${m ? m[1] + ' ' + m[2] : e.message.slice(0, 200)}`); }
}
