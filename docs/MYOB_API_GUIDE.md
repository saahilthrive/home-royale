# MYOB Acumatica (MYOB Advanced) REST API: field guide

What was learned connecting to the Oppenheimer MYOB Advanced sandbox for reporting, written so it can be dropped
into another project, such as one that **writes data into MYOB**.

Labels on each item:
- **[verified]**: seen working against the sandbox.
- **[schema]**: read from this sandbox's own `swagger.json`, but not executed.
- **[docs]**: standard Acumatica behaviour, not tested here.

Nothing here contains credentials.

---

## 1. Environment facts

| Item | Value |
|---|---|
| Sandbox URL | `https://sbx2-oppenheimer.myobadvanced.com` [verified] |
| Tenant (company) | `Oppenheimer Live`. The sandbox tenant keeps the production tenant's name. [verified] |
| Endpoint | `Default` / `23.200.001` [verified]. `24.200.001` is not the one in use. |
| Data snapshot | The sandbox is a copy of production as at **2026-04-09**. Nothing after that date exists. [verified] |
| Size | About 1,070 customers, 35,709 AR documents (2019-05 to 2026-04), 4,717 stock items, and about 1,200 sales orders in 2026. [verified] |
| Sales order types seen | `SO` (sales order), `CM` (credit memo order). Statuses: On Hold, Back Order, Shipping, Completed, Canceled. [verified] |
| Customisations | `SalesOrder` has a custom field `UsrExternalOrderOriginal`, plus Shopify/BigCommerce store entities. [schema] |
| Entities on endpoint | 117 (full list in the appendix). [schema] |

Get the authoritative, per-instance API description from:
```
GET {BASE_URL}/entity/Default/23.200.001/swagger.json     (OpenAPI 3.0.1, ~2.8 MB, needs a bearer token)
```
It lists every entity, field, action and response code for *this* instance, customisations included. Use it
instead of guessing field names: the guessed ones were wrong twice (see section 5).

---

## 2. Authentication (OAuth 2.0 password grant)

### Setup in MYOB
1. **Connected Applications (SM303010):** create an app with flow **Resource Owner Password Credentials** and add a
   secret. The Client ID looks like `GUID@Oppenheimer Live`. The part after `@` is the tenant, and it decides
   which company the user signs in to. [verified]
2. **Users (SM201010):** create the API user.
   - **It needs a licence / user type that allows API access.** Without one, sign-in fails. [verified: that was the first blocker]
   - **Set "Max. Number of Concurrent API Logins" to 2 or more.** The default is 1, and one leaked session locks you out. [verified]
   - **The role needs rights on every screen touched.** View is enough to read; **writing needs edit rights** on the screen (e.g. SO301000 for SalesOrder). [verified for view]
3. **Restriction groups apply on top of roles.** A user with full roles still saw only 3 of about 1,070 customers,
   and therefore only their invoices and payments. Stock items were unaffected. Check **Customer Access** and
   **Restriction Groups by User** and include the API user in the same groups as a normal finance user. [verified]

### Token request [verified]
```http
POST {BASE_URL}/identity/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id=...&client_secret=...&username=...&password=...&scope=api
```
Response: `access_token`, `expires_in` (seconds). Add `offline_access` to `scope` to also get a `refresh_token`.

Token errors:
| Response | Meaning |
|---|---|
| `400 invalid_grant / invalid_username_or_password` | Wrong password, first-login password change still pending, user not in the tenant named after `@`, or **no licence / API rights**. Client ID and secret are fine. |
| `400 invalid_client` | Wrong Client ID or secret. |

### Sessions and logout (important)
Every API call creates a **server session** that counts against the user's concurrent login limit. **Revoking the
token does NOT end the session.** Always log out:

```http
POST {BASE_URL}/entity/auth/logout
Authorization: Bearer <token>
```
then optionally revoke:
```http
POST {BASE_URL}/identity/connect/revocation      (form: token, client_id, client_secret)
```
When the limit is hit, calls return **HTTP 302** to
`/Frames/Error.aspx?...&message=The number of concurrent API logins ... has been reached.`, not a JSON error.
Parse the `message` query parameter out of the `Location` header, which means using `redirect: 'manual'` in fetch.
Stale sessions time out after roughly 10-20 minutes. [verified]

