# 更新ヘルパー(host.ps1)を Chrome に登録する。install.bat から実行する。Windows 用
# 登録すると、新規タブの「新しいバージョン」から「今すぐ更新」でファイルの入れ替えまでできる。
# 管理者権限は要らない(自分のユーザーの範囲だけに登録する)。
#   install.bat              登録する(拡張機能のフォルダを移したら、もう一度実行する)
#   uninstall.bat            登録を消す
# -Dest / -RegistryKey / -ZipUrl はテスト用
param(
  [switch]$Uninstall,
  [string]$Dest = (Join-Path $env:LOCALAPPDATA 'WidgetNewtab'),
  [string]$RegistryKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.hatopoppoppo.widget_newtab',
  [string]$ZipUrl = 'https://github.com/hatopoppoppo/widget-newtab/archive/refs/heads/main.zip'
)
$ErrorActionPreference = 'Stop'
$Name = 'com.hatopoppoppo.widget_newtab'
$NoBom = New-Object Text.UTF8Encoding $false # Chrome は BOM 付きの JSON を読めない

if ($Uninstall) {
  if (Test-Path $RegistryKey) { Remove-Item -Recurse -Force -Path $RegistryKey }
  if (Test-Path $Dest) { Remove-Item -Recurse -Force -Path $Dest }
  Write-Host 'Widget Newtab update helper was uninstalled.'
  exit 0
}

$ExtDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Manifest = [IO.File]::ReadAllText((Join-Path $ExtDir 'manifest.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json

# 拡張機能の ID は manifest の key(公開鍵)の SHA-256 の先頭 16 バイトを、0-f → a-p で書いたもの
$sha = [Security.Cryptography.SHA256]::Create()
$hash = $sha.ComputeHash([Convert]::FromBase64String($Manifest.key))
$Id = -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Force -Path (Join-Path $PSScriptRoot 'host.ps1') -Destination (Join-Path $Dest 'host.ps1')
[IO.File]::WriteAllText((Join-Path $Dest 'host.bat'), "@echo off`r`npowershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"%~dp0host.ps1`"`r`n", [Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $Dest 'config.json'), (@{ extensionDir = $ExtDir; zipUrl = $ZipUrl } | ConvertTo-Json), $NoBom)
$HostManifest = Join-Path $Dest "$Name.json"
$hostJson = [ordered]@{
  name = $Name
  description = 'Widget Newtab update helper'
  path = (Join-Path $Dest 'host.bat')
  type = 'stdio'
  allowed_origins = @("chrome-extension://$Id/")
} | ConvertTo-Json
[IO.File]::WriteAllText($HostManifest, $hostJson, $NoBom)

New-Item -Force -Path $RegistryKey | Out-Null
Set-Item -Path $RegistryKey -Value $HostManifest

Write-Host 'Widget Newtab update helper was installed.'
Write-Host "  extension folder: $ExtDir"
Write-Host "  extension id:     $Id"
