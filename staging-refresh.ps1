# DHOWN MES — refresh the STAGING database from a fresh copy of production.
#
# Creates/replaces  dhown_mes_staging  with a current snapshot of  dhown_mes,
# so you can test changes against prod-like data without touching production.
# Run this, then start staging with start-staging.bat and test at http://localhost:4001.
#
# Reads DB credentials from backend/.env. Safe: only writes the *_staging DB.

$ErrorActionPreference = 'Stop'
$backend = 'D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend'
$prod = 'dhown_mes'
$stage = 'dhown_mes_staging'

# --- read creds from .env ---
$envMap = @{}
Get-Content (Join-Path $backend '.env') | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $i = $_.IndexOf('='); $envMap[$_.Substring(0, $i)] = $_.Substring($i + 1)
}
$pgbin = $envMap['PG_BIN']; if (-not $pgbin) { $pgbin = 'C:\Program Files\PostgreSQL\18\bin' }
$dbHost = $envMap['DB_HOST']; if (-not $dbHost) { $dbHost = 'localhost' }
$user = $envMap['DB_USER']; if (-not $user) { $user = 'postgres' }
$env:PGPASSWORD = $envMap['DB_PASSWORD']
$pgdump = Join-Path $pgbin 'pg_dump.exe'
$psql   = Join-Path $pgbin 'psql.exe'
$snap   = Join-Path $env:TEMP 'dhown_prod_snapshot.sql'

Write-Output "1/4  Dumping $prod ..."
& $pgdump -h $dbHost -U $user -d $prod -f $snap
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }

Write-Output "2/4  Dropping old $stage (terminating its connections) ..."
& $psql -h $dbHost -U $user -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$stage' AND pid<>pg_backend_pid();" | Out-Null
& $psql -h $dbHost -U $user -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $stage;"
if ($LASTEXITCODE -ne 0) { throw "drop staging failed" }

Write-Output "3/4  Creating fresh $stage ..."
& $psql -h $dbHost -U $user -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $stage;"
if ($LASTEXITCODE -ne 0) { throw "create staging failed" }

Write-Output "4/4  Restoring snapshot into $stage ..."
& $psql -h $dbHost -U $user -d $stage -q -f $snap | Out-Null
Remove-Item $snap -ErrorAction SilentlyContinue

$rows = & $psql -h $dbHost -U $user -d $stage -t -A -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"
Write-Output ""
Write-Output "DONE  $stage refreshed from $prod ($($rows.Trim()) tables)."
Write-Output "      Start it with: start-staging.bat   ->  http://localhost:4001"