---

## 3. Reading (GET) [verified]

```
GET {BASE_URL}/entity/Default/23.200.001/{Entity}?$select=...&$filter=...&$expand=...&$top=...&$skip=...
Authorization: Bearer <token>
Accept: application/json
```

- **Values are wrapped:** `{"CustomerID": {"value": "SNLUNA"}}`. Unwrap every scalar. Detail collections are arrays of wrapped records.
- **Paging:** `$top` + `$skip`. Stop when a page comes back smaller than `$top`. Pages of 500 work.
- **`$select` with detail fields:** `Details/InventoryID,Details/Qty` together with `$expand=Details`.
- **Filters:** `Status eq 'Open'`, `Date ge datetimeoffset'2026-01-01'`, combined with `and` / `or` and parentheses.
- **Custom (non-endpoint) fields:** `$custom=View.Field`, e.g. `$custom=Document.CuryDocBal`. They come back under
  `record.custom.View.Field.value`. Binary fields such as `GroupMask` crash the request with a 500.
- **Unknown field in `$select`:** returns **500** `KeyNotFoundException`, not a 400. That usually means a wrong field name.
- **No screen rights:** returns **403** `You have insufficient rights to access the X (SCREENID) form.`
- **`$adHocSchema`:** `GET .../{Entity}/$adHocSchema` returns an empty template with every field, which is useful to discover names.

Timing: open AR, which reads about 4,000 invoices, 480 payments and 1,070 customers, takes about 21 seconds. Sales by
item for Q1 2026 (1,340 invoices with lines) takes about 9 seconds.

---

## 4. Writing (PUT, actions, DELETE): for the next project

None of this has been run against the sandbox yet; it comes from the sandbox's swagger plus standard Acumatica behaviour.
Test on the sandbox only, and put a guard in code that refuses to write unless `BASE_URL` contains `sbx`.

### Create or update: `PUT /{Entity}` [schema]
```http
PUT {BASE_URL}/entity/Default/23.200.001/SalesOrder?$expand=Details
Content-Type: application/json

{
  "OrderType":  { "value": "SO" },
  "CustomerID": { "value": "SNLUNA" },
  "CustomerOrder": { "value": "EXT-10001" },
  "Description": { "value": "Created via API" },
  "Hold": { "value": true },
  "Details": [
    { "InventoryID": { "value": "1101-259" }, "OrderQty": { "value": 10 }, "UOM": { "value": "KILO" } }
  ]
}
```
- **Upsert by key:** PUT inserts if the key fields don't match a record, otherwise it updates. Leave auto-numbered
  keys (`OrderNbr`, `ReferenceNbr`) out on create, and MYOB assigns them. [docs]
- **Force insert-only or update-only** with headers: `If-None-Match: *` (fail if it exists) or `If-Match: *` (fail if
  missing). A violation returns **412**. [schema: the 412 response is documented] **Use `If-None-Match: *` on creates to avoid duplicates.**
- **Update a specific record:** include `"id": "<guid>"` from a previous GET or PUT response. [docs]
- **Detail lines:** a line without `id` is **added**. A line with `id` is updated, and `{"id": "...", "delete": true}` removes it. Sending the array again without ids **duplicates lines**. [docs]
- **Custom fields on write:** `"custom": {"Document": {"UsrField": {"type": "CustomStringField", "value": "x"}}}`. [docs]
- **Response:** 200 with the saved record, including assigned numbers and `id`. **422** means validation failed, and
  the body is the record with `error` attributes on the offending fields. Log the whole body. [schema]
- **`PATCH /{Entity}`** also exists (updates only the fields sent) on all 117 entities. [schema]

### Field names differ between entities [schema]
| Entity | Customer field | Line qty | Line description |
|---|---|---|---|
| `SalesOrder` | `CustomerID` | `OrderQty` | `LineDescription` |
| `SalesInvoice` (SO303000) | `CustomerID` | `Qty` | `TransactionDescr` |
| `Invoice` (AR301000) | **`Customer`** | `Qty` | **`TransactionDescription`** |
| `Payment` | `CustomerID` | n/a | n/a (applications in `DocumentsToApply` / `OrdersToApply`) |

