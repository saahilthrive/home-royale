// MYOB Acumatica (MYOB Advanced) client: reads verified against the sandbox; writes guarded to sandbox URLs. Plain Node 22, no dependencies,
// so it runs the same on a laptop, a container, or an Azure Function.
//
// Config comes from environment variables (see .env.example). Never hardcode them.

const REQUIRED = ['BASE_URL', 'CLIENT_ID', 'CLIENT_SECRET', 'USERNAME', 'PASSWORD'];

function config() {
  const cfg = {};
  for (const k of REQUIRED) {
    const v = process.env['MYOB_' + k];
    if (!v) throw new Error(`Missing env var MYOB_${k} (copy .env.example to .env)`);
    cfg[k] = v.trim();
  }
  cfg.BASE_URL = cfg.BASE_URL.replace(/\/+$/, '');
  cfg.ENDPOINT_NAME = process.env.MYOB_ENDPOINT_NAME || 'Default';
  cfg.ENDPOINT_VERSION = process.env.MYOB_ENDPOINT_VERSION || '23.200.001';
  return cfg;
}

export class Myob {
  constructor(cfg = config()) {
    this.cfg = cfg;
    this.token = null;
  }

  async #tokenRequest(params) {
    const res = await fetch(this.cfg.BASE_URL + '/identity/connect/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.cfg.CLIENT_ID,
        client_secret: this.cfg.CLIENT_SECRET,
        ...params,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Token request failed (${res.status}): ${text}`);
    return JSON.parse(text);
  }

  async #accessToken() {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const body = await this.#tokenRequest({
      grant_type: 'password',
      username: this.cfg.USERNAME,
      password: this.cfg.PASSWORD,
      scope: 'api',
    });
    this.token = { value: body.access_token, expiresAt: Date.now() + ((body.expires_in || 3600) - 60) * 1000 };
    return this.token.value;
  }

  /**
   * End the server session, then revoke the token. Revoking alone leaves the session
   * open and it counts against the user's "concurrent API logins" limit (SM201010)
   * until it times out, so always call this when a run finishes (see withMyob).
   */
  async close() {
    if (!this.token) return;
    await fetch(this.cfg.BASE_URL + '/entity/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token.value },
    }).catch(() => {});
    await fetch(this.cfg.BASE_URL + '/identity/connect/revocation', {
      method: 'POST',
      body: new URLSearchParams({
        token: this.token.value,
        client_id: this.cfg.CLIENT_ID,
        client_secret: this.cfg.CLIENT_SECRET,
      }),
    }).catch(() => {});
    this.token = null;
  }

  entityUrl(entity, params = {}) {
    const url = new URL(
      `${this.cfg.BASE_URL}/entity/${this.cfg.ENDPOINT_NAME}/${this.cfg.ENDPOINT_VERSION}/${entity}`,
    );
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    return url;
  }

  /** GET an entity; params are OData-ish ($select, $filter, $expand, $top, $skip). */
  async get(entity, params = {}) {
    const url = this.entityUrl(entity, params);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + (await this.#accessToken()), Accept: 'application/json' },
        redirect: 'manual',
      });
      // Some server-side failures (e.g. login limit reached) come back as a 302 to an
      // HTML error page with the real reason in the query string.
      const location = res.headers.get('location');
      if (location && location.includes('Error.aspx')) {
        const msg = new URL(location, this.cfg.BASE_URL).searchParams.get('message');
        throw new Error(`GET ${url} failed: ${msg || location}`);
      }
      if (res.status === 401 && attempt === 0) {
        this.token = null; // revoked server-side; retry once with a fresh token
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`GET ${url} failed (${res.status}): ${text.slice(0, 1000)}`);
      return JSON.parse(text);
    }
  }

  /** GET every record, paging with $top/$skip. */
  async getAll(entity, params = {}, pageSize = 500) {
    const rows = [];
    for (let skip = 0; ; skip += pageSize) {
      const page = await this.get(entity, { ...params, $top: pageSize, $skip: skip });
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }
  // ---- Writes (not yet run against the sandbox; see section 4) ----

  #assertSandbox() {
    if (!/sbx/i.test(this.cfg.BASE_URL)) throw new Error('Refusing to write outside the sandbox: ' + this.cfg.BASE_URL);
  }

  /** Create or update. insertOnly adds If-None-Match: * so an existing record fails with 412 instead of being updated. */
  async put(entity, body, { params = {}, insertOnly = false } = {}) {
    this.#assertSandbox();
    const url = this.entityUrl(entity, params);
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + (await this.#accessToken()),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(insertOnly && { 'If-None-Match': '*' }),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PUT ${entity} failed (${res.status}): ${text.slice(0, 2000)}`);
    return JSON.parse(text);
  }

  /** Invoke an action (e.g. SalesOrder/SalesOrderCreateShipment); polls while the server answers 202. */
  async action(entity, name, entityKeys, parameters = {}, { timeoutMs = 120000 } = {}) {
    this.#assertSandbox();
    const auth = { Authorization: 'Bearer ' + (await this.#accessToken()) };
    let res = await fetch(this.entityUrl(entity).href + '/' + name, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ entity: entityKeys, parameters }),
      redirect: 'manual',
    });
    const deadline = Date.now() + timeoutMs;
    while (res.status === 202) {
      if (Date.now() > deadline) throw new Error(`${entity}/${name} still running after ${timeoutMs} ms`);
      await new Promise(r => setTimeout(r, 2000));
      res = await fetch(new URL(res.headers.get('location'), this.cfg.BASE_URL), { headers: auth, redirect: 'manual' });
    }
    if (res.status !== 204 && !res.ok) throw new Error(`${entity}/${name} failed (${res.status}): ${(await res.text()).slice(0, 2000)}`);
  }

  async delete(entity, idOrKeys) {
    this.#assertSandbox();
    const path = [].concat(idOrKeys).map(encodeURIComponent).join('/');
    const res = await fetch(this.entityUrl(entity).href + '/' + path, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + (await this.#accessToken()) },
      redirect: 'manual',
    });
    if (!res.ok) throw new Error(`DELETE ${entity}/${path} failed (${res.status}): ${(await res.text()).slice(0, 1000)}`);
  }
}


/** Run fn with a client and always release the API session afterwards. */
export async function withMyob(fn) {
  const myob = new Myob();
  try {
    return await fn(myob);
  } finally {
    await myob.close();
  }
}

/** Acumatica wraps scalars as {value: x}; this unwraps one record (not nested arrays). */
export function flat(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) out[k] = v.value;
  }
  return out;
}

/**
 * Wrap plain values for a request body: {a: 1, Details: [{b: 2}]} -> {a: {value: 1}, Details: [{b: {value: 2}}]}.
 * Nested objects (linked entities such as ShipToAddress) are wrapped recursively; objects that already have
 * a `value` key are passed through as-is.
 */
export function wrap(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k,
    Array.isArray(v) ? v.map(wrap)
    : k === 'id' || k === 'delete' || k === 'custom' ? v
    : v && typeof v === 'object' && !(v instanceof Date) ? ('value' in v ? v : wrap(v))
    : { value: v }]));
}
