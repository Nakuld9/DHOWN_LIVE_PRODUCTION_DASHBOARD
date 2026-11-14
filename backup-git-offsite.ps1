# DHOWN MES — off-site git backup.
# Creates a full-history git bundle (all local branches + tags) and drops it in the
# Google Drive folder, then keeps the newest N. A bundle is a single file that can
# fully restore the repository (`git clone <bundle>`), so this is a real off-site
# backup without pushing to any hosted service.
#
# Runs as the logged-in user (nakul) so the mapped G: drive is visible — a
# LocalSystem service cannot see a per-user mapped drive.
#
# Register (once, as your user):
#   schtasks /create /tn "DHOWN Git Offsite Backup" /sc DAILY /st 20:30 /f ^
#     /tr "powershell -NoProfile -ExecutionPolicy Bypass -File \"D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backup-git-offsite.ps1\""
#
# Note: git writes progress/success to stderr, so we DO NOT use 2>&1 (in PS 5.1 that
# turns success text into errors). We trust $LASTEXITCODE instead.

$repo   = 'D:\DHOWN_LIVE_PRODUCTION_DASHBOARD'
$dest   = 'G:\My Drive\DHOWN_BACKUPS\git'      # off-site (Google Drive, synced)
$keep   = 14                                   # newest bundles to retain
$stamp  = Get-Date -Format 'yyyy-MM-dd_HHmm'
$logDir = Join-Path $repo 'logs'

function Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  Write-Output $line
  try { New-Item -ItemType Directory -Force -Path $logDir -ErrorAction Stop | Out-Null
        Add-Content -Path (Join-Path $logDir 'git-offsite-backup.log') -Value $line -Encoding utf8 } catch {}
}

try {
  if (-not (Test-Path 'G:\')) { throw 'G: drive not available (Google Drive not mounted / not logged in). Backup skipped.' }
  New-Item -ItemType Directory -Force -Path $dest -ErrorAction Stop | Out-Null

  Set-Location $repo
  $file = Join-Path $dest "dhown_mes_$stamp.bundle"

  # Full history, restorable. Let git print to the console; judge success by exit code.
  git bundle create "$file" --branches --tags
  if ($LASTEXITCODE -ne 0) { throw "git bundle create failed (exit $LASTEXITCODE)" }

  git bundle verify "$file" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git bundle verify FAILED for $file" }

  if (-not (Test-Path $file)) { throw "bundle file missing after create: $file" }
  $sizeMB = [math]::Round((Get-Item $file).Length / 1MB, 1)
  Log "OK  wrote $file ($sizeMB MB)"

  # Retention: keep the newest $keep bundles, delete older.
  Get-ChildItem $dest -Filter 'dhown_mes_*.bundle' |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $keep |
    ForEach-Object { Remove-Item $_.FullName -Force; Log "pruned old bundle $($_.Name)" }

  Log "DONE  off-site git backup complete."
  exit 0
}
catch {
  Log "ERROR  $($_.Exception.Message)"
  exit 1
}