### Actions (release, ship, etc.): `POST /{Entity}/{Action}` [schema]
```http
POST {BASE_URL}/entity/Default/23.200.001/SalesOrder/SalesOrderCreateShipment
Content-Type: application/json

{ "entity": { "OrderType": {"value": "SO"}, "OrderNbr": {"value": "SO012345"} }, "parameters": {} }
```
- **202 Accepted** with a `Location` header means it's still running: poll `GET Location` until **204** (done). [schema]
- Actions available on this endpoint:

| Entity | Actions |
|---|---|
| SalesOrder | `OpenSalesOrder`, `CancelSalesOrder`, `ReopenSalesOrder`, `ReleaseFromCreditHoldSalesOrder`, `SalesOrderCreateShipment`, `SalesOrderCreateReceipt`, `PrepareSalesInvoice`, `AutoRecalculateDiscounts` |
| Shipment | `ConfirmShipment`, `CorrectShipment`, `PrepareInvoice`, `UpdateIN` |
| SalesInvoice | `ReleaseSalesInvoice` |
| Invoice | `ReleaseInvoice` |
| Payment | `ReleasePayment`, `VoidPayment`, card actions |
| Bill | `ReleaseBill`, `ReverseBill`, `ReleaseRetainage` |
| JournalTransaction | `ReleaseJournalTransaction` |
| Customer / Vendor | `CreateContactFromCustomer` / `CreateContactFromVendor` |

- Documents may be created **On Hold** depending on the preferences for that order type. Set `"Hold": {"value": false}`
  in a PUT, or call the matching action, before release. [docs]
- **Releasing posts to the general ledger and can't be undone**, only reversed. Keep release as a separate, explicit step. [docs]

### Delete [schema]
```
DELETE /entity/Default/23.200.001/{Entity}/{id}                 (by GUID)
DELETE /entity/Default/23.200.001/{Entity}/{key1}/{key2}        (by key values, e.g. /SalesOrder/SO/SO012345)
```

### Files [verified: link present in responses]
Each record has `_links["files:put"]`. PUT the raw bytes to that URL with `{filename}` filled in.

### Idempotency and safety checklist for writes
1. Put a stable external reference on every record, such as `CustomerOrder` or `ExternalRef` on SalesOrder.
   Before creating, GET with `$filter=CustomerOrder eq '...'`, and create with `If-None-Match: *`.
2. Don't auto-retry a timed-out PUT blindly. Check whether the record was created first.
3. One session per run, and **always log out** in a `finally`.
4. Use a separate API user and connected app for writing, with edit rights only on the screens written to.
5. Log the request and response for every write, with secrets removed.

---

## 5. Gotchas learned the hard way

| Symptom | Cause | Fix |
|---|---|---|
| `invalid_grant` for a brand-new user | No licence or API rights assigned | Assign licence / user type on SM201010 |
| Every call returns HTML / 302 | Concurrent API login limit reached | Log out after every run; raise the limit to 2 or more |
| 200 OK but only a few records | Restriction groups hide customers and their documents | Add the API user to the customer restriction groups |
| 500 `KeyNotFoundException` | Unknown field in `$select` (e.g. `CustomerID` on `Invoice`) | Check `swagger.json` or `$adHocSchema` |
| 403 `insufficient rights to access the X form` | Role lacks that screen | Grant the screen on the role |
| `Payment` returns credit memos | The Payment entity (AR302000) includes CM documents | Filter by `Type` (`Payment`, `Prepayment`, `Refund`) |
| No unapplied-balance field on `Payment` | Not on the endpoint; `AvailableBalance` comes back empty on GET | `$custom=Document.CuryDocBal` gives the unapplied balance |
| "Last 90 days" returns nothing | The sandbox is a 2026-04-09 snapshot | Use explicit dates on or before 2026-04-09 |
| Same customer split across IDs | e.g. Primo (`IQHAN1`, `INPMQU`), Inghams (3 IDs) | Group via parent account or a mapping table |

