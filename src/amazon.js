// Amazon Selling Partner API client for a private vendor app. The only POST in use requests reports.
// Plain Node 22, no dependencies. Config: AMZ_CLIENT_ID, AMZ_CLIENT_SECRET, AMZ_REFRESH_TOKEN,
// AMZ_ENDPOINT (default: Far East, which serves Amazon.com.au).

function config() {
  const cfg = {};
  for (const k of ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN']) {
    const v = process.env['AMZ_' + k];
    if (!v) throw new Error(`Missing env var AMZ_${k}`);
    cfg[k] = v.trim();
  }
  cfg.ENDPOINT = (process.env.AMZ_ENDPOINT || 'https://sellingpartnerapi-fe.amazon.com').replace(/\/+$/, '');
  return cfg;
}

export class Amazon {
  constructor(cfg = config()) {
    this.cfg = cfg;
    this.token = null;
  }

  async #accessToken() {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.cfg.REFRESH_TOKEN,
        client_id: this.cfg.CLIENT_ID,
        client_secret: this.cfg.CLIENT_SECRET,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LWA token request failed (${res.status}): ${text.slice(0, 500)}`);
    const body = JSON.parse(text);
    this.token = { value: body.access_token, expiresAt: Date.now() + ((body.expires_in || 3600) - 60) * 1000 };
    return this.token.value;
  }

  async get(path, params = {}) { return this.request('GET', path, params); }

  /** Call a path, retrying on 429 (rate limit) with backoff. */
  async request(method, path, params = {}, body) {
    const url = new URL(this.cfg.ENDPOINT + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: { 'x-amz-access-token': await this.#accessToken(), Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
        ...(body && { body: JSON.stringify(body) }),
      });
      if (res.status === 429 && attempt < 5) {
        await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${url.pathname} failed (${res.status}): ${text.slice(0, 1000)}`);
      return JSON.parse(text);
    }
  }

  /**
   * Direct Fulfillment purchase orders created in [from, to). The API accepts at most 7 days per
   * request, so the range is split into 7-day windows and each window is paged with nextToken.
   */
  async directFulfillmentOrders(from, to, { includeDetails = true } = {}) {
    const orders = [];
    const week = 7 * 24 * 3600 * 1000;
    for (let start = new Date(from); start < to; start = new Date(start.getTime() + week)) {
      const end = new Date(Math.min(start.getTime() + week, to.getTime()));
      let nextToken;
      do {
        const body = await this.get('/vendor/directFulfillment/orders/2021-12-28/purchaseOrders', {
          createdAfter: start.toISOString(),
          createdBefore: end.toISOString(),
          includeDetails,
          limit: 100,
          nextToken,
        });
        orders.push(...(body.orders || []));
        nextToken = body.pagination?.nextToken;
      } while (nextToken);
    }
    return orders;
  }
}
