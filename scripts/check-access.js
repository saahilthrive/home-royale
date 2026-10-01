// Read-only connectivity check for each WooCommerce store and MYOB. Prints counts only, never credentials.
import { Woo, config } from '../src/woo.js';
import { STORES } from '../src/stores.js';
import { withMyob } from '../src/myob.js';

async function check(name, fn) {
  try { console.log(`${name}: OK  ${await fn()}`); }
  catch (e) { console.log(`${name}: FAILED  ${e.message}`); }
}

for (const [key, s] of Object.entries(STORES)) {
  await check(`WooCommerce ${key}`, async () => {
    const woo = new Woo(config(s.envPrefix));
    const orders = await woo.page('orders', { per_page: 1 });
    const products = await woo.page('products', { per_page: 1 });
    return `${orders.total} orders, ${products.total} products`;
  });
}

await check('MYOB', () => withMyob(async myob => {
  const customers = await myob.get('Customer', { $select: 'CustomerID', $top: 2000 });
  const items = await myob.get('StockItem', { $select: 'InventoryID', $top: 10000 });
  return `${customers.length} customers visible, ${items.length} stock items`;
}));
