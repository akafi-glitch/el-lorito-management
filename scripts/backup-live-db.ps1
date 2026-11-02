# Backs up the live database to a file outside the repository. It only reads, in one read-only
# transaction. The password is typed here, never saved, and only given to pg_dump for this run.
#
# Needs pg_dump 17 or newer. Docker isn't required, unlike `supabase db dump`.
# Run it from PowerShell:  & .\scripts\backup-live-db.ps1
param(
  [string]$ProjectRef = "yshypzeuqzgattkvmzak",
  [string]$BackupDir = (Join-Path $env:USERPROFILE "Documents\el-lorito-backups"),
  [string]$PgBin = (Join-Path $env:USERPROFILE "el-lorito-tools\pgsql-17\bin")
)

$pgDump = Join-Path $PgBin "pg_dump.exe"
$pgRestore = Join-Path $PgBin "pg_restore.exe"
if (-not (Test-Path $pgDump) -or -not (Test-Path $pgRestore)) {
  Write-Host "pg_dump and pg_restore weren't found in $PgBin" -ForegroundColor Red
  exit 2
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$target = Join-Path $BackupDir "el-lorito-$stamp.dump"
$partial = "$target.partial"

Write-Host ""
Write-Host "Your database password is in Supabase: Project Settings, Database."
Write-Host "Nothing appears on screen as you type or paste it."
$secure = Read-Host "Database password" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
}
$env:PGSSLMODE = "require"
# Give up instead of waiting forever if the pooler accepts the connection and then goes quiet.
$env:PGCONNECT_TIMEOUT = "30"

# The project's direct address is IPv6 only, so go through the session pooler. Which pooler a project
# lives on isn't exposed anywhere handy, so try both; a "tenant not found" from the wrong one is normal.
$succeeded = $false
try {
  foreach ($poolerHost in "aws-0-us-east-1.pooler.supabase.com", "aws-1-us-east-1.pooler.supabase.com") {
    Write-Host "Trying $poolerHost ..."
    & $pgDump --host=$poolerHost --port=5432 --username="postgres.$ProjectRef" --dbname=postgres `
      --format=custom --lock-wait-timeout=10s --no-password `
      --schema=public --schema=private --schema=auth --schema=supabase_migrations `
      --file=$partial
    if ($LASTEXITCODE -eq 0) {
      $succeeded = $true
      break
    }
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue
  Remove-Item Env:\PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
}

if (-not $succeeded) {
  Write-Host ""
  Write-Host "The backup failed and no file was kept. If it says the password failed, check it and" -ForegroundColor Red
  Write-Host "try again, but not many times in a row, because Supabase blocks repeated failures." -ForegroundColor Red
  exit 1
}

# A file that can't be read back isn't a backup.
$entries = & $pgRestore --list $partial
if ($LASTEXITCODE -ne 0 -or -not $entries) {
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  Write-Host "The file couldn't be read back, so it wasn't kept." -ForegroundColor Red
  exit 1
}
Move-Item -LiteralPath $partial -Destination $target

Write-Host ""
Write-Host "Backup saved: $target" -ForegroundColor Green
Write-Host ("Size: {0:N0} KB, {1} items" -f ((Get-Item $target).Length / 1KB), $entries.Count)
Write-Host "It holds staff and account data, so keep a copy somewhere private, not in the repository."
