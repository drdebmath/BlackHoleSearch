param()

Write-Output "Running bump-version..."
& pwsh -NoProfile -ExecutionPolicy Bypass -File "./scripts/bump-version.ps1" 2>$null
if ($LASTEXITCODE -ne 0) {
  # Try powershell if pwsh not available
  & powershell -NoProfile -ExecutionPolicy Bypass -File "./scripts/bump-version.ps1"
}

if ($LASTEXITCODE -ne 0) {
  Write-Error "bump-version failed. Aborting commit/push."
  exit $LASTEXITCODE
}

$content = Get-Content index.html -Raw
if ($content -match 'v(\d+)\.(\d+)') {
  $major = $matches[1]; $minor = [int]$matches[2]
  $new = "v$major.$minor"
  git add index.html
  git commit -m "Bump version to $new"
  git push
  Write-Output "Bumped and pushed $new"
} else {
  Write-Error "Could not locate new version after bump."
}
