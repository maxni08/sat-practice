$ErrorActionPreference = 'Continue'
Write-Output 'SAT Practice Windows prerequisite check'
Write-Output ([System.Environment]::OSVersion.VersionString)
Write-Output "Architecture: $env:PROCESSOR_ARCHITECTURE"
foreach ($taskTool in @('node.exe','pnpm.cmd','npm.cmd','rustc.exe','cargo.exe')) {
    $taskFound = Get-Command $taskTool -ErrorAction SilentlyContinue
    if ($taskFound) { Write-Output "$taskTool : $($taskFound.Source)" }
    else { Write-Output "$taskTool : not on PATH" }
}
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCargo = Join-Path $taskRoot 'work\tooling\cargo\bin\cargo.exe'
if (Test-Path -LiteralPath $taskCargo) { Write-Output "Workspace Rust: $taskCargo (desktop.mjs selects automatically)" }
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $taskVswhere) {
    & $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
} else { Write-Output 'Microsoft C++ Build Tools: not found' }
$taskWebview = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'
if (Test-Path -LiteralPath $taskWebview) { Get-ChildItem -LiteralPath $taskWebview -Directory | Select-Object -ExpandProperty Name }
else { Write-Output 'WebView2: check the Evergreen Runtime installation in Windows Apps.' }
