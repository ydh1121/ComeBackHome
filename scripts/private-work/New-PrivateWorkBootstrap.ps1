[CmdletBinding()]
param(
  [ValidateSet('','ydh1121','yvonne')][string]$ResetLoginId = '',
  [switch]$AllowLegacySharedWorkspace
)
$ErrorActionPreference = 'Stop'
# This program generates local material only. It never contacts Cloudflare or Drive.
# Run in a private console, without Start-Transcript or screen recording.
if ($env:OS -ne 'Windows_NT') { throw 'Run this credential generator in Windows PowerShell on your own PC.' }
$taskDirectory = Join-Path $env:LOCALAPPDATA ('ComeBackHome\private-setup-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($identity.User)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($identity.User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -Path $taskDirectory -AclObject $acl
function New-RandomBytes([int]$Length) {
  $bytes = New-Object byte[] $Length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ,$bytes
}
function New-PasswordMaterial {
  $temporary = [Convert]::ToBase64String((New-RandomBytes 24))
  $salt = New-RandomBytes 16
  # SHA-256, 600,000 iterations, 32-byte key; identical to the Worker contract.
  $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($temporary, $salt, 600000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try { $hash = $derive.GetBytes(32) } finally { $derive.Dispose() }
  return @{Temporary=$temporary;Salt=[Convert]::ToBase64String($salt);Hash=[Convert]::ToBase64String($hash)}
}
$time = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$statements = New-Object 'System.Collections.Generic.List[string]'
$statements.Add('-- HASHES ONLY. No plaintext password. Keep this file private; never add it to Git or Drive.')
$display = New-Object 'System.Collections.Generic.List[object]'
if ($ResetLoginId) {
  $material = New-PasswordMaterial
  $statements.Add("UPDATE auth_credentials SET algorithm='pbkdf2-sha256',iterations=600000,salt_b64='$($material.Salt)',hash_b64='$($material.Hash)',updated_at='$time' WHERE user_id=(SELECT id FROM auth_users WHERE login_id='$ResetLoginId');")
  $statements.Add("UPDATE auth_users SET must_change_password=1,auth_epoch=auth_epoch+1 WHERE login_id='$ResetLoginId';")
  $statements.Add("UPDATE auth_sessions SET revoked_at='$time' WHERE user_id=(SELECT id FROM auth_users WHERE login_id='$ResetLoginId');")
  $auditId = [Guid]::NewGuid().ToString()
  $statements.Add("INSERT INTO auth_audit SELECT '$auditId',NULL,'local-owner-password-reset','applied',id,'$time' FROM auth_users WHERE login_id='$ResetLoginId';")
  $display.Add(@{Login=$ResetLoginId;Password=$material.Temporary})
} else {
  $memberId = [Guid]::NewGuid().ToString()
  $caseId = [Guid]::NewGuid().ToString()
  foreach ($login in @('ydh1121','yvonne')) {
    $userId = if ($login -eq 'yvonne') { $memberId } else { [Guid]::NewGuid().ToString() }
    $role = if ($login -eq 'yvonne') { 'member' } else { 'admin' }
    $material = New-PasswordMaterial
    $statements.Add("INSERT INTO auth_users VALUES('$userId','$login','$role',0,1,0,'$time');")
    $statements.Add("INSERT INTO auth_credentials VALUES('$userId','pbkdf2-sha256',600000,'$($material.Salt)','$($material.Hash)','$time');")
    $statements.Add("INSERT INTO auth_preferences VALUES('$userId',1,'$time');")
    if ($AllowLegacySharedWorkspace) {
      $statements.Add("INSERT INTO auth_workspace_grants VALUES('$userId','legacy','write','$time');")
    }
    $display.Add(@{Login=$login;Password=$material.Temporary})
  }
  $statements.Add("INSERT INTO case_profiles VALUES('$caseId','$memberId','$time');")
  $statements.Add("INSERT INTO case_consents VALUES('$caseId',0,'','',1,'$memberId','$time');")
}
$path = Join-Path $taskDirectory 'bootstrap-hashes.sql'
[IO.File]::WriteAllLines($path,$statements,[Text.UTF8Encoding]::new($false))
Write-Host "Hash-only SQL created: $path"
Write-Host 'Nothing has been applied to any database.'
Write-Host 'Temporary passwords (shown only in this console; store them in your private password manager):'
foreach ($entry in $display) { Write-Host ($entry.Login + ': ' + $entry.Password) }
if (-not $ResetLoginId) {
  Write-Host 'PRIVATE_DRIVE_TOKEN_KEY (Cloudflare Secret only; never paste into chat or Drive):'
  Write-Host ([Convert]::ToBase64String((New-RandomBytes 32)))
}
$material = $null
$display.Clear()
