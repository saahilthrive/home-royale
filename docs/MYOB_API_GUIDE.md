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

`src/myob.js` in this repo (`oppenheimer-myob`) implements everything in sections 2-3: token caching, paging,
logout + revoke in `close()`, the 302 error detection, and `flat()` to unwrap values. Copy it and add:

```js
async put(entity, body, { params = {}, insertOnly = false } = {}) {
  if (!this.cfg.BASE_URL.includes('sbx')) throw new Error('Refusing to write outside the sandbox');
  const res = await fetch(this.entityUrl(entity, params), {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + (await this.#accessToken()),
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(insertOnly && { 'If-None-Match': '*' }),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT ${entity} failed (${res.status}): ${text.slice(0, 2000)}`);
  return JSON.parse(text);
}

async action(entity, name, entityKeys, parameters = {}) {
  const url = `${this.entityUrl(entity).href}/${name}`;
  const auth = { Authorization: 'Bearer ' + (await this.#accessToken()) };
  let res = await fetch(url, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity: entityKeys, parameters }),
  });
  while (res.status === 202) {                       // long-running: poll Location until 204
    await new Promise(r => setTimeout(r, 2000));
    res = await fetch(new URL(res.headers.get('location'), this.cfg.BASE_URL), { headers: auth });
  }
  if (res.status !== 204 && !res.ok) throw new Error(`${entity}/${name} failed (${res.status}): ${await res.text()}`);
}

wrap(obj) {                                          // {a: 1} -> {a: {value: 1}}; leaves arrays/objects alone
  return Object.fromEntries(Object.entries(obj).map(([k, v]) =>
    [k, Array.isArray(v) ? v.map(x => this.wrap(x)) : (v && typeof v === 'object' ? v : { value: v })]));
}
```

Credentials come from env vars: `MYOB_BASE_URL`, `MYOB_CLIENT_ID`, `MYOB_CLIENT_SECRET`, `MYOB_USERNAME`,
`MYOB_PASSWORD`, `MYOB_ENDPOINT_NAME`, `MYOB_ENDPOINT_VERSION`. Run with `node --env-file=.env`.

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
