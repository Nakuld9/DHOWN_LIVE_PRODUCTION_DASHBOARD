# Accounting Engine — API (`/api/acct`)

Auth: JWT (existing). Roles via existing `requireRole`. AUDITOR = read-only automatically.
Read/Write = SUPERVISOR or ACCOUNTS. Approve/Reverse = SUPERVISOR+. Periods = ADMIN+.
Errors: `{ error, code, details? }` with codes ACCT_INVALID/AMOUNT/LINES/STATE/PERIOD/FORBIDDEN/NOT_FOUND/CONFLICT.

| Method & path | Role | Purpose |
|---|---|---|
| GET /company | read | company + financial years |
| GET /voucher-types | read | list voucher types |
| GET /groups ; POST /groups | read ; write | list / create account group (inherits parent nature) |
| GET /ledgers ; POST /ledgers ; PUT /ledgers/:id | read ; write | list / create / update ledger master (?q,group_id,ledger_type,active) |
| PUT /ledgers/:id/opening | write | set opening balance {fy_id?,amount,side} |
| GET /ledgers/:id/balance?as_of | read | signed balance {amount,side} |
| GET /vouchers (?type,status,from,to,q,limit,offset) | read | voucher register |
| GET /vouchers/:id | read | voucher + lines + journal |
| POST /vouchers | write | create draft (Idempotency-Key header honoured) |
| PUT /vouchers/:id | write | edit draft (resets to DRAFT) |
| POST /vouchers/:id/validate | write | full validation -> VALIDATED |
| POST /vouchers/:id/approve | SUPERVISOR | approve (maker != checker) |
| POST /vouchers/:id/post | write | post -> immutable journal + number (idempotent) |
| POST /vouchers/:id/reverse | SUPERVISOR | post a reversal; original -> REVERSED |
| POST /vouchers/:id/cancel | write | cancel a draft |
| GET /reports/trial-balance (?fy_id,as_of) | read | opening/movement/closing per ledger + group roll-up + opening_difference |
| GET /reports/ledger (?ledger_id,from,to) | read | statement with running balance |
| GET /reports/day-book (?from,to,type) | read | posted vouchers for the day |
| GET /periods (?fy_id) ; PUT /periods/:pid | read ; ADMIN | list / set OPEN/CLOSED/LOCKED (reopen needs reason) |
| GET /audit (?entity,entity_id) | read | audit trail |

Idempotency: POST /vouchers with `Idempotency-Key` (or body key) returns the original draft on replay;
POST /post on a POSTED voucher returns it without a second journal.
