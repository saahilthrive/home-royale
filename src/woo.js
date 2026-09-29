// WooCommerce REST API (v3) client: read-only. Plain Node 22, no dependencies.
// Config: WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET (read-only key from
// WooCommerce > Settings > Advanced > REST API).

function config() {
  const cfg = {};
  for (const k of ['BASE_URL', 'CONSUMER_KEY', 'CONSUMER_SECRET']) {
    const v = process.env['WC_' + k];
    if (!v) throw new Error(`Missing env var WC_${k}`);
    cfg[k] = v.trim();
  }
  cfg.BASE_URL = cfg.BASE_URL.replace(/\/+$/, '');
  return cfg;
}

export class Woo {
  constructor(cfg = config()) {
    this.cfg = cfg;
    this.auth = 'Basic ' + Buffer.from(`${cfg.CONSUMER_KEY}:${cfg.CONSUMER_SECRET}`).toString('base64');
  }

  url(path, params = {}) {
    const url = new URL(`${this.cfg.BASE_URL}/wp-json/wc/v3/${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    return url;
  }

  /** GET one page; returns { data, total, totalPages }. */
  async page(path, params = {}) {
    const url = this.url(path, params);
    const res = await fetch(url, { headers: { Authorization: this.auth, Accept: 'application/json' } });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${url.pathname} failed (${res.status}): ${text.slice(0, 500)}`);
    return {
      data: JSON.parse(text),
      total: Number(res.headers.get('x-wp-total')),
      totalPages: Number(res.headers.get('x-wp-totalpages')),
    };
  }

  /** GET every record, 100 per page (the API maximum). */
  async all(path, params = {}) {
    const rows = [];
    for (let p = 1; ; p++) {
      const { data, totalPages } = await this.page(path, { ...params, per_page: 100, page: p });
      rows.push(...data);
      if (!data.length || p >= (totalPages || p)) return rows;
    }
  }
}
