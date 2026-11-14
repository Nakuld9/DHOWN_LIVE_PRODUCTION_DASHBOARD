# Off-site backup sync — copies local DB backups to the Google Drive folder.
#
# WHY THIS EXISTS: the MES Windows service (dhownmes.exe) runs as LocalSystem, and
# Google Drive's G: is a PER-USER virtual drive that only exists inside the
# interactive user's session. So the service's own copyToSecondary step fails with
# EPERM every night and the off-site copy silently rotted for ~5 weeks.
#
# This script runs as the logged-in user (via a Scheduled Task set to "run only
# when logged on"), so G: is present exactly when this runs. On success it writes
# a marker file that the SERVICE can read (it lives on the local D: drive), so the
# AI-Insights staleness alert can warn if the off-site copy stops working again.
#
# Idempotent: robocopy only copies files newer than the destination.

$ErrorActionPreference = 'Stop'
$local  = 'D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend\backups'
$remote = 'G:\My Drive\DHOWN_MES_Backups'
$marker = Join-Path $local '.offsite_last_sync'
$logf   = Join-Path $local 'offsite-sync.log'

function Log($m) { "$([DateTime]::Now.ToString('s'))  $m" | Add-Content -Path $logf -Encoding utf8 }

try {
  if (-not (Test-Path $local))  { throw "local backup dir missing: $local" }
  if (-not (Test-Path $remote)) { throw "Google Drive folder not available (not logged on / Drive not mounted): $remote" }

  # 1) DB dumps (daily + hourly) — copy newer only.
  robocopy $local $remote 'dhown_mes_*.sql' /XO /R:2 /W:2 /NJH /NJS /NDL /NP | Out-Null
  $rc = $LASTEXITCODE   # robocopy: <8 = success (0 none, 1 copied, 3 copied+extra, ...)

  # 2) WhatsApp media folders (media_YYYY-MM-DD).
  Get-ChildItem $local -Directory -Filter 'media_*' -ErrorAction SilentlyContinue | ForEach-Object {
    robocopy $_.FullName (Join-Path $remote $_.Name) /E /XO /R:1 /W:1 /NJH /NJS /NDL /NP | Out-Null
  }

  if ($rc -ge 8) { throw "robocopy reported errors (exit $rc)" }

  # Success marker the LocalSystem service can read (lives on D:, not G:).
  [DateTime]::Now.ToString('o') | Set-Content -Path $marker -Encoding ascii
  Log "offsite sync OK (robocopy rc=$rc)"
  Write-Output "Off-site backup sync OK (rc=$rc)"
  exit 0
}
catch {
  Log "offsite sync FAILED: $($_.Exception.Message)"
  Write-Error $_.Exception.Message
  exit 1
}
