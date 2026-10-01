// Online stores that feed MYOB. Each store reads its WooCommerce credentials from env vars with its own prefix
// ({prefix}BASE_URL, {prefix}CONSUMER_KEY, {prefix}CONSUMER_SECRET). See docs/*_TO_MYOB_MAPPING.md for the facts
// behind each setting.

export const STORES = {
  homeroyale: {
    name: 'Home Royale (homeroyale.com.au)',
    envPrefix: 'WC_',
    // Every web order goes to one MYOB customer.
    customer: { mode: 'fixed', id: 'ENWWW1' },
    // Woo SKU -> MYOB InventoryID candidates, tried in order.
    skuRules: [sku => sku, sku => sku.replace(/\++$/, ''), sku => sku.replace(/\++$/, '').toUpperCase()],
    freightItem: 'FR-FS1',
    discountItem: 'DSCNT1',
  },
  oppenheimerfe: {
    name: 'Oppenheimer Food Equipment (oppenheimerfe.com.au)',
    envPrefix: 'WC2_',
    // Trade buyers are booked to their own MYOB account; non-account buyers went to ENWWW2 until 2025-05.
    // How a Woo customer maps to a MYOB CustomerID is still open (docs/OPPENHEIMERFE_TO_MYOB_MAPPING.md).
    customer: { mode: 'account', fallbackId: 'ENWWW2' },
    skuRules: [sku => sku, sku => sku.replace(/\++$/, ''), sku => sku.replace(/\++$/, '').toUpperCase()],
    freightItem: 'FR-FS1',
    discountItem: 'DSCNT1',
  },
};

export function store(key) {
  const s = STORES[key];
  if (!s) throw new Error(`Unknown store "${key}". Known: ${Object.keys(STORES).join(', ')}`);
  return { key, ...s };
}
