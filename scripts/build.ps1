param(
    [ValidateSet('chrome', 'firefox')]
    [string]$Browser = 'firefox'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "dist/$Browser"
$sourceManifest = if ($Browser -eq 'firefox') { 'manifest.firefox.json' } else { 'manifest.json' }

New-Item -ItemType Directory -Path (Join-Path $outputPath 'src') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot $sourceManifest) -Destination (Join-Path $outputPath 'manifest.json') -Force
$sourcePath = Join-Path $projectRoot 'src'
Get-ChildItem -LiteralPath $sourcePath -File -Recurse | ForEach-Object {
    $relativePath = $_.FullName.Substring($sourcePath.Length + 1)
    $destinationPath = Join-Path (Join-Path $outputPath 'src') $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Force
}
Write-Output "Extension prepared at $outputPath"
