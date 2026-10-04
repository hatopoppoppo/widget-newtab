# Widget Newtab の更新ヘルパー(Chrome の Native Messaging のホスト)。Windows 用
#
# 新規タブの「今すぐ更新」から呼ばれ、配布用の公開リポジトリの最新版で拡張機能のフォルダを置き換える。
# install.ps1 がこのファイルを %LOCALAPPDATA%\WidgetNewtab に写して Chrome に登録する(拡張機能のフォルダの外に
# 置くのは、更新で自分自身を書き換えている最中に壊れないようにするため)。
# 設定(config.json): extensionDir = 拡張機能のフォルダ、zipUrl = 最新版の ZIP
#
# 受け取るメッセージ(どちらも決まった処理だけ。任意のコマンドは実行しない):
#   { command: 'version' } → { ok: true, host: <このヘルパーの版> }   入っているかの確認
#   { command: 'update' }  → { ok: true, version: <更新後の version> } / { ok: false, error }
# やりとりは標準入出力で、4 バイトの長さ(リトルエンディアン)+ UTF-8 の JSON。標準出力にはそれ以外を書かないこと
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # ダウンロードの進み具合の表示を出さない(遅くなる)
$HostVersion = 1
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Read-Bytes($stream, $count) {
  $buffer = New-Object byte[] $count
  $read = 0
  while ($read -lt $count) {
    $n = $stream.Read($buffer, $read, $count - $read)
    if ($n -le 0) { return $null }
    $read += $n
  }
  return ,$buffer
}

function Read-Message {
  $stdin = [Console]::OpenStandardInput()
  $head = Read-Bytes $stdin 4
  if ($null -eq $head) { return $null }
  $body = Read-Bytes $stdin ([BitConverter]::ToInt32($head, 0))
  if ($null -eq $body) { return $null }
  return [Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
}

function Write-Message($message) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($message | ConvertTo-Json -Compress))
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

function Read-Json($path) {
  return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Update-Extension($config) {
  $dir = $config.extensionDir
  $current = Read-Json (Join-Path $dir 'manifest.json')

  if (Test-Path (Join-Path $dir '.git')) {
    # git clone で入れた場合は git pull(手元の変更があれば止まる)
    $out = & git -C $dir pull --ff-only 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "git pull failed: $out" }
  } else {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('widget-newtab-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      $zip = Join-Path $tmp 'latest.zip'
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing -Uri $config.zipUrl -OutFile $zip
      $unpacked = Join-Path $tmp 'unpacked'
      Expand-Archive -Path $zip -DestinationPath $unpacked
      # GitHub の ZIP は widget-newtab-main\ の下に中身がある
      $src = Get-ChildItem -Path $unpacked -Directory | Select-Object -First 1
      if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'manifest.json'))) { throw 'manifest.json not found in the downloaded ZIP' }
      # 違う拡張機能で上書きしないように、ID を決める key が同じかを確かめる
      if ((Read-Json (Join-Path $src.FullName 'manifest.json')).key -ne $current.key) { throw 'the downloaded ZIP is a different extension' }
      # 中身を揃える(新しい版で無くなったファイルは消す)。終了コードは 8 以上が失敗
      & robocopy $src.FullName $dir /MIR /XD .git /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
    } finally {
      Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue
    }
  }

  # ヘルパー自身も新しくする(実行中のスクリプトは読み込み済みなので、上書きしてかまわない)
  $nextHost = Join-Path $dir 'native\host.ps1'
  if (Test-Path $nextHost) { Copy-Item -Force -Path $nextHost -Destination (Join-Path $Here 'host.ps1') }
  return (Read-Json (Join-Path $dir 'manifest.json')).version
}

try {
  $message = Read-Message
  if ($null -eq $message) { exit 0 }
  $config = Read-Json (Join-Path $Here 'config.json')
  switch ($message.command) {
    'version' { Write-Message @{ ok = $true; host = $HostVersion } }
    'update' { Write-Message @{ ok = $true; version = (Update-Extension $config) } }
    default { Write-Message @{ ok = $false; error = "unknown command: $($message.command)" } }
  }
} catch {
  Write-Message @{ ok = $false; error = "$_" }
}