---

## 6. Reference client (Node 22, no dependencies)

Complete file. Save it as `src/myob.js` in the new project. The read path has run against the sandbox;
`put`, `action` and `delete` have not yet (section 4) and refuse to run unless `BASE_URL` contains `sbx`.

Credentials come from env vars: `MYOB_BASE_URL`, `MYOB_CLIENT_ID`, `MYOB_CLIENT_SECRET`, `MYOB_USERNAME`,
`MYOB_PASSWORD`, `MYOB_ENDPOINT_NAME` (default `Default`), `MYOB_ENDPOINT_VERSION` (default `23.200.001`).
Run with `node --env-file=.env script.js`, and add `{"type":"module"}` to `package.json`.

```js
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

/** Wrap plain values for a request body: {a: 1, Details: [{b: 2}]} -> {a: {value: 1}, Details: [{b: {value: 2}}]}. */
export function wrap(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k,
    Array.isArray(v) ? v.map(wrap)
    : k === 'id' || k === 'delete' || k === 'custom' ? v
    : { value: v }]));
}
```

Usage:
```js
import { withMyob, flat, wrap } from './src/myob.js';

await withMyob(async myob => {
  const order = await myob.put('SalesOrder', wrap({
    OrderType: 'SO', CustomerID: 'SNLUNA', CustomerOrder: 'EXT-10001', Hold: true,
    Details: [{ InventoryID: '1101-259', OrderQty: 10 }],
  }), { insertOnly: true, params: { $expand: 'Details' } });
  console.log(flat(order).OrderNbr);
});   // withMyob always logs out, even on error
```

---

## Appendix: entities on Default/23.200.001 (this instance) [schema]

Account, AccountDetailsForPeriodInquiry, AccountGroup, AccountSummaryInquiry, Activity, Appointment, AttributeDefinition,
BigCommerceStores, Bill, Budget, BusinessAccount, Carrier, Case, CashSale, ChangeOrder, ChangeOrderClass, Check,
CompaniesStructure, CompanyFinancialPeriod, Contact, ContractUsage, CostCode, Currency, Customer, CustomerClass,
CustomerLocation, CustomerPaymentMethod, CustomerPriceClass, DeductionBenefitCode, Discount, DiscountCode, EarningTypeCode,
Email, EmailProcessing, Employee, EmployeePayrollClass, EmployeePayrollSettings, Event, ExpenseClaim, ExpenseReceipt,
ExternalCommitment, FOBPoint, FinancialPeriod, FinancialYear, InventoryAdjustment, InventoryAllocationInquiry,
InventoryIssue, InventoryQuantityAvailable, InventoryReceipt, InventorySummaryInquiry, Invoice, ItemClass,
ItemSalesCategory, ItemWarehouse, JournalTransaction, KitAssembly, KitSpecification, LaborCostRate, Lead, Ledger,
LotSerialClass, NonStockItem, Opportunity, PTOBank, PayGroup, PayPeriod, Payment, PaymentMethod, PayrollBatch,
PayrollUnionLocal, PayrollWCCCode, PhysicalInventoryCount, PhysicalInventoryReview, ProFormaInvoice, Project,
ProjectBudget, ProjectTask, ProjectTemplate, ProjectTemplateTask, ProjectTransaction, PurchaseOrder, PurchaseReceipt,
SalesInvoice, SalesOrder, SalesPriceWorksheet, SalesPricesInquiry, Salesperson, ServiceOrder, ShipVia, Shipment,
ShippingBox, ShippingTerm, ShippingZones, ShopifyStore, StockItem, StorageDetailsByLocationInquiry, StorageDetailsInquiry,
Subaccount, Subcontract, Task, Tax, TaxCategory, TaxReportingSettings, TaxZone, TemplateItems, TimeEntry, TransferOrder,
UnionLocal, UnitsOfMeasure, Vendor, VendorClass, VendorPriceWorksheet, VendorPricesInquiry, Warehouse, WorkCalendar,
WorkClassCompensationCode, WorkLocation
