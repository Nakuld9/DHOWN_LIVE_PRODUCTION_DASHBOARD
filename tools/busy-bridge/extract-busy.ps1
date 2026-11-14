<#
.SYNOPSIS
  DHOWN MES — Busy 21 READ BRIDGE extractor (Phase 1). READ-ONLY.

.DESCRIPTION
  Reads a Busy 21 company financial-year file (.bds = Microsoft Access JET 4.0)
  read-only via ACE OLEDB and exports the chart of accounts (Master1 groups +
  ledgers with the group tree), per-ledger opening balances, and a validated
  Trial Balance / P&L / Balance Sheet to a single JSON file in a drop folder.

  DHOWN MES runs in Docker/Linux where ACE OLEDB is unavailable, so this Windows-
  side extractor produces the JSON that the MES ingests (mirroring the Bank H2H
  drop-folder pattern). It NEVER writes to Busy — Mode=Read, SELECT only.

  Accounting model (format/03-accounting-semantics.md, validated on COMP0004):
    - Postings live in Tran2 where RecType=1 (double entry; every voucher sums to 0).
    - Value1 < 0 = Debit, Value1 > 0 = Credit.  Movement = SUM(Value1) per ledger.
    - Going-concern opening balances are themselves posted as RecType=1 entries, so
      the movement already includes them and the Trial Balance is complete.
    - Master1: MasterType 1=group, 2=ledger; ParentGrp = self-ref group tree.
  Classification uses Busy's FIXED primary group codes (same as scripts/reports.ps1),
  with a name heuristic fallback for user-added primary groups.

  Requires the 64-bit Microsoft Access Database Engine (ACE.OLEDB.12.0/16.0), which
  ships with Busy / Office.

.EXAMPLE
  # Extract the sample company into the MES drop folder
  .\extract-busy.ps1 -CompanyDir 'D:\busy21-re\samples\COMP0004' -OutDir 'D:\DHOWN_BUSY_INBOX'

.EXAMPLE
  # Extract the live Busy company, explicit FY file
  .\extract-busy.ps1 -CompanyDir 'C:\BusyWin\COMP0001' -FyDb 'db12026.bds' -OutDir 'D:\DHOWN_BUSY_INBOX'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$CompanyDir,
  [string]$FyDb,                       # e.g. db12026.bds; auto-detected if omitted
  [string]$MetaDb = 'db.bds',          # company metadata DB (optional, best-effort)
  [Parameter(Mandatory)][string]$OutDir,
  [string]$Provider = 'Microsoft.ACE.OLEDB.12.0',
  [string]$Password = $env:BUSY_BDS_PASSWORD
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $CompanyDir)) { throw "Company folder not found: $CompanyDir" }

# ---- locate the financial-year accounting DB (db<N><year>.bds, ~100 tables) ----
if (-not $FyDb) {
  $cand = Get-ChildItem -Path $CompanyDir -Filter 'db1*.bds' -File -ErrorAction SilentlyContinue |
          Sort-Object Length -Descending | Select-Object -First 1
  if (-not $cand) {
    $cand = Get-ChildItem -Path $CompanyDir -Filter '*.bds' -File -ErrorAction SilentlyContinue |
            Sort-Object Length -Descending | Select-Object -First 1
  }
  if (-not $cand) { throw "No .bds financial file found in $CompanyDir (pass -FyDb)" }
  $FyDb = $cand.Name
}
$fyPath = Join-Path $CompanyDir $FyDb
if (-not (Test-Path $fyPath)) { throw "FY file not found: $fyPath" }
$fyPath = (Resolve-Path $fyPath).Path

function Open-Bds([string]$path) {
  $cs = "Provider=$Provider;Data Source=$path;Mode=Read;Jet OLEDB:Database Password=$Password"
  $c = New-Object System.Data.OleDb.OleDbConnection $cs
  $c.Open(); return $c
}
function Q($conn, $sql) {
  $da = New-Object System.Data.OleDb.OleDbDataAdapter($sql, $conn)
  $dt = New-Object System.Data.DataTable; [void]$da.Fill($dt); return ,$dt
}
function R2([double]$x) { [math]::Round($x, 2) }

