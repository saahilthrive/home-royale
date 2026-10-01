// WooCommerce REST API (v3) client: read-only. Plain Node 22, no dependencies.
// Config: {prefix}BASE_URL, {prefix}CONSUMER_KEY, {prefix}CONSUMER_SECRET (read-only key from
// WooCommerce > Settings > Advanced > REST API). The prefix is WC_ for the first store; see src/stores.js.

export function config(prefix = 'WC_') {
  const cfg = {};
  for (const k of ['BASE_URL', 'CONSUMER_KEY', 'CONSUMER_SECRET']) {
    const v = process.env[prefix + k];
    if (!v) throw new Error(`Missing env var ${prefix}${k}`);
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
    let res, text;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, { headers: { Authorization: this.auth, Accept: 'application/json' } });
      text = await res.text();
      // SiteGround's Anti-Bot answers with an HTML redirect to /.well-known/sgcaptcha/ when the IP isn't allowlisted.
      // Order JSON can itself contain the string "sgcaptcha", so only treat an HTML body as the captcha. Retry a few
      // times in case a request left from an IP outside the allowlist (reads only).
      if (!(/^\s*</.test(text) && text.includes('sgcaptcha'))) break;
      const ip = /y=ip.:([\d.]+)/.exec(text)?.[1];
      if (attempt >= 4) throw new Error(`GET ${url.pathname} blocked by SiteGround captcha (seen from ${ip}): allowlist this IP for ${url.host}`);
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
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
