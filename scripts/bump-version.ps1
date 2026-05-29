param()

$path = "index.html"
if (-not (Test-Path $path)) {
  Write-Error "File $path not found. Run from repository root."
  exit 1
}

$content = Get-Content $path -Raw -ErrorAction Stop
$pattern = '<span class="version-badge">v(\d+)\.(\d+)</span>'

if ($content -match $pattern) {
  $major = $matches[1]
  $minor = [int]$matches[2]
  $newMinor = $minor + 1
  $newSpan = "<span class=\"version-badge\">v$major.$newMinor</span>"
  $newContent = $content -replace $pattern, $newSpan
  Set-Content -Path $path -Value $newContent -Encoding UTF8
  Write-Output "Updated version to v$major.$newMinor"
  exit 0
} else {
  Write-Error "Version badge not found in $path"
  exit 2
}
