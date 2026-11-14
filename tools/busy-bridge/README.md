# Busy bridge tools (Windows, read-only)

Busy 21 stores each company as a password-protected **Microsoft Access JET 4.0** `.bds`
(fixed Jet password `<set via BUSY_BDS_PASSWORD env var>`), readable only via **ACE OLEDB, which is Windows-only**.
These tools run on the Windows box that holds `C:\BusyWin\...` and expose Busy **read-only**
(every connection is `Mode=Read`, SELECT only). They **never write to Busy**.

## 1. `busy-api.ps1` — local READ-ONLY HTTP API (live)

A localhost JSON API so the MES backend / scripts can query Busy on demand (no ACE needed
on their side). Binds `http://127.0.0.1:8765` only.

```bat
tools\busy-bridge\busy-api.bat          REM or:
powershell -NoProfile -ExecutionPolicy Bypass -File tools\busy-bridge\busy-api.ps1 ^
  -DataDir "C:\BusyWin\busy dhown indusind" -Port 8765 [-ApiKey "secret"]
```

| Method | Route | Returns |
|---|---|---|
| GET | `/health` | liveness (no key) |
| GET | `/companies` | company folders + FY file + name/GSTIN |
| GET | `/company/<code>/info` | company meta |
| GET | `/company/<code>/masters` | groups + ledgers (tree + GSTIN/PAN/address) |
| GET | `/company/<code>/trial-balance` | per-ledger closing (SUM Value1, RecType=1) |
| GET | `/company/<code>/pnl` · `/balance-sheet` | P&L / BS totals |
| GET | `/company/<code>/ledger?account=<name\|code>[&from=&to=]` | account statement |
| GET | `/company/<code>/daybook?from=&to=` | day book |
| GET | `/company/<code>/tables` | table names |
| POST | `/company/<code>/query` `{"sql":"SELECT ..."}` | ad-hoc **SELECT only** (writes/DDL/multi-statement rejected) |

- Optional `-ApiKey` → require `X-API-Key` header on every route except `/health`.
- If binding fails with a URL-ACL/access error, run once (elevated):
  `netsh http add urlacl url=http://127.0.0.1:8765/ user=%USERNAME%` — or run the script as Administrator.
- Dates for `from`/`to` are `YYYY-MM-DD` (or any Access-parseable date).
- To run persistently: schedule `busy-api.bat` at logon, or install as a Windows service
  (node-windows / nssm), like the other DHOWN services.

Verified on COMP0004 (DHOWN FY 26-27): trial balance Dr=Cr=₹26,54,42,885.41, 835 ledgers
(519 with GSTIN), net profit ₹1,37,96,487.67.

## 2. `extract-busy.ps1` — batch extract to JSON (drop-folder pipeline)

One-shot export of masters + Trial Balance + P&L/BS to a `busy-mirror/v1` JSON, for the MES
drop-folder poller (`BUSY_INBOX_DIR`) to ingest into the `acct` mirror. See
`docs/accounting/BUSY_READ_BRIDGE.md`.

```bat
tools\busy-bridge\extract-busy.ps1 -CompanyDir "C:\BusyWin\busy dhown indusind\COMP0004" -OutDir "D:\DHOWN_BUSY_INBOX"
```

## Gotchas (do not reintroduce)
- Never `R2($x) -eq 0` in PowerShell — it parses as the command `R2` swallowing `-eq 0`. Use `[math]::Round($x,2) -eq 0`.
- Write JSON BOM-less (`[System.IO.File]::WriteAllText(..., UTF8Encoding $false)`), not `Out-File -Encoding UTF8`.
