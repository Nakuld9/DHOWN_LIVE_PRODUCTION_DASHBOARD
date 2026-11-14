<#
.SYNOPSIS
  DHOWN MES — local READ-ONLY HTTP API over Busy 21 (.bds = Access JET4).

.DESCRIPTION
  Serves Busy company data as JSON over a localhost HTTP endpoint so other local
  tools (the MES backend, scripts) can query Busy on demand without touching ACE
  OLEDB themselves. ACE OLEDB is Windows-only, so this runs on the Windows box that
  holds BusyWin.

  STRICTLY READ-ONLY. Every connection is opened Mode=Read; the only SQL ever run
  against Busy is SELECT (the /query endpoint rejects anything else). It NEVER writes
  to Busy. Binds to 127.0.0.1 only (never exposed off the box). Optional API key.

  Endpoints (GET unless noted):
    /health                                   - liveness, no key required
    /companies                                - list company folders + FY files + name/GSTIN
    /company/<code>/info                      - company meta + table counts
    /company/<code>/masters                   - groups + ledgers (full tree + party details)
    /company/<code>/trial-balance             - per-ledger closing (SUM Value1, RecType=1)
    /company/<code>/pnl                        - profit & loss totals
    /company/<code>/balance-sheet             - balance sheet totals
    /company/<code>/ledger?account=<name|code>[&from=&to=]   - account statement
    /company/<code>/daybook?from=&to=         - day book (RecType=1 postings)
    /company/<code>/tables                    - table names + row counts
    POST /company/<code>/query  { "sql": "SELECT ..." }      - ad-hoc SELECT only

.EXAMPLE
  .\busy-api.ps1 -DataDir 'C:\BusyWin\busy dhown indusind' -Port 8765 -ApiKey 'secret'
