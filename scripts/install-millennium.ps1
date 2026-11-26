param(
    [string]$SteamPath = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StarFile = Join-Path $ProjectRoot "dist\com.steammarket.batchlister.star"

if (-not (Test-Path $StarFile)) {
    Write-Host "未找到 .star 构建产物，正在执行 npm run build ..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    try {
        npm run build
    } finally {
        Pop-Location
    }
}

if (-not $SteamPath) {
    try {
        $regPath = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -ErrorAction Stop).SteamPath
        if ($regPath -and (Test-Path $regPath)) {
            $SteamPath = $regPath
        }
    } catch {}
}

if (-not $SteamPath) {
    $candidates = @(
        "C:\Program Files (x86)\Steam",
        "C:\Program Files\Steam",
        "D:\Steam",
        "E:\Steam"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            $SteamPath = $c
            break
        }
    }
}

if (-not $SteamPath -or -not (Test-Path $SteamPath)) {
    Write-Error "未能自动定位 Steam 安装目录，请通过参数指定：.\scripts\install-millennium.ps1 -SteamPath 'D:\Steam'"
    exit 1
}

$MillenniumDir = Join-Path $SteamPath "millennium"
$PluginsDir = Join-Path $MillenniumDir "plugins"
if (-not (Test-Path $MillenniumDir)) {
    Write-Warning "未检测到 $MillenniumDir 目录。请先确认已安装 Millennium (>= v3.4.0，https://steambrew.app)。"
}
if (-not (Test-Path $PluginsDir)) {
    New-Item -ItemType Directory -Path $PluginsDir -Force | Out-Null
}

$DestFile = Join-Path $PluginsDir "com.steammarket.batchlister.star"
Copy-Item -Path $StarFile -Destination $DestFile -Force

Write-Host "已安装 Millennium 插件包到: $DestFile" -ForegroundColor Green
Write-Host "请完全退出并重启 Steam 客户端，在 Millennium 设置 -> 插件 中启用「Steam Market Batch Lister」。" -ForegroundColor Cyan
