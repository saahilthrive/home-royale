// Read-only check of the Amazon SP-API vendor connection. Prints counts only, never credentials.
import { Amazon } from '../src/amazon.js';

const days = Number(process.argv[2] || 7);
const to = new Date();
const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
try {
  const orders = await new Amazon().directFulfillmentOrders(from, to);
  console.log(`Amazon: OK  ${orders.length} Direct Fulfillment orders in the last ${days} days`);
} catch (e) {
  console.log(`Amazon: FAILED  ${e.message}`);
}
