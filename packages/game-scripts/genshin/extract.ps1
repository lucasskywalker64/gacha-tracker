param(
    [string]$ImportToken = "",
    [string]$Cursors = "{}",
    [string]$ApiUrl = "https://api.gacha-tracker.app"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web

if ([string]::IsNullOrEmpty($ImportToken)) {
    Write-Host "Error: Import token (-ImportToken) is required." -ForegroundColor Red
    Write-Host "Usage: .\extract.ps1 -ImportToken <your_token> [-Cursors <json>]"
    return
}

$ApiUrl = $ApiUrl.TrimEnd('/')

# Notify tracker that import is starting
try {
    Invoke-RestMethod -Uri "$ApiUrl/pulls/import/start" -Method Post `
        -Headers @{ "Authorization" = "Bearer $ImportToken"; "Content-Type" = "application/json" } `
        -Body (@{ gameId = "genshin" } | ConvertTo-Json -Compress) | Out-Null
} catch {
    Write-Host "Failed to notify tracker: $_"
}

$ProgressPreference = 'SilentlyContinue'
$game_path = ""

Write-Host "Attempting to locate Wish cache..."

$app_data = [Environment]::GetFolderPath('ApplicationData')
$locallow_path = [IO.Path]::GetFullPath("$app_data\..\LocalLow\miHoYo\Genshin Impact")
$log_path = Join-Path $locallow_path "output_log.txt"

# Also support China location if global doesn't exist
if (-not [IO.File]::Exists($log_path)) {
    $locallow_path_cn = [IO.Path]::GetFullPath("$app_data\..\LocalLow\miHoYo\$([char]0x539f)$([char]0x795e)")
    $log_path_cn = Join-Path $locallow_path_cn "output_log.txt"
    if ([IO.File]::Exists($log_path_cn)) {
        $locallow_path = $locallow_path_cn
        $log_path = $log_path_cn
    }
}

if ([IO.File]::Exists($log_path)) {
    $log_content = Get-Content -Path $log_path -Raw 2>$null
    
    if ($log_content -match '(.:/[^\r\n]+?(?:GenshinImpact_Data|YuanShen_Data))') {
        $game_path = $matches[1].Trim()
    }
}

if ([string]::IsNullOrEmpty($game_path)) {
    Write-Host "Failed to locate game path from logs. Please contact support or run with admin privileges." -ForegroundColor Red
    return
}

$webCaches_dir = Join-Path $game_path "webCaches"

if (Test-Path $webCaches_dir) {
    # Get the latest modified directory under webCaches
    $latest_folder = Get-ChildItem -Path $webCaches_dir -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest_folder) {
        $cache_path = Join-Path $latest_folder.FullName "Cache/Cache_Data/data_2"
    } else {
        $cache_path = "$game_path/webCaches/Cache/Cache_Data/data_2"
    }
} else {
    $cache_path = "$game_path/webCaches/Cache/Cache_Data/data_2"
}

if (-Not [IO.File]::Exists($cache_path)) {
    Write-Host "Error: Could not find web cache file at $cache_path. Open the game and view your wish history first." -ForegroundColor Red
    return
}

Write-Host "Reading cache file: $cache_path"
$copy_path = [IO.Path]::GetTempPath() + [Guid]::NewGuid().ToString()
Copy-Item -Path $cache_path -Destination $copy_path -Force

$cache_data = Get-Content -Encoding UTF8 -Raw $copy_path
Remove-Item -Path $copy_path -Force

$cache_data_split = $cache_data -split '1/0/'
$valid_url = $null

for ($i = $cache_data_split.Length - 1; $i -ge 0; $i--) {
    $line = $cache_data_split[$i]

    if ($line -match "(https://[^\0]+?webview_gacha[^\0]+)") {
        $url = $matches[1]
        
        Write-Host "Testing URL candidate..."
        try {
            $candUri = [Uri]$url
            $candQuery = [Web.HttpUtility]::ParseQueryString($candUri.Query)
            $candAuthkey = $candQuery.Get("authkey")
            $candAuthkeyVer = $candQuery.Get("authkey_ver")
            $candSignType = $candQuery.Get("sign_type")
            $candGameBiz = $candQuery.Get("game_biz")
            $candRegion = $candQuery.Get("region")

            $candApiHost = "public-operation-hk4e-sg.hoyoverse.com"
            if ($candGameBiz -eq "hk4e_cn" -or $url.Contains("webstatic.mihoyo.com") -or $url.Contains("ys_cn") -or $candRegion -match "^cn_") {
                $candApiHost = "public-operation-hk4e.mihoyo.com"
            }

            $testUrl = "https://$candApiHost/gacha_info/api/getGachaLog?authkey=$([uri]::EscapeDataString($candAuthkey))&authkey_ver=$candAuthkeyVer&sign_type=$candSignType&lang=en-us&size=5&gacha_type=301"
            if ($candGameBiz) { $testUrl += "&game_biz=$candGameBiz" }
            if ($candRegion) { $testUrl += "&region=$candRegion" }

            $res = Invoke-RestMethod -Uri $testUrl -ContentType "application/json" -UseBasicParsing
            if ($res.retcode -eq 0) {
                $valid_url = $url
                break
            }
        } catch {
            # Ignore and continue searching
        }
    }
}

