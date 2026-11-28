# Meow SSH Bridge —— 一键打包脚本
#
# 流程：
#   1. esbuild 把 bridge-core.js + ws + ssh2 打成单个 CJS 文件；
#   2. Node SEA 把该文件注入 node.exe，得到单文件 bridge.exe；
#   3. csc(.NET Framework 自带) 编译托盘宿主 MeowSshBridge.exe，
#      并把 bridge.exe 与图标作为嵌入资源打包进去；
#   4. 产物输出到 ..\dist。
#
# 用法（在 app 目录下）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
# 可选参数：
#   -SkipSea      跳过重建 bridge.exe（复用 build\bridge.exe）
#   -OutDir <dir> 指定输出目录

param(
    [switch]$SkipSea,
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist')
)

$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot
Set-Location $appDir

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "!! $text" -ForegroundColor Red; exit 1 }

$buildDir = Join-Path $appDir 'build'
New-Item -ItemType Directory -Force -Path $buildDir, $OutDir | Out-Null

# ---------- 0. 依赖检查 ----------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail '未找到 node.exe，请先安装 Node.js 18+' }
if (-not (Test-Path (Join-Path $appDir 'node_modules\esbuild'))) {
    Step '安装打包依赖（esbuild / postject）'
    npm install --no-audit --no-fund | Out-Null
}

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) { Fail '未找到 csc.exe（.NET Framework 4.x）' }

# ---------- 1. 打包 JS ----------
if (-not $SkipSea) {
    Step '打包桥接 JS（esbuild）'
    & node (Join-Path $appDir 'node_modules\esbuild\bin\esbuild') `
        'sea-entry.js' --bundle --platform=node --target=node24 --format=cjs `
        '--outfile=build/bundle.cjs' `
        '--external:cpu-features' '--external:bufferutil' '--external:utf-8-validate' '--external:*.node'
    if ($LASTEXITCODE -ne 0) { Fail 'esbuild 打包失败' }

    Step '生成 SEA 预备 blob'
    & node --experimental-sea-config sea-config.json
    if ($LASTEXITCODE -ne 0) { Fail 'SEA blob 生成失败' }

    Step '把 blob 注入 node.exe → bridge.exe'
    Copy-Item $node (Join-Path $buildDir 'bridge.exe') -Force
    & node (Join-Path $appDir 'node_modules\postject\dist\cli.js') `
        (Join-Path $buildDir 'bridge.exe') NODE_SEA_BLOB (Join-Path $buildDir 'sea-prep.blob') `
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    if ($LASTEXITCODE -ne 0) { Fail 'SEA 注入失败' }
}

$bridgeExe = Join-Path $buildDir 'bridge.exe'
if (-not (Test-Path $bridgeExe)) { Fail '缺少 build\bridge.exe' }

# ---------- 2. 快速自检：单文件桥接能否监听 ----------
Step '自检 bridge.exe'
# 用一个临时空闲端口自检，避免被已在运行的桥接（默认 8765）干扰而误判通过
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$probePort = $listener.LocalEndpoint.Port
$listener.Stop()
$probeDir = Join-Path $buildDir 'selftest-data'
$proc = Start-Process -FilePath $bridgeExe -ArgumentList '--port', $probePort, '--data-dir', "`"$probeDir`"" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
try {
    $health = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$probePort/health").Content
    if ($health -notmatch '"ok":true') { Fail "bridge.exe 自检失败：$health" }
    Write-Host "    自检通过：$health"
}
catch {
    Fail "bridge.exe 自检失败：$($_.Exception.Message)"
}
finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}

# ---------- 3. 编译托盘宿主 ----------
Step '编译托盘宿主 MeowSshBridge.exe'
$outExe = Join-Path $OutDir 'MeowSshBridge.exe'
if (Test-Path $outExe) {
    try {
        $probe = [System.IO.File]::Open($outExe, 'Open', 'Write', 'None')
        $probe.Close()
    }
    catch {
        Fail "$outExe 正在被占用（托盘程序可能还在运行），请先右键托盘图标“退出”再打包。"
    }
}
$icon = Join-Path $appDir 'assets\icon.ico'
$iconPng = Join-Path $appDir 'assets\icon.png'
$manifest = Join-Path $appDir 'app.manifest'
$refs = @('/r:System.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Core.dll')

& $csc /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 `
    "/win32icon:$icon" "/win32manifest:$manifest" `
    "/out:$outExe" `
    $refs `
    "/resource:$icon,icon.ico" `
    "/resource:$iconPng,icon.png" `
    "/resource:$bridgeExe,bridge.exe" `
    (Join-Path $appDir 'MeowSshBridge.cs') `
    (Join-Path $appDir 'LogForm.cs') `
    (Join-Path $appDir 'Support.cs') `
    (Join-Path $appDir 'AssemblyInfo.cs')
if ($LASTEXITCODE -ne 0) { Fail '编译托盘宿主失败' }

Step '复制独立 bridge.exe（命令行 / 调试用）'
Copy-Item $bridgeExe (Join-Path $OutDir 'bridge.exe') -Force

Write-Host ''
Write-Host '打包完成：' -ForegroundColor Green
Get-ChildItem $OutDir | Where-Object { $_.Name -match '\.exe$' } | ForEach-Object {
    Write-Host ("  {0}  {1:N1} MB" -f $_.FullName, ($_.Length / 1MB))
}