#>
[CmdletBinding()]
param(
  [string]$DataDir = 'C:\BusyWin\busy dhown indusind',
  [int]$Port = 8765,
  [string]$ApiKey = '',
  [string]$Password = $env:BUSY_BDS_PASSWORD,
  [string]$Provider = 'Microsoft.ACE.OLEDB.12.0'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web

# ── ACE helpers (read-only) ───────────────────────────────────────────────────
function Open-Bds([string]$path) {
  $cs = "Provider=$Provider;Data Source=$path;Mode=Read;Jet OLEDB:Database Password=$Password"
  $c = New-Object System.Data.OleDb.OleDbConnection $cs
  $c.Open(); return $c
}
function Query-Bds([string]$path, [string]$sql) {
  $c = Open-Bds $path
  try {
    $da = New-Object System.Data.OleDb.OleDbDataAdapter($sql, $c)
    $dt = New-Object System.Data.DataTable
    [void]$da.Fill($dt); return , $dt
  } finally { $c.Close() }
}
function Rows-ToObjects($dt) {
  $cols = @($dt.Columns | ForEach-Object { $_.ColumnName })
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($r in $dt.Rows) {
    $o = [ordered]@{}
    foreach ($c in $cols) { $v = $r[$c]; $o[$c] = $(if ($v -is [System.DBNull]) { $null } else { $v }) }
    $out.Add([pscustomobject]$o)
  }
  return $out
}
function R2([double]$x) { [math]::Round($x, 2) }

# A SELECT is the only statement we will run against Busy.
function Assert-ReadOnlySql([string]$sql) {
  $s = ($sql -replace '\s+', ' ').Trim()
  if ($s -notmatch '^(?i)select\s') { throw 'Only SELECT statements are allowed' }
  if ($s -match ';') { throw 'Multiple statements are not allowed' }
  if ($s -match '(?i)\b(insert|update|delete|drop|alter|create|exec|execute|into|update|merge)\b') { throw 'Write / DDL keywords are not allowed' }
  return $s
}

# ── company discovery ─────────────────────────────────────────────────────────
function Get-Companies {
  $list = New-Object System.Collections.Generic.List[object]
  if (-not (Test-Path $DataDir)) { return $list }
  foreach ($d in (Get-ChildItem -Path $DataDir -Directory -Filter 'COMP*' -ErrorAction SilentlyContinue | Sort-Object Name)) {
    $fy = Get-ChildItem -Path $d.FullName -Filter 'db1*.bds' -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
    if (-not $fy) { continue }
    $name = $d.Name; $gstin = $null
    # Company meta lives in the FY db and/or the metadata db (db.bds); try both.
    foreach ($src in @($fy.FullName, (Join-Path $d.FullName 'db.bds'))) {
      if (($name -ne $d.Name) -and $gstin) { break }
      if (-not (Test-Path $src)) { continue }
      try {
        $cm = Query-Bds $src "SELECT TOP 1 * FROM Company"
        if ($cm.Rows.Count) {
          $r = $cm.Rows[0]
          foreach ($col in @('Name', 'CompName', 'CompanyName')) { if ($cm.Columns.Contains($col) -and $r[$col] -isnot [System.DBNull] -and "$($r[$col])".Trim()) { $name = [string]$r[$col]; break } }
          foreach ($col in @('GSTIN', 'GSTNo', 'GSTINNo')) { if ($cm.Columns.Contains($col) -and $r[$col] -isnot [System.DBNull] -and "$($r[$col])".Trim()) { $gstin = [string]$r[$col]; break } }
        }
      } catch { }
    }
    $list.Add([pscustomobject]@{ code = $d.Name; name = $name; gstin = $gstin; fy_db = $fy.Name; path = $fy.FullName })
  }
  return $list
}
function Resolve-Company([string]$code) {
  $c = Get-Companies | Where-Object { $_.code -ieq $code } | Select-Object -First 1
  if (-not $c) { throw "Company '$code' not found under $DataDir" }
  return $c
}

# ── accounting model (shared with extract-busy.ps1 / reports.ps1) ──────────────
$ASSET_PRIM = 102, 104, 105, 107, 1462, 2272
$LIAB_PRIM = 101, 103, 106, 110
$PL_PRIM = 109
$PLRES_PRIM = 108
$INCOME_GRP = 123, 126, 127
$EXPENSE_GRP = 122, 124, 125

function Load-Masters([string]$path) {
  $mst = @{}
  foreach ($row in (Query-Bds $path "SELECT Code,Name,MasterType,ParentGrp FROM Master1").Rows) {
    $mst[[int]$row.Code] = [pscustomobject]@{ Code = [int]$row.Code; Name = [string]$row.Name; Type = [int]$row.MasterType; Parent = $(if ($row.ParentGrp -is [System.DBNull]) { 0 } else { [int]$row.ParentGrp }) }
  }
  return $mst
}
function Get-Path2($mst, [int]$code) {
  $path = @(); $cur = $code; $seen = @{}
  while ($cur -and $mst.ContainsKey($cur) -and -not $seen.ContainsKey($cur)) {
    $seen[$cur] = $true; $path += $cur
    if ($mst[$cur].Parent -eq 0) { break }
    $cur = $mst[$cur].Parent
  }
  return , $path
}
function Classify2($mst, [int]$code) {
  $path = Get-Path2 $mst $code
  if (-not $path) { return @{ Section = 'BS'; Nature = 'Liability'; Primary = '(unknown)' } }
  $prim = $path[-1]
  $primName = if ($mst.ContainsKey($prim)) { $mst[$prim].Name } else { "($prim)" }
  if ($prim -eq $PL_PRIM) {
    $nat = 'Expense'
    foreach ($c in $path) { if ($INCOME_GRP -contains $c) { $nat = 'Income'; break }; if ($EXPENSE_GRP -contains $c) { $nat = 'Expense'; break } }
    return @{ Section = 'PL'; Nature = $nat; Primary = $primName }
  }
  if ($prim -eq $PLRES_PRIM) { return @{ Section = 'BS'; Nature = 'Liability'; Primary = $primName } }
  if ($ASSET_PRIM -contains $prim) { return @{ Section = 'BS'; Nature = 'Asset'; Primary = $primName } }
  if ($LIAB_PRIM  -contains $prim) { return @{ Section = 'BS'; Nature = 'Liability'; Primary = $primName } }
  if ($primName -match '(?i)asset|investment|cash|bank|debtor|stock|advance|deposit|receivable|fixed') { return @{ Section = 'BS'; Nature = 'Asset'; Primary = $primName } }
  return @{ Section = 'BS'; Nature = 'Liability'; Primary = $primName }
}
function Get-Movements([string]$path) {
  $mv = @{}
  foreach ($row in (Query-Bds $path "SELECT MasterCode1, SUM(Value1) AS mv FROM Tran2 WHERE RecType=1 GROUP BY MasterCode1").Rows) {
    $mv[[int]$row.MasterCode1] = [double]$row.mv
  }
  return $mv
}

# ── report builders ───────────────────────────────────────────────────────────
function Build-Masters([string]$path) {
  $addr = @{}
  try {
    foreach ($r in (Query-Bds $path "SELECT MasterCode, GSTNo, ITPAN, Address1, Address2, Address3, Address4, PINCode, Mobile, TelNo, Email FROM MasterAddressInfo").Rows) {
      $g = $(if ($r.GSTNo -is [System.DBNull]) { '' } else { ([string]$r.GSTNo).Trim() })
      $parts = @('Address1', 'Address2', 'Address3', 'Address4') | ForEach-Object { if ($r[$_] -isnot [System.DBNull]) { ([string]$r[$_]).Trim() } } | Where-Object { $_ }
      $addr[[int]$r.MasterCode] = [pscustomobject]@{
        gstin = $g; pan = $(if ($r.ITPAN -is [System.DBNull]) { $null } else { [string]$r.ITPAN })
        address = (@($parts) -join ', '); pincode = $(if ($r.PINCode -is [System.DBNull]) { $null } else { [string]$r.PINCode })
        phone = $(if ($r.Mobile -isnot [System.DBNull] -and "$($r.Mobile)".Trim()) { [string]$r.Mobile } elseif ($r.TelNo -isnot [System.DBNull]) { [string]$r.TelNo } else { $null })
        email = $(if ($r.Email -is [System.DBNull]) { $null } else { [string]$r.Email })
      }
    }
  } catch { }
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($row in (Query-Bds $path "SELECT Code,Name,MasterType,ParentGrp,Alias,PrintName,HSNCode FROM Master1 WHERE MasterType IN (1,2) ORDER BY MasterType,Name").Rows) {
    $code = [int]$row.Code; $mt = [int]$row.MasterType
    $a = $(if ($mt -eq 2 -and $addr.ContainsKey($code)) { $addr[$code] } else { $null })
    $out.Add([pscustomobject]@{
      code = $code; name = [string]$row.Name; type = $mt; is_group = ($mt -eq 1)
      parent_code = $(if ($row.ParentGrp -is [System.DBNull]) { 0 } else { [int]$row.ParentGrp })
      alias = $(if ($row.Alias -is [System.DBNull]) { $null } else { [string]$row.Alias })
      hsn_code = $(if ($row.HSNCode -is [System.DBNull]) { $null } else { [string]$row.HSNCode })
      gstin = $(if ($a) { $a.gstin } else { $null }); pan = $(if ($a) { $a.pan } else { $null })
      address = $(if ($a) { $a.address } else { $null }); pincode = $(if ($a) { $a.pincode } else { $null })
      phone = $(if ($a) { $a.phone } else { $null }); email = $(if ($a) { $a.email } else { $null })
    })
  }
  return $out
}
function Build-TrialBalance([string]$path) {
  $mst = Load-Masters $path; $mv = Get-Movements $path
  $rows = New-Object System.Collections.Generic.List[object]; $td = 0.0; $tc = 0.0
  foreach ($code in ($mv.Keys | Sort-Object)) {
    $amt = $mv[$code]; if (([math]::Round($amt, 2)) -eq 0) { continue }; if (-not $mst.ContainsKey($code)) { continue }
    $cl = Classify2 $mst $code
    $dr = $(if ($amt -lt 0) { R2(-$amt) } else { 0.0 }); $cr = $(if ($amt -gt 0) { R2($amt) } else { 0.0 })
    $td += $dr; $tc += $cr
    $rows.Add([pscustomobject]@{ code = $code; name = $mst[$code].Name; primary = $cl.Primary; section = $cl.Section; nature = $cl.Nature; debit = $dr; credit = $cr })
  }
  return [pscustomobject]@{ rows = $rows; totals = [pscustomobject]@{ debit = R2($td); credit = R2($tc); diff = R2($td - $tc); accounts = $rows.Count } }
}
function Build-PnL([string]$path) {
  $mst = Load-Masters $path; $mv = Get-Movements $path; $inc = 0.0; $exp = 0.0
  foreach ($code in $mv.Keys) { if (-not $mst.ContainsKey($code)) { continue }; $cl = Classify2 $mst $code; if ($cl.Section -ne 'PL') { continue }; if ($cl.Nature -eq 'Income') { $inc += $mv[$code] } else { $exp += (-$mv[$code]) } }
  return [pscustomobject]@{ income = R2($inc); expense = R2($exp); net_profit = R2($inc - $exp) }
}
function Build-BalanceSheet([string]$path) {
  $mst = Load-Masters $path; $mv = Get-Movements $path; $asset = 0.0; $liab = 0.0; $inc = 0.0; $exp = 0.0
  foreach ($code in $mv.Keys) {
    if (-not $mst.ContainsKey($code)) { continue }; $cl = Classify2 $mst $code; $amt = $mv[$code]
    if ($cl.Section -eq 'BS') { if ($cl.Nature -eq 'Asset') { $asset += (-$amt) } else { $liab += $amt } }
    elseif ($cl.Section -eq 'PL') { if ($cl.Nature -eq 'Income') { $inc += $amt } else { $exp += (-$amt) } }
  }
  $net = $inc - $exp
  return [pscustomobject]@{ assets = R2($asset); liabilities_capital = R2($liab); net_profit = R2($net); diff = R2($asset - ($liab + $net)) }
}
function Build-Ledger([string]$path, [string]$account, [string]$from, [string]$to) {
  $mst = Load-Masters $path
  $code = 0
  if ($account -match '^\d+$') { $code = [int]$account }
  else {
    $hit = Query-Bds $path ("SELECT Code FROM Master1 WHERE Name='{0}' AND MasterType=2" -f ($account -replace "'", "''"))
    if ($hit.Rows.Count -eq 0) { throw "Ledger '$account' not found" }
    $code = [int]$hit.Rows[0].Code
  }
  $where = "RecType=1 AND MasterCode1=$code"
  if ($from) { $where += " AND [Date]>=#$from#" }
  if ($to) { $where += " AND [Date]<=#$to#" }
  $data = Query-Bds $path ("SELECT [Date], VchNo, VchType, MasterCode2, Value1 FROM Tran2 WHERE $where ORDER BY [Date], VchCode, SrNo")
  $run = 0.0; $rows = New-Object System.Collections.Generic.List[object]
  foreach ($r in $data.Rows) {
    $v = [double]$r.Value1; $run += (-$v); $c2 = [int]$r.MasterCode2
    $rows.Add([pscustomobject]@{
      date = ([datetime]$r.Date).ToString('yyyy-MM-dd'); vch_no = [string]$r.VchNo; vch_type = [int]$r.VchType
      contra = $(if ($mst.ContainsKey($c2)) { $mst[$c2].Name } else { '' })
      debit = $(if ($v -lt 0) { R2(-$v) } else { $null }); credit = $(if ($v -gt 0) { R2($v) } else { $null }); balance = R2($run)
    })
  }
  return [pscustomobject]@{ account = $(if ($mst.ContainsKey($code)) { $mst[$code].Name } else { "$code" }); entries = $rows.Count; closing = R2([math]::Abs($run)); closing_side = $(if ($run -ge 0) { 'Dr' } else { 'Cr' }); rows = $rows }
}
function Build-Daybook([string]$path, [string]$from, [string]$to) {
  $mst = Load-Masters $path
  $where = "RecType=1"
  if ($from) { $where += " AND [Date]>=#$from#" }
  if ($to) { $where += " AND [Date]<=#$to#" }
  $data = Query-Bds $path ("SELECT [Date], VchNo, VchType, MasterCode1, MasterCode2, Value1 FROM Tran2 WHERE $where ORDER BY [Date], VchCode, SrNo")
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($r in $data.Rows) {
    $v = [double]$r.Value1; $a1 = [int]$r.MasterCode1
    $rows.Add([pscustomobject]@{
      date = ([datetime]$r.Date).ToString('yyyy-MM-dd'); vch_no = [string]$r.VchNo; vch_type = [int]$r.VchType
      account = $(if ($mst.ContainsKey($a1)) { $mst[$a1].Name } else { "$a1" })
      debit = $(if ($v -lt 0) { R2(-$v) } else { $null }); credit = $(if ($v -gt 0) { R2($v) } else { $null })
    })
  }
  return [pscustomobject]@{ from = $from; to = $to; lines = $rows.Count; rows = $rows }
}

# ── HTTP plumbing ─────────────────────────────────────────────────────────────
function Send-Json($ctx, $obj, [int]$status = 200) {
  $json = ($obj | ConvertTo-Json -Depth 8 -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.Headers.Add('Cache-Control', 'no-store')
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)
try { $listener.Start() }
catch {
  Write-Host "Could not bind $prefix : $($_.Exception.Message)"
  Write-Host "If this is an access/URL-ACL error, run once (elevated):"
  Write-Host "  netsh http add urlacl url=$prefix user=$env:USERNAME"
  Write-Host "or run this script as Administrator."
  exit 1
}
Write-Host "Busy read-only API listening on $prefix  (data: $DataDir)"
Write-Host ("API key: {0}" -f $(if ($ApiKey) { 'required (X-API-Key)' } else { 'none' }))

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $pathSegs = $req.Url.AbsolutePath.Trim('/').Split('/')
  $route = $req.Url.AbsolutePath.Trim('/')
  try {
    if ($route -eq 'health') { Send-Json $ctx @{ ok = $true; service = 'busy-read-api'; data_dir = $DataDir; time = (Get-Date).ToString('o') }; continue }

    # API key (all routes except /health)
    if ($ApiKey -and ($req.Headers['X-API-Key'] -ne $ApiKey)) { Send-Json $ctx @{ error = 'Unauthorized' } 401; continue }

    if ($route -eq 'companies') { Send-Json $ctx @{ companies = (Get-Companies) }; continue }

    if ($pathSegs.Length -ge 3 -and $pathSegs[0] -eq 'company') {
      $co = Resolve-Company $pathSegs[1]
      $report = $pathSegs[2].ToLower()
      $q = [System.Web.HttpUtility]::ParseQueryString($req.Url.Query)
      switch ($report) {
        'info' {
          $tabs = (Query-Bds $co.path "SELECT COUNT(*) AS n FROM Master1").Rows[0].n
          Send-Json $ctx @{ company = $co; masters = [int]$tabs }
        }
        'masters' { Send-Json $ctx @{ company = $co.code; masters = (Build-Masters $co.path) } }
        'trial-balance' { Send-Json $ctx @{ company = $co.code; trial_balance = (Build-TrialBalance $co.path) } }
        'pnl' { Send-Json $ctx @{ company = $co.code; pnl = (Build-PnL $co.path) } }
        'balance-sheet' { Send-Json $ctx @{ company = $co.code; balance_sheet = (Build-BalanceSheet $co.path) } }
        'ledger' {
          $acct = $q['account']; if (-not $acct) { Send-Json $ctx @{ error = 'account query param required' } 400; continue }
          Send-Json $ctx @{ company = $co.code; ledger = (Build-Ledger $co.path $acct $q['from'] $q['to']) }
        }
        'daybook' { Send-Json $ctx @{ company = $co.code; daybook = (Build-Daybook $co.path $q['from'] $q['to']) } }
        'tables' {
          $conn = Open-Bds $co.path
          try {
            $t = $conn.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables, @($null, $null, $null, 'TABLE'))
            $names = $t | Select-Object -ExpandProperty TABLE_NAME | Sort-Object
          } finally { $conn.Close() }
          Send-Json $ctx @{ company = $co.code; tables = $names }
        }
        'query' {
          if ($req.HttpMethod -ne 'POST') { Send-Json $ctx @{ error = 'POST required' } 405; continue }
          $body = (New-Object System.IO.StreamReader($req.InputStream)).ReadToEnd()
          $sql = $null
          try { $sql = ($body | ConvertFrom-Json).sql } catch { }
          if (-not $sql) { Send-Json $ctx @{ error = 'body must be {"sql":"SELECT ..."}' } 400; continue }
          $safe = Assert-ReadOnlySql $sql
          $dt = Query-Bds $co.path $safe
          Send-Json $ctx @{ company = $co.code; rows = (Rows-ToObjects $dt); count = $dt.Rows.Count }
        }
        default { Send-Json $ctx @{ error = "Unknown report '$report'" } 404 }
      }
      continue
    }
    Send-Json $ctx @{ error = 'Not found'; routes = @('/health', '/companies', '/company/<code>/{info,masters,trial-balance,pnl,balance-sheet,ledger,daybook,tables,query}') } 404
  } catch {
    try { Send-Json $ctx @{ error = $_.Exception.Message } 500 } catch { }
  }
}
