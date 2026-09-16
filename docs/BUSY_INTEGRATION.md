# BUSY Integration — Connectivity Audit & Selected Mechanism

**Status:** Desk audit complete. Environment verification **pending** — see
[Section 6](#6-site-verification-checklist). The checklist must be completed against the
factory's actual BUSY installation before the bridge is pointed at production.

**Scope:** How the DHOWN Live Production Dashboard exchanges *commercial* data with BUSY.
Nothing in this document applies to machine monitoring, production planning, WIP, roll
tracking, OEE or downtime — those stay inside the dashboard and never leave it.

---

## 1. Why this document exists first

The instruction for this workstream was explicit: **do not assume a REST API exists.**

That caution is correct. BUSY (BUSY Infotech Pvt. Ltd., New Delhi) is a desktop/LAN
accounting product for the Indian SME market, not an API-first SaaS. The integration
surface it exposes depends on the **version**, the **edition**, and the **database
backend** the customer happens to be running. Writing transformation logic before those
three facts are pinned down is how integrations end up rewritten.

So the adapter layer is built to be **replaceable**, and this document records which
mechanism was selected and why.

---

## 2. The two machines

This is the defining constraint of the deployment.

```
   Factory PC (192.168.1.18)                 BUSY PC
   ┌─────────────────────────────┐          ┌──────────────────────────┐
   │ DHOWN Live Production       │          │ BUSY accounting          │
   │ Dashboard                   │          │                          │
   │  • React frontend           │          │  • Data Import (XML)     │
   │  • Node/Express backend     │          │  • company books         │
   │  • PostgreSQL 18            │          │                          │
   │  • BUSY Bridge  ────────────┼── LAN ──▶│  \\BUSY-PC\BusyExchange\ │
   │  • machine data via RS-485  │          │                          │
   └─────────────────────────────┘          └──────────────────────────┘
        production truth                        accounting truth
```

Consequences that shaped the code, not just the docs:

- **The link can vanish at any moment.** BUSY PC switched off for the night, a rebooted
  switch, an unplugged cable. Every such failure must classify as `CONNECTION_ERROR` so
  the queue *holds* rather than marching transactions to `MANUAL_REVIEW` during a normal
  overnight outage. `errors.js` maps the full set of Windows/SMB failure codes
  (`ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, `ENETDOWN`, `EIO`, `EHOSTUNREACH`, …)
  accordingly, and there is a test asserting each one is retryable.
- **UNC paths must survive configuration.** `\\BUSY-PC\BusyExchange\Outbox` passed through
  `path.resolve()` becomes a path relative to the backend's working directory, and the
  bridge would silently write to the factory PC's own disk. `resolveExchangePath()` passes
  UNC paths and drive letters through untouched.
- **Atomicity is per-share.** A temp-file-then-rename is atomic on SMB only *within* one
  share, so the temp file is written inside the outbox itself, never in the OS temp
  directory. BUSY can therefore never import a half-written voucher it caught mid-write.
- **Latency is real.** Every BUSY call crosses the LAN, which is why nothing in the
  request path waits for it: the dashboard queues and returns.

---

## 3. What the audit found

### 3.1 There is no native public REST API

This is the single most important finding.

BUSY does not ship a documented, publicly supported REST API in its standard offline
editions. The evidence:

- The third-party vendors that sell "BUSY API" products describe themselves as *filling
  that gap* — BusyNotify states plainly that BUSY "does not provide a public REST API out
  of the box" and sells REST endpoints layered over the BUSY database.
- Unified-accounting-API aggregators (RootFi, Apideck) list Busy Accounting as an
  integration target they wrap, rather than as a vendor-documented API they call.
- BUSY's own published help material covers import/export and SQL connectivity. It does
  not document an HTTP API surface for third-party clients.

**Consequence:** any design that assumes `POST /api/v1/invoices` against BUSY is
fictional unless a gateway product has been licensed and installed. The bridge therefore
treats REST as *one possible transport among several*, never as the baseline.

### 3.2 Native, vendor-supported: XML Data Export / Import

BUSY ships a first-party **Data Export / Import** facility (Administration → Data
Export / Import) that works in **XML**, covering both **master types** (ledgers/accounts,
stock items, parties) and **voucher types** (sales, purchase, and other transactions),
with selectable type and date range.

Corroborating detail: BUSY's own `Tally2BUSY` migration utility consumes Tally XML exports
and writes ledgers, stock items and vouchers into a BUSY company — i.e. XML ingestion of
masters *and* transactions is a real, exercised code path inside the product, not a
marketing bullet.

This is the **only mechanism confirmed to be first-party, supported by the vendor, and
present across editions**. That makes it the default.

### 3.3 Also native: Excel / CSV import

BUSY supports importing from Excel and other programs, and exporting reports/documents to
Excel. Useful as a **fallback and for bulk master onboarding**, but weaker than XML for
transactional flow: column mapping is positional and brittle across versions, it is
oriented at human-driven bulk loads, and it gives no natural place to carry an idempotency
key. Not used for dispatch/invoice posting.

### 3.4 Conditionally available: direct MS SQL Server backend

BUSY is sold in SQL and non-SQL variants. SQL variants keep company data in **Microsoft
SQL Server**; BUSY's documentation covers SQL Server installation and SQL connectivity
troubleshooting, and SQL editions are marketed for larger/multi-user sites.

**Reading** from that database (for BUSY → dashboard master and outstanding sync) is a
legitimate, low-risk integration when the instance is reachable and a read-only login is
issued.

**Writing** to it is not. The schema is undocumented and version-dependent; direct INSERTs
bypass BUSY's own posting, numbering, GST and stock-valuation logic. Writing directly to
BUSY tables risks silent corruption of a **statutory** system.

**Policy adopted here: SQL is read-only. All writes go through a supported BUSY ingestion
path.** This is enforced in code, not just in prose — `BUSY_REST_READ_ONLY=true` turns off
every write capability, and a test asserts it.

### 3.5 Third-party REST gateways (optional, if licensed)

If a gateway has been licensed (BusyNotify-class product, or an in-house service on the
BUSY SQL database), a genuine JSON/REST surface exists. Where present it is the nicest
option: synchronous, immediate references, status queries. The bridge supports it via a
second adapter. It is **opt-in** and must never be assumed.

### 3.6 BUSY Online

BUSY also sells a cloud/online offering. If the factory moves to BUSY Online rather than
an offline LAN install, the connectivity picture changes entirely and
[Section 6](#6-site-verification-checklist) must be re-run against that product.

### 3.7 Editions and variants that affect the answer

| Edition | Relevance to integration |
|---|---|
| Basic | Bookkeeping, invoicing, basic inventory, statutory reports. No order/challan management — **dispatch-challan mapping may not exist**. |
| Standard | Adds Order / Quotation / **Challan** management, multiple units, barcode/POS. Realistic minimum for the dispatch flow. |
| Enterprise | Adds multi-branch/location, voucher approval, payroll. Multi-location matters for warehouse mapping. |

Variants: Single-User, Dual-User, Multi-User, and (Standard/Enterprise) Client-Server.
A single-user desktop install means **BUSY is frequently unavailable**, which is precisely
why the queue and offline mode are mandatory rather than defensive extras.

---

## 4. Mechanism selection

**Selected primary mechanism: BUSY XML Data Export / Import, over a watched shared folder
on the BUSY PC.**

Rationale:

1. First-party and vendor-supported, so it survives BUSY upgrades better than
   schema-level hacks.
2. Present regardless of edition and regardless of SQL vs non-SQL backend.
3. Posts through BUSY's own import logic, so numbering, GST and stock valuation stay
   BUSY's responsibility — the entire point of BUSY being the statutory source of truth.
4. Inherently asynchronous, which matches reality: a desktop accounting package on another
   PC is not an always-on API server.

**Selected fallback / upgrade path: REST gateway adapter**, enabled only when a gateway is
licensed and reachable.

**Selected read path (optional): read-only SQL** for BUSY → dashboard master and
outstanding sync, where a read-only login is available.

### 4.1 How the file exchange works

```
  Dashboard ──/api/busy──▶ BUSY BRIDGE ──writes──▶ \\BUSY-PC\BusyExchange\Outbox\
                                                    DHOWN-DISPATCH-2026-000091.xml
                                                             │
                                     BUSY operator / scheduled BUSY import picks it up
                                                             ▼
                                                   BUSY Data Import (XML)
                                                             │
                          BUSY writes result ──▶ \Ack\DHOWN-DISPATCH-2026-000091.ack.xml
                                                             ▼
                     BRIDGE reads ack ──▶ stores BUSY reference ──▶ reconciles ──▶ dashboard
```

The filename **is** the external reference, which gives idempotency for free: the bridge
refuses to write a file whose external reference already exists, and a redelivery of the
same dashboard event resolves to the same filename.

### 4.2 Asynchrony is explicit

Because BUSY's import is not synchronous, `sendDispatch()` does **not** return a BUSY
reference under the XML adapter. It returns `ACCEPTED` plus the external reference.
The BUSY reference arrives later, via `getTransactionStatus()` polling the ack directory.
The queue models this as a distinct **`AWAITING_BUSY`** state so that "we handed it over"
is never confused with "BUSY booked it".

Under the REST adapter the same call *can* return a reference immediately. The
dashboard-facing API is identical either way — that difference is absorbed entirely inside
the adapter.

---

## 5. Adapter capability matrix

`BusyAdapter.capabilities()` declares, at runtime, what the configured BUSY environment can
actually do. **Unsupported operations throw `UnsupportedOperationError`. They are never
faked, and never silently no-op.** The BUSY Bridge page reads this matrix so supervisors
can see what this installation supports.

| Operation | XML file adapter | REST gateway | Read-only gateway |
|---|---|---|---|
| `testConnection()` | ✅ share reachability + writability | ✅ health endpoint | ✅ |
| `getCustomers()` | ⚠️ via scheduled BUSY export drop | ✅ | ✅ |
| `getVendors()` | ⚠️ via scheduled BUSY export drop | ✅ | ✅ |
| `getItems()` | ⚠️ via scheduled BUSY export drop | ✅ | ✅ |
| `createOrUpdateCustomer()` | ✅ master XML | ✅ | ❌ writes forbidden |
| `createOrUpdateVendor()` | ✅ master XML | ✅ | ❌ writes forbidden |
| `createOrUpdateItem()` | ✅ master XML | ✅ | ❌ writes forbidden |
| `sendSalesReference()` | ✅ voucher XML | ✅ | ❌ |
| `sendPurchaseReference()` | ✅ voucher XML | ✅ | ❌ |
| `sendDispatch()` | ✅ voucher XML (async) | ✅ | ❌ |
| `sendInvoice()` | ✅ voucher XML (async) | ✅ | ❌ |
| `getTransactionStatus()` | ✅ ack-file poll | ✅ | ✅ |
| `reconcileTransaction()` | ⚠️ ack + export compare | ✅ | ✅ |

✅ supported · ⚠️ supported but depends on a BUSY-side scheduled export being configured ·
❌ deliberately not implemented

The ⚠️ rows need a BUSY-side operator action to configure. Until that is done,
`getCustomers()` under the XML adapter returns what is in the inbound drop directory —
which may legitimately be empty. That is reported as a capability gap on the dashboard,
not as a failure.

---

## 6. Site verification checklist

**To be completed by whoever has access to the BUSY PC.** Record the answers here and
commit them — these values drive `backend/.env` and the adapter choice.

### 6.1 Version and edition

- [ ] BUSY version (Help → About): `____________` (e.g. BUSY 21 / BUSY 23 / BUSY Online)
- [ ] Release/build number: `____________`
- [ ] Edition: ☐ Basic ☐ Standard ☐ Enterprise
- [ ] Variant: ☐ Single-User ☐ Dual-User ☐ Multi-User ☐ Client-Server
- [ ] Offline LAN install or BUSY Online? `____________`
- [ ] Which BUSY company is DHOWN's live book: `____________`
- [ ] Financial year / books-begin date: `____________`

> If edition is **Basic**, flag it: challan/order management may be absent and the dispatch
> flow may need to post as a direct sales voucher instead. Confirm before building mappings.

### 6.2 The BUSY machine and the network path

- [ ] BUSY PC hostname: `____________`   IP: `____________`
- [ ] Same subnet as the factory PC (192.168.1.x)? ☐ Yes ☐ No
- [ ] Shared folder created on the BUSY PC? ☐ Yes — share name: `____________`
- [ ] The factory PC can read **and write** that share ☐
      (verify from the factory PC: `dir \\BUSY-PC\BusyExchange` then create a test file)
- [ ] Which Windows account does the Node backend run as, and does it have share rights? `____________`
- [ ] Does the BUSY PC sleep or power off overnight? `____________`
      (fine — the queue holds — but it sets expectations for how stale the books get)

### 6.3 XML Data Export / Import

- [ ] Administration → Data Export / Import present in this edition? ☐ Yes ☐ No
- [ ] Master types exportable (list them): `____________`
- [ ] Voucher types importable (list them): `____________`
- [ ] **Sample XML captured** for each voucher type the bridge must post ☐
      → attach to `docs/samples/` — the transformer templates must be validated against
      real BUSY XML, not against this document's assumptions.
- [ ] Can BUSY import be scheduled/automated, or is it operator-driven? `____________`
- [ ] Does BUSY write an acknowledgement file? If not, how is success confirmed? `____________`
- [ ] Outbox path (BUSY reads): `____________`
- [ ] Ack path (BUSY writes): `____________`
- [ ] Inbox path (BUSY drops master exports): `____________`

### 6.4 Database backend

- [ ] SQL edition? ☐ Yes ☐ No — SQL Server version: `____________`
- [ ] Reachable from the factory PC? ☐ Yes ☐ No
- [ ] Read-only login issued for the bridge? ☐ Yes ☐ No — login: `____________`
- [ ] Confirmed in writing that the bridge will **not** write to BUSY tables ☐

### 6.5 REST gateway (only if applicable)

- [ ] Gateway product licensed? ☐ Yes ☐ No — product/vendor: `____________`
- [ ] Base URL: `____________`   Auth scheme: `____________`
- [ ] Endpoint documentation obtained ☐   Rate limits: `____________`

### 6.6 Master data conventions

- [ ] BUSY customer/ledger code format: `____________`
- [ ] BUSY item code format: `____________`
- [ ] Warehouse/location feature in use? ☐ Yes ☐ No — list: `____________`
- [ ] GSTIN held per party in BUSY ☐
- [ ] Existing master export provided for the initial mapping load ☐

### 6.7 Operational

- [ ] Who owns BUSY-side errors (name/role): `____________`
- [ ] Which dashboard users should have SUPERVISOR rights for BUSY actions: `____________`
- [ ] Backup/rollback procedure if a bad batch is imported: `____________`

---

## 7. Decision record

| Date | Decision | Basis |
|---|---|---|
| 2026-09-16 | REST is **not** assumed. XML Data Export/Import selected as primary. | No native public REST API found; XML is first-party and edition-independent. |
| 2026-09-16 | Direct SQL writes **forbidden**; SQL read-only where available. | Undocumented schema; writes bypass BUSY's statutory posting logic. |
| 2026-09-16 | `sendDispatch()` is async under XML; `AWAITING_BUSY` queue state added. | BUSY import is not a synchronous request/response. |
| 2026-09-16 | REST gateway supported as an opt-in adapter. | Available only if a gateway is licensed. |
| 2026-09-16 | Bridge lives inside the dashboard backend, not as a separate service. | One process, one database, one login and role hierarchy on the factory PC. |
| 2026-09-16 | UNC paths bypass `path.resolve()`; SMB error codes classify as retryable. | BUSY is on a separate PC; the share is expected to come and go. |
| _pending_ | Final mechanism confirmed against the live install. | Blocked on Section 6. |

---

## 8. Changing the mechanism later

The dashboard-facing contract does not change when the BUSY transport changes. To switch:

1. Implement the contract in `backend/busy-bridge/adapters/busyAdapter.js`.
2. Declare truthful `capabilities()`.
3. Register it in `backend/busy-bridge/adapters/index.js`.
4. Set `BUSY_ADAPTER=<name>` in `backend/.env`.

No dashboard logic, no transformer, no queue and no reconciliation code should need to
change. If a new adapter forces a change outside `adapters/`, that is a design bug — the
abstraction has leaked and should be fixed rather than worked around.

---

## 9. What is deliberately NOT integrated

The dashboard remains the source of truth for production. The following are **never** sent
to BUSY and there is no code path that would:

- machine monitoring, OEE, downtime, live machine data
- production planning and scheduling
- WIP state and shop-floor routing
- roll tracking and roll-level genealogy
- operator assignments, shifts, RFID events
- AI capacity calculation and optimisation

Roll numbers may ride along as free text on a document remark so they print on the
challan, but the bridge attaches no meaning to them. A test asserts that no `MACHINE`,
`SHIFT`, `OPERATOR`, `OEE`, `DOWNTIME` or `WIP` element ever appears in generated XML.

Conversely, accounting logic is **never** reimplemented in the dashboard. The bridge copies
BUSY's *references and outcomes* back; it does not recompute tax, valuation or ledger
balances.

---

## 10. Sources

Desk research, September 2026:

- [BUSY — How do I import/export data in BUSY?](https://busy.in/faqs/how-do-i-importexport-data-in-busy-answerid-67737/)
- [BUSY — Import/export data from Excel or other programs](https://busy.in/faqs/how-do-i-importexport-data-from-excel-or-other-programs-into-busy-answerid-52182/)
- [BUSY — Supported formats for uploading existing data](https://busy.in/faqs/customize-exported-reports-documents-from-software-upload-existing-data-into-busy-what-formats-supported-answerid-28979/)
- [BUSY — System requirements / SQL version support](https://busy.in/faqs/does-it-integrate-with-different-sql-versions-answerid-45046/)
- [BUSY — SQL connectivity troubleshooting](https://busy.in/faqs/troubleshoot/sql-connectivity/6/)
- [BusyNotify — BUSY API integration (states BUSY has no public REST API out of the box)](https://busynotify.in/solutions/custom-apis)
- [RootFi — Busy Accounting integration](https://www.rootfi.dev/integrations/busy-accounting)
- [Apideck — Busy Accounting API](https://www.apideck.com/accounting-software/busy-accounting)
- [BUSY Infotech — Enterprise edition packages](https://www.busyinfotech.in/erp-software-packages.html)
- [BUSY edition comparison chart](https://busyaccountingsoftware.in/busy-software-comparison-chart.html)

> Vendor-neutral note: none of the above replaces Section 6. Published material describes
> the product family; only the factory's install describes the factory's install.