Write-Host "Reading $fyPath ..."
$conn = Open-Bds $fyPath
try {
  # ---- masters (groups + ledgers + the full tree) ----
  $MST = @{}
  # Party / ledger details from MasterAddressInfo (GSTIN, PAN, address, contact),
  # pre-flattened into a code -> primitive-hashtable map (no live DataRows kept).
  function Val($r, $n) { $v = $r[$n]; if ($null -ne $v -and $v -isnot [System.DBNull]) { ([string]$v).Trim() } else { '' } }
  $script:addrMap = @{}
  try {
    $atab = Q $conn "SELECT MasterCode, GSTNo, ITPAN, Address1, Address2, Address3, Address4, StateCodeLong, PINCode, Mobile, TelNo, Email, Contact, WhatsAppNo FROM MasterAddressInfo"
    foreach ($r in $atab.Rows) {
      $g = Val $r 'GSTNo'
      $parts = @((Val $r 'Address1'), (Val $r 'Address2'), (Val $r 'Address3'), (Val $r 'Address4')) | Where-Object { $_ }
      $mob = Val $r 'Mobile'
      $script:addrMap[[int]$r.MasterCode] = @{
        gstin = $g; pan = (Val $r 'ITPAN'); address = (@($parts) -join ', ')
        pincode = (Val $r 'PINCode'); state_code = $(if ($g.Length -ge 2) { $g.Substring(0, 2) } else { '' })
        phone = $(if ($mob) { $mob } else { Val $r 'TelNo' }); email = (Val $r 'Email')
        contact = (Val $r 'Contact'); whatsapp = (Val $r 'WhatsAppNo')
      }
    }
  } catch { Write-Host "  (MasterAddressInfo not read: $($_.Exception.Message))" }

  $masters = New-Object System.Collections.Generic.List[object]
  foreach ($row in (Q $conn "SELECT Code,Name,MasterType,ParentGrp,Alias,PrintName,HSNCode FROM Master1").Rows) {
    $code = [int]$row.Code
    $mt   = [int]$row.MasterType
    $obj = [pscustomobject]@{
      Code = $code; Name = [string]$row.Name; Type = $mt
      Parent = $(if ($row.ParentGrp -isnot [System.DBNull]) { [int]$row.ParentGrp } else { 0 })
    }
    $MST[$code] = $obj
    # only groups (1) and ledgers (2) go into the accounting mirror
    if ($mt -eq 1 -or $mt -eq 2) {
      $d = $(if ($mt -eq 2) { $script:addrMap[$code] } else { $null })
      $masters.Add([pscustomobject]@{
        code        = $code
        name        = [string]$row.Name
        type        = $mt
        is_group    = ($mt -eq 1)
        parent_code = $obj.Parent
        alias       = $(if ($row.Alias -is [System.DBNull]) { $null } else { [string]$row.Alias })
        print_name  = $(if ($row.PrintName -is [System.DBNull]) { $null } else { [string]$row.PrintName })
        hsn_code    = $(if ($row.HSNCode -is [System.DBNull]) { $null } else { [string]$row.HSNCode })
        gstin       = $(if ($d -and $d.gstin) { $d.gstin } else { $null })
        pan         = $(if ($d -and $d.pan) { $d.pan } else { $null })
        address     = $(if ($d -and $d.address) { $d.address } else { $null })
        state_code  = $(if ($d -and $d.state_code) { $d.state_code } else { $null })
        pincode     = $(if ($d -and $d.pincode) { $d.pincode } else { $null })
        phone       = $(if ($d -and $d.phone) { $d.phone } else { $null })
        email       = $(if ($d -and $d.email) { $d.email } else { $null })
        contact     = $(if ($d -and $d.contact) { $d.contact } else { $null })
        whatsapp    = $(if ($d -and $d.whatsapp) { $d.whatsapp } else { $null })
      })
    }
  }

  function Get-Path([int]$code) {
    $path = @(); $cur = $code; $seen = @{}
    while ($cur -and $MST.ContainsKey($cur) -and -not $seen.ContainsKey($cur)) {
      $seen[$cur] = $true; $path += $cur
      if ($MST[$cur].Parent -eq 0) { break }
      $cur = $MST[$cur].Parent
    }
    return ,$path
  }
  # Busy FIXED primary group codes (see scripts/reports.ps1 / format/03).
  $ASSET_PRIM  = 102, 104, 105, 107, 1462, 2272
  $LIAB_PRIM   = 101, 103, 106, 110
  $PL_PRIM     = 109
  $PLRES_PRIM  = 108
  $INCOME_GRP  = 123, 126, 127
  $EXPENSE_GRP = 122, 124, 125
  function Classify([int]$ledgerCode) {
    $path = Get-Path $ledgerCode
    if (-not $path) { return @{ Section = 'BS'; Nature = 'Liability'; Primary = '(unknown)'; PrimaryCode = 0 } }
    $prim = $path[-1]
    $primName = if ($MST.ContainsKey($prim)) { $MST[$prim].Name } else { "($prim)" }
    if ($prim -eq $PL_PRIM) {
      $nat = 'Expense'
      foreach ($c in $path) { if ($INCOME_GRP -contains $c) { $nat = 'Income'; break }; if ($EXPENSE_GRP -contains $c) { $nat = 'Expense'; break } }
      return @{ Section = 'PL'; Nature = $nat; Primary = $primName; PrimaryCode = $prim }
    }
    if ($prim -eq $PLRES_PRIM) { return @{ Section = 'BS'; Nature = 'Liability'; Primary = $primName; PrimaryCode = $prim } }
    if ($ASSET_PRIM -contains $prim) { return @{ Section = 'BS'; Nature = 'Asset'; Primary = $primName; PrimaryCode = $prim } }
    if ($LIAB_PRIM  -contains $prim) { return @{ Section = 'BS'; Nature = 'Liability'; Primary = $primName; PrimaryCode = $prim } }
    if ($primName -match '(?i)asset|investment|cash|bank|debtor|stock|advance|deposit|receivable|fixed') { return @{ Section = 'BS'; Nature = 'Asset'; Primary = $primName; PrimaryCode = $prim } }
    return @{ Section = 'BS'; Nature = 'Liability'; Primary = $primName; PrimaryCode = $prim }
  }

  # ---- movement per ledger (THE rule) + whole-book integrity ----
  $MOVE = @{}
  foreach ($row in (Q $conn "SELECT MasterCode1, SUM(Value1) AS mv FROM Tran2 WHERE RecType=1 GROUP BY MasterCode1").Rows) {
    $MOVE[[int]$row.MasterCode1] = [double]$row.mv
  }
  $bookSum = ([double]((Q $conn "SELECT SUM(Value1) AS s FROM Tran2 WHERE RecType=1").Rows[0].s))

  # ---- trial balance rows (non-zero), classified ----
  $tb = New-Object System.Collections.Generic.List[object]
  $td = 0.0; $tc = 0.0
  foreach ($code in ($MOVE.Keys | Sort-Object)) {
    $amt = $MOVE[$code]
    # NB: write `[math]::Round($amt,2) -eq 0`, never `R2($amt) -eq 0` — the latter
    # parses as the command `R2` swallowing `-eq 0` as arguments (PowerShell gotcha).
    if (([math]::Round($amt, 2)) -eq 0) { continue }
    if (-not $MST.ContainsKey($code)) { continue }
    $cl = Classify $code
    $debit  = if ($amt -lt 0) { R2(-$amt) } else { 0.0 }
    $credit = if ($amt -gt 0) { R2($amt) }  else { 0.0 }
    $td += $debit; $tc += $credit
    $tb.Add([pscustomobject]@{
      code = $code; name = $MST[$code].Name
      primary_code = $cl.PrimaryCode; primary_name = $cl.Primary
      section = $cl.Section; nature = $cl.Nature
      debit = $debit; credit = $credit
    })
  }

  # ---- P&L + Balance Sheet (rolled up over the group tree) ----
  $inc = 0.0; $exp = 0.0; $asset = 0.0; $liab = 0.0
  foreach ($code in $MOVE.Keys) {
    if (-not $MST.ContainsKey($code)) { continue }
    $amt = $MOVE[$code]; $cl = Classify $code
    if ($cl.Section -eq 'PL') {
      if ($cl.Nature -eq 'Income') { $inc += $amt } else { $exp += (-$amt) }
    } else {
      if ($cl.Nature -eq 'Asset') { $asset += (-$amt) } else { $liab += $amt }
    }
  }
  $net = $inc - $exp

  # ---- company metadata (best-effort, optional) ----
  $company = [ordered]@{ name = (Split-Path $CompanyDir -Leaf); gstin = $null; state = $null }
  try {
    $cm = (Q $conn "SELECT TOP 1 * FROM Company")
    if ($cm.Rows.Count -gt 0) {
      $r = $cm.Rows[0]
      foreach ($col in @('Name', 'CompName', 'CompanyName')) { if ($cm.Columns.Contains($col) -and $r[$col] -isnot [System.DBNull]) { $company.name = [string]$r[$col]; break } }
      foreach ($col in @('GSTIN', 'GSTNo', 'GSTINNo')) { if ($cm.Columns.Contains($col) -and $r[$col] -isnot [System.DBNull]) { $company.gstin = [string]$r[$col]; break } }
    }
  } catch { }
  # fall back to the metadata DB for company name/GSTIN if the FY db had no Company table
  if (-not $company.gstin) {
    $metaPath = Join-Path $CompanyDir $MetaDb
    if (Test-Path $metaPath) {
      try {
        $mc = Open-Bds ((Resolve-Path $metaPath).Path)
        try {
          $cm = (Q $mc "SELECT TOP 1 * FROM Company")
          if ($cm.Rows.Count -gt 0) {
            $r = $cm.Rows[0]
            foreach ($col in @('Name', 'CompName', 'CompanyName')) { if ($cm.Columns.Contains($col) -and $r[$col] -isnot [System.DBNull]) { $company.name = [string]$r[$col]; break } }
            foreach ($col in @('GSTIN', 'GSTNo', 'GSTINNo')) { if ($cm.Columns.Contains($col) -and $r[$col] -isnot [System.DBNull]) { $company.gstin = [string]$r[$col]; break } }
            foreach ($col in @('StateCode', 'State')) { if ($cm.Columns.Contains($col) -and $r[$col] -isnot [System.DBNull]) { $company.state = [string]$r[$col]; break } }
          }
        } finally { $mc.Close() }
      } catch { }
    }
  }
  if ($company.gstin -and -not $company.state) { $company.state = $company.gstin.Substring(0, 2) }

  # ---- file hash (provenance / de-dupe) ----
  $hash = (Get-FileHash -Path $fyPath -Algorithm SHA256).Hash.ToLower()

  $groupsCount = ($masters | Where-Object { $_.is_group }).Count
  $ledgersCount = ($masters | Where-Object { -not $_.is_group }).Count

  $payload = [ordered]@{
    schema       = 'busy-mirror/v1'
    extracted_at = (Get-Date).ToString('o')
    source = [ordered]@{
      company_dir = (Resolve-Path $CompanyDir).Path
      fy_db       = $FyDb
      db_sha256   = $hash
      provider    = $Provider
    }
    company       = $company
    masters       = $masters
    openings      = @()   # going-concern openings are posted as RecType=1 entries → already in movement
    trial_balance = $tb
    totals = [ordered]@{
      accounts          = $tb.Count
      masters_total     = $masters.Count
      groups            = $groupsCount
      ledgers           = $ledgersCount
      debit             = R2($td)
      credit            = R2($tc)
      diff              = R2($td - $tc)
      book_rectype1_sum = R2($bookSum)
    }
    pnl = [ordered]@{ income = R2($inc); expense = R2($exp); net_profit = R2($net) }
    balance_sheet = [ordered]@{
      assets        = R2($asset)
      liab_capital  = R2($liab)
      net_profit    = R2($net)
      diff          = R2($asset - ($liab + $net))
    }
  }

  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $safeCo = ($company.name -replace '[^A-Za-z0-9_-]', '_')
  $outFile = Join-Path $OutDir ("busy-extract_{0}_{1}.json" -f $safeCo, $stamp)
  # -Depth so nested master/tb arrays serialize fully. Write UTF-8 WITHOUT a BOM
  # (Windows PowerShell's Out-File -Encoding UTF8 prepends a BOM that breaks a
  # strict JSON.parse on the ingest side).
  $json = $payload | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding $false))

  Write-Host ""
  Write-Host ("BUSY EXTRACT written -> {0}" -f $outFile)
  Write-Host ("  company   : {0}  (GSTIN {1})" -f $company.name, $(if ($company.gstin) { $company.gstin } else { '-' }))
  Write-Host ("  masters   : {0} groups + {1} ledgers" -f $groupsCount, $ledgersCount)
  Write-Host ("  TB accts  : {0}" -f $tb.Count)
  Write-Host ("  Debit     : {0:N2}" -f $td)
  Write-Host ("  Credit    : {0:N2}" -f $tc)
  Write-Host ("  Diff      : {0:N2}   (0 = balanced)" -f ($td - $tc))
  Write-Host ("  Book sum  : {0:N2}   (0 = double-entry intact)" -f $bookSum)
  Write-Host ("  Net profit: {0:N2}" -f $net)
  Write-Host ("  BS diff   : {0:N2}   (0 = balanced)" -f ($asset - ($liab + $net)))
}
finally { $conn.Close() }
