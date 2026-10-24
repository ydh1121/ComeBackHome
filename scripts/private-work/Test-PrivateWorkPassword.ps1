$ErrorActionPreference = 'Stop'
# Load only the reviewed crypto functions. Never execute account provisioning
# or emit a generated temporary password in CI.
$path = Join-Path $PSScriptRoot 'New-PrivateWorkBootstrap.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Bootstrap PowerShell syntax is invalid.' }
foreach ($name in @('Get-PasswordHash','New-RandomBytes')) {
  $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $function) { throw 'Required crypto function missing.' }
  Invoke-Expression $function.Extent.Text
}
$salt = [byte[]](0..15)
$hash = Get-PasswordHash 'Synthetic-Interop-Only!123' $salt
$expected = $env:CBH_SYNTHETIC_HASH_VECTOR
if (-not $expected -or $hash -cne $expected) { throw 'PowerShell SHA-256 PBKDF2 does not match Node 600,000 iteration vector.' }
$one = New-RandomBytes 32; $two = New-RandomBytes 32
if ($one.Length -ne 32 -or [Convert]::ToBase64String($one) -eq [Convert]::ToBase64String($two)) { throw 'Random bytes contract failed.' }
Write-Output 'PRIVATE_WORK_WINDOWS_HASH_INTEROP_PASS; no real accounts or credentials created.'
