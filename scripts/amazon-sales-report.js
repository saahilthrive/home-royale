// Request a vendor sales report (Sourcing view: units Amazon bought from us) for the last 4 full weeks, wait for it,
// save the JSON and print a summary. The report has no buyer data. Usage: node --env-file=.env scripts/amazon-sales-report.js [out.json]
import { Amazon } from '../src/amazon.js';
import { gunzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const amz = new Amazon(), AU = 'A39IBJ37TRP1C6';
// Last 4 full weeks, Sunday..Saturday (WEEK reports must align to weeks).
const end = new Date(); end.setUTCHours(0,0,0,0); end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 1) % 7));
const start = new Date(end - 27 * 864e5);
const { reportId } = await amz.request('POST', '/reports/2021-06-30/reports', {}, {
  reportType: 'GET_VENDOR_SALES_REPORT', marketplaceIds: [AU],
  dataStartTime: start.toISOString(), dataEndTime: new Date(end.getTime() + 864e5 - 1000).toISOString(),
  reportOptions: { reportPeriod: 'WEEK', distributorView: 'SOURCING', sellingProgram: 'RETAIL' },
});
console.log('reportId', reportId);
let r;
for (let i = 0; i < 60; i++) {
  r = await amz.get(`/reports/2021-06-30/reports/${reportId}`);
  if (['DONE', 'CANCELLED', 'FATAL'].includes(r.processingStatus)) break;
  await new Promise(res => setTimeout(res, 15000));
}
console.log('status', r.processingStatus);
if (!r.reportDocumentId) process.exit(0);
const doc = await amz.get(`/reports/2021-06-30/documents/${r.reportDocumentId}`);
let buf = Buffer.from(await (await fetch(doc.url)).arrayBuffer());
if (doc.compressionAlgorithm === 'GZIP') buf = gunzipSync(buf);
const text = buf.toString('utf8');
writeFileSync(process.argv[2] || 'amazon-sales-report.json', text);
const data = JSON.parse(text);
console.log('keys', Object.keys(data));
if (r.processingStatus !== 'DONE') { console.log(text.slice(0, 1000)); process.exit(0); }
const rows = data.salesByAsin || [];
const byAsin = {}; let units = 0, rev = 0;
for (const x of rows) {
  const u = x.shippedUnits || 0, v = x.shippedRevenue?.amount || 0;
  units += u; rev += v;
  byAsin[x.asin] ??= { u: 0, v: 0 }; byAsin[x.asin].u += u; byAsin[x.asin].v += v;
}
console.log(`range ${start.toISOString().slice(0,10)}..${end.toISOString().slice(0,10)}  rows ${rows.length}  ASINs ${Object.keys(byAsin).length}  shipped units ${units}  shipped revenue ${rev.toFixed(2)} ${rows[0]?.shippedRevenue?.currencyCode || ''}`);
for (const [a, t] of Object.entries(byAsin).sort((x, y) => y[1].v - x[1].v).slice(0, 10)) console.log(`  ${a}  units ${t.u}  revenue ${t.v.toFixed(2)}`);
