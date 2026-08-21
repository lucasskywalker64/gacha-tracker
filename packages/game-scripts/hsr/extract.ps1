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

$ScriptVersion = if ($MyInvocation.Line -match 'raw\.githubusercontent\.com/[^/]+/[^/]+/(?:refs/(?:heads|tags)/)?([^/]+)') {
    $Matches[1]
} else {
    $null
}

# Notify tracker that import is starting
try {
    Invoke-RestMethod -Uri "$ApiUrl/pulls/import/start" -Method Post `
        -Headers @{ "Authorization" = "Bearer $ImportToken"; "Content-Type" = "application/json" } `
        -Body (@{ gameId = "starrail" } | ConvertTo-Json -Compress) | Out-Null
} catch {
    Write-Host "Failed to notify tracker: $_"
    # Non-fatal: wizard just won't auto-advance, user can click Next manually
}

$ProgressPreference = 'SilentlyContinue'
$game_path = ""

Write-Host "Attempting to locate Warp cache..."

$app_data = [Environment]::GetFolderPath('ApplicationData')
$locallow_path = "$app_data\..\LocalLow\Cognosphere\Star Rail\"
$log_path = "$locallow_path\Player.log"

if ([IO.File]::Exists($log_path)) {
    $log_lines = Get-Content $log_path -First 15 2>$null
    if ([string]::IsNullOrEmpty($log_lines)) {
        $log_path = "$locallow_path\Player-prev.log"
        if ([IO.File]::Exists($log_path)) {
            $log_lines = Get-Content $log_path -First 15 2>$null
        }
    }

    if (-not [string]::IsNullOrEmpty($log_lines)) {
        $log_lines = $log_lines.split([Environment]::NewLine)
        for ($i = 0; $i -lt $log_lines.Length; $i++) {
            $log_line = $log_lines[$i]
            if ($log_line.startsWith("Loading player data from ")) {
                $game_path = $log_line.replace("Loading player data from ", "").replace("data.unity3d", "")
                break
            }
        }
    }
}

if ([string]::IsNullOrEmpty($game_path)) {
    Write-Host "Failed to locate game path from logs. Please contact support or run with admin privileges." -ForegroundColor Red
    return
}

# Find the latest webcache data_2 file
$cache_path = "$game_path/webCaches/Cache/Cache_Data/data_2"
$cache_folders = Get-ChildItem "$game_path/webCaches/" -Directory -ErrorAction SilentlyContinue
$max_version = 0

if ($cache_folders) {
    for ($i = 0; $i -lt $cache_folders.Length; $i++) {
        $cache_folder = $cache_folders[$i].Name
        if ($cache_folder -match '^\d+\.\d+\.\d+\.\d+$') {
            $version = [int]-join($cache_folder.Split("."))
            if ($version -ge $max_version) {
                $max_version = $version
                $cache_path = "$game_path/webCaches/$cache_folder/Cache/Cache_Data/data_2"
            }
        }
    }
}

if (-Not [IO.File]::Exists($cache_path)) {
    Write-Host "Error: Could not find web cache file at $cache_path. Open the game and view your warp history first." -ForegroundColor Red
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

    if ($line.StartsWith('http') -and ($line.Contains("getGachaLog") -or $line.Contains("getLdGachaLog"))) {
        $url = ($line -split "\0")[0]
        
        Write-Host "Testing URL candidate..."
        try {
            $res = Invoke-RestMethod -Uri $url -ContentType "application/json" -UseBasicParsing
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
    Write-Host "Could not locate valid Warp History Url. Make sure to open the Warp history in game, then run the script again." -ForegroundColor Red
    return
}

$uri = [Uri]$valid_url
$query = [Web.HttpUtility]::ParseQueryString($uri.Query)
$authkey = $query.Get("authkey")
$authkey_ver = $query.Get("authkey_ver")
$sign_type = $query.Get("sign_type")

Write-Host "Successfully extracted authkey!" -ForegroundColor Green

$baseUrl = $uri.Scheme + "://" + $uri.Host + $uri.AbsolutePath
$commonQuery = "?authkey=$([uri]::EscapeDataString($authkey))&authkey_ver=$authkey_ver&sign_type=$sign_type&lang=en-us&size=20&game_biz=hkrpg_global"

$bannerTypes = @("1", "2", "11", "12") # Standard, Beginner, Character, Weapon
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
                if (-not $gameUid -and $uid) { $gameUid = $uid }
                
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
    gameId  = "starrail"
    gameUid = $finalUid
    pulls   = $allPulls
}

$payloadJson = $payload | ConvertTo-Json -Depth 10

try {
    $importUrl = "$ApiUrl/pulls/import"
    $importHeaders = @{
        "Authorization" = "Bearer $ImportToken"
        "Content-Type"  = "application/json"
    }
    if ($ScriptVersion) {
        $importHeaders["x-script-version"] = $ScriptVersion
    }

    $result = Invoke-RestMethod -Uri $importUrl -Method Post -Headers $importHeaders -Body $payloadJson

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
