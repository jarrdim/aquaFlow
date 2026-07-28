$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$html = Join-Path $root "docs\New_Connection_UI_Flow.html"
$doc = Join-Path $root "docs\New_Connection_UI_Flow.doc"
$pdf = Join-Path $root "docs\New_Connection_UI_Flow.pdf"
$browserCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not (Test-Path $html)) { throw "Source document not found: $html" }
if (-not $browser) {
  throw "Google Chrome or Microsoft Edge is required to generate the PDF."
}

Copy-Item -LiteralPath $html -Destination $doc -Force
$uri = ([System.Uri]$html).AbsoluteUri
if (Test-Path -LiteralPath $pdf) {
  Remove-Item -LiteralPath $pdf -Force
}
$profileDirectory = Join-Path $env:TEMP ("aquaflow-document-export-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $profileDirectory | Out-Null
& $browser --headless=new --disable-gpu --no-pdf-header-footer "--user-data-dir=$profileDirectory" "--print-to-pdf=$pdf" $uri
# Chromium can return a non-zero exit code even after it has written the PDF, for
# example when a background service exits noisily, and the browser process may
# finish flushing the file just after its launcher exits. Wait briefly, then
# validate the deliverable itself.
$attempt = 0
while ($attempt -lt 30 -and (-not (Test-Path -LiteralPath $pdf) -or (Get-Item -LiteralPath $pdf).Length -eq 0)) {
  Start-Sleep -Milliseconds 500
  $attempt++
}
if (-not (Test-Path -LiteralPath $pdf) -or (Get-Item -LiteralPath $pdf).Length -eq 0) {
  throw "$browser did not generate a usable PDF."
}

Write-Host "Generated:"
Write-Host "  $doc"
Write-Host "  $pdf"
