# Minimal static file server using HttpListener
param(
  [int]$Port = 8000
)
$root = Get-Location
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Serving $root on $prefix"
while ($listener.IsListening) {
  $context = $listener.GetContext()
  Start-Job -ArgumentList $context,$root -ScriptBlock {
    param($context,$root)
    try {
      $req = $context.Request
      $res = $context.Response
      $url = [System.Uri]::UnescapeDataString($req.RawUrl.TrimStart('/'))
      if ($url -eq '') { $url = 'index.html' }
      $file = Join-Path $root $url
      if (-not (Test-Path $file)) {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
        return
      }
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $mime = switch ($ext) {
        '.html' { 'text/html' }
        '.js'   { 'application/javascript' }
        '.css'  { 'text/css' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.svg'  { 'image/svg+xml' }
        default { 'application/octet-stream' }
      }
      $res.ContentType = $mime
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes,0,$bytes.Length)
      $res.Close()
    } catch {
      Write-Host "Serve error: $_"
    }
  } | Out-Null
}
$listener.Stop()
$listener.Close()
