param()

$hookPath = ".git/hooks/pre-commit"
$hookContent = @'
#!/bin/sh
# Auto-bump version badge in index.html before each commit (if present)
ROOT_DIR="$(git rev-parse --show-toplevel)"
SCRIPT="$ROOT_DIR/scripts/bump-version.ps1"
if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT"
elif command -v powershell >/dev/null 2>&1; then
  powershell -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT"
fi
git add index.html
'@

Set-Content -Path $hookPath -Value $hookContent -Encoding UTF8
if ($IsWindows) {
  # ensure the hook is executable for environments that respect file mode
  try { & git update-index --chmod=+x $hookPath } catch { }
}
Write-Output "Installed pre-commit hook at $hookPath"
