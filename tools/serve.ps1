<#
  serve.ps1 – minimaler statischer HTTP-Server (nur für lokale Vorschau).
  Kein Bestandteil der App; GitHub Pages braucht ihn nicht.
  Start:  powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123
#>
param(
  [int]$Port = 8123,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)
$ErrorActionPreference = 'Stop'

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving '$Root' at http://localhost:$Port/"

$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
  '.css'='text/css; charset=utf-8';  '.json'='application/json; charset=utf-8';
  '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon';
  '.webmanifest'='application/manifest+json'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $rel  = ($path.TrimStart('/') -replace '/', '\')
    $file = Join-Path $Root $rel
    if (Test-Path $file -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      $ctx.Response.Headers['Cache-Control'] = 'no-store'
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    try { $ctx.Response.StatusCode = 500 } catch {}
  } finally {
    try { $ctx.Response.OutputStream.Close() } catch {}
  }
}