if (-not $valid_url) {
    Write-Host "Could not locate valid Wish History Url. Make sure to open the Wish history in game, then run the script again." -ForegroundColor Red
    return
}

$uri = [Uri]$valid_url
$query = [Web.HttpUtility]::ParseQueryString($uri.Query)
$authkey = $query.Get("authkey")
$authkey_ver = $query.Get("authkey_ver")
$sign_type = $query.Get("sign_type")
$game_biz = $query.Get("game_biz")
$region = $query.Get("region")

Write-Host "Successfully extracted authkey!" -ForegroundColor Green

$apiHost = "public-operation-hk4e-sg.hoyoverse.com"
if ($game_biz -eq "hk4e_cn" -or $valid_url.Contains("webstatic.mihoyo.com") -or $valid_url.Contains("ys_cn") -or $region -match "^cn_") {
    $apiHost = "public-operation-hk4e.mihoyo.com"
}

$baseUrl = "https://$apiHost/gacha_info/api/getGachaLog"
$commonQuery = "?authkey=$([uri]::EscapeDataString($authkey))&authkey_ver=$authkey_ver&sign_type=$sign_type&lang=en-us&size=20"
if ($game_biz) { $commonQuery += "&game_biz=$game_biz" } else { $commonQuery += "&game_biz=hk4e_global" }
if ($region) { $commonQuery += "&region=$region" }

$bannerTypes = @("100", "200", "301", "302", "400", "500")
$allPulls = @()
$gameUid = $null
$cursorObj = $null
try {
    if (-not [string]::IsNullOrWhiteSpace($Cursors)) {
        $cursorObj = ConvertFrom-Json $Cursors
    }
} catch {
    Write-Host "Warning: Failed to parse Cursors parameter. $($_)" -ForegroundColor Yellow
}

foreach ($gachaType in $bannerTypes) {
    Write-Host "Fetching pulls for banner type: $gachaType..."
    $endId = "0"
    $page = 1
    $hasNext = $true
    
    $bannerCursor = $null
    if ($cursorObj -and $cursorObj.PSobject.Properties.Name -contains $gachaType) {
        $bannerCursor = $cursorObj.$gachaType
    }

    while ($hasNext) {
        $url = "$baseUrl$commonQuery&gacha_type=$gachaType&end_id=$endId"
        
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get
            if ($response.retcode -ne 0) {
                Write-Host "API Error: $($response.message)" -ForegroundColor Red
                break
            }

            $list = $response.data.list
            if (-not $list -or $list.Count -eq 0) {
                $list = $response.data.list_v2
            }

            if (-not $list -or $list.Count -eq 0) {
                $hasNext = $false
                break
            }

            foreach ($item in $list) {
                if ($bannerCursor -and $item.id -le $bannerCursor) {
                    Write-Host "Reached previously imported pull. Moving to next banner..."
                    $hasNext = $false
                    break
                }

                $uid = $item.uid
                if (-not $gameUid -and $uid) { 
                    $gameUid = $uid 
                }
                
                $allPulls += @{
                    pullId     = $item.id
                    bannerType = $item.gacha_type
                    itemId     = $item.item_id
                    itemName   = $item.name
                    itemType   = $item.item_type
                    rarity     = [int]$item.rank_type
                    pulledAt   = $item.time
                }
            }

            if ($hasNext) {
                $endId = $list[-1].id
                $page++
                Start-Sleep -Milliseconds 300 # Be gentle on Hoyo servers
            }
        } catch {
            Write-Host "Failed to fetch pulls: $_" -ForegroundColor Red
            break
        }
    }
}

if ($allPulls.Count -eq 0) {
    Write-Host "No pulls found." -ForegroundColor Yellow
    return
}

Write-Host "Fetched $($allPulls.Count) pulls total. Sending to tracker..."

$finalUid = $gameUid
foreach ($item in $allPulls) {
    if ($item.uid) { $finalUid = $item.uid; break }
}

$payload = @{
    gameId  = "genshin"
    gameUid = $finalUid
    pulls   = $allPulls
}

$payloadJson = $payload | ConvertTo-Json -Depth 10

try {
    $importUrl = "$ApiUrl/pulls/import"
    $result = Invoke-RestMethod -Uri $importUrl -Method Post -Headers @{
        "Authorization" = "Bearer $ImportToken"
        "Content-Type"  = "application/json"
    } -Body $payloadJson

    if ($result.success) {
        Write-Host "Successfully imported pulls: $($result.message)" -ForegroundColor Green
    } else {
        Write-Host "Import failed: $($result.error)" -ForegroundColor Red
        return
    }
} catch {
    Write-Host "Failed to send data to server: $_" -ForegroundColor Red
    Write-Host "Please try again. If the issue persists, please contact support."
    return
}

Write-Host "Done! You can close this window."
