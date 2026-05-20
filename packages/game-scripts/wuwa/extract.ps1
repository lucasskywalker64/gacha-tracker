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
        -Body (@{ gameId = "wuwa" } | ConvertTo-Json -Compress) | Out-Null
} catch {
    Write-Host "Failed to notify tracker: $_"
}

$ProgressPreference = 'SilentlyContinue'
$gamePath = ""

Write-Host "Attempting to locate Wuthering Waves path..."

# Multi-strategy log discovery
$paths = @()

# 1. MUI Cache (HKCU)
$muiCachePath = "HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"
if (Test-Path $muiCachePath) {
    $muiItems = Get-Item $muiCachePath | Select-Object -ExpandProperty Property -ErrorAction SilentlyContinue | Where-Object { 
        $_ -like "*wuthering*client-win64-shipping.exe*"
    }
    $muiItems | ForEach-Object {
        $cleanPath = ($_ -split '\.FriendlyAppName')[0]
        if ($cleanPath -match "(.+?)\\Client\\Binaries\\Win64") {
            $paths += $matches[1]
        }
    }
}

# 2. Firewall Rules (HKLM)
$firewallPath = "HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules"
if (Test-Path $firewallPath) {
    $properties = Get-ItemProperty -Path $firewallPath -ErrorAction SilentlyContinue
    if ($properties) {
        $fwItems = $properties | Get-Member -MemberType NoteProperty | Where-Object {
            $_.Definition -like "*wuthering*client-win64-shipping*"
        }
        $fwItems | ForEach-Object {
            $val = $properties.$($_.Name)
            if ($val -match "App=(.+?\\Client\\Binaries\\Win64\\client-win64-shipping\.exe)") {
                $path = $matches[1]
                if ($path -match "(.+?)\\Client\\Binaries\\Win64") {
                    $paths += $matches[1]
                }
            }
        }
    }
}

# 3. Uninstall Registry
$uninstallPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($unPath in $uninstallPaths) {
    Get-ItemProperty -Path $unPath -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -like "*wuthering*" -or $_.Publisher -like "*kuro*"
    } | ForEach-Object {
        if ($_.InstallPath) {
            $paths += $_.InstallPath
        }
    }
}

# 4. Common hardcoded paths fallback
$defaultPaths = @(
    "C:\Wuthering Waves",
    "C:\Program Files\Wuthering Waves",
    "C:\Program Files\Epic Games\WutheringWavesj3oFh",
    "D:\Wuthering Waves",
    "E:\Wuthering Waves"
)
foreach ($dp in $defaultPaths) {
    if (Test-Path $dp) {
        $paths += $dp
    }
}

# Uniquify paths and check existence
$uniquePaths = $paths | Select-Object -Unique | Where-Object { [string]::IsNullOrWhiteSpace($_) -eq $false -and (Test-Path $_) }

foreach ($p in $uniquePaths) {
    if (Test-Path (Join-Path $p "Client")) {
        $gamePath = $p
        break
    }
}

if ([string]::IsNullOrEmpty($gamePath)) {
    Write-Host "Failed to locate Wuthering Waves game directory. Please run the script inside your game root directory or ensure the game is installed properly." -ForegroundColor Red
    return
}

Write-Host "Located game path: $gamePath" -ForegroundColor Green

# 5. Engine.ini configuration checks
$engineIniPath = Join-Path $gamePath "Client\Saved\Config\WindowsNoEditor\Engine.ini"
if (Test-Path $engineIniPath) {
    $engineIniContent = Get-Content $engineIniPath -Raw -ErrorAction SilentlyContinue
    if ($engineIniContent -match '\[Core\.Log\][\r\n]+Global=(off|none)') {
        Write-Host "Warning: Your game logging is currently disabled in Engine.ini (Global=off/none)." -ForegroundColor Yellow
        Write-Host "Wuthering Waves requires logging to be enabled to generate connection URLs."
        
        $choices = [System.Management.Automation.Host.ChoiceDescription[]]@(
            New-Object System.Management.Automation.Host.ChoiceDescription "&Yes", "Re-enable logging (recommended)"
            New-Object System.Management.Automation.Host.ChoiceDescription "&No", "Keep logging disabled"
        )
        $decision = $Host.UI.PromptForChoice("Repair Logging", "Would you like the script to automatically re-enable logging?", $choices, 0)
        if ($decision -eq 0) {
            Write-Host "Backing up Engine.ini to Engine.ini.backup..."
            Copy-Item -Path $engineIniPath -Destination "$engineIniPath.backup" -Force
            # Remove the [Core.Log] disable segment
            $newContent = $engineIniContent -replace '\[Core\.Log\][\r\n]+Global=(off|none)', ''
            $newContent = $newContent -replace '(?:\r?\n){3,}', "`r`n`r`n"
            Set-Content -Path $engineIniPath -Value $newContent -Force
            Write-Host "Engine.ini has been repaired! Please launch Wuthering Waves, open the in-game Convene history screen once, and run this script again." -ForegroundColor Green
            return
        }
    }
}

# 6. Locate Log files
$logPath = Join-Path $gamePath "Client\Saved\Logs\Client.log"
$webviewLogPath = $null

$sdkPath = Join-Path $gamePath "Client\Binaries\Win64\ThirdParty"
if (Test-Path $sdkPath) {
    $foundLogs = Get-ChildItem -Path $sdkPath -Filter "debug.log" -Recurse -File -ErrorAction SilentlyContinue
    if ($foundLogs) {
        $webviewLogPath = $foundLogs[0].FullName
    }
}

# 7. Check/Repair ACL Permissions on Client.log if blocked
if (Test-Path $logPath) {
    $fileObj = Get-Item $logPath
    if ($fileObj.IsReadOnly) {
        Write-Host "Clearing Read-Only attribute on Client.log..." -ForegroundColor Yellow
        $fileObj.IsReadOnly = $false
    }
    
    try {
        $testRead = Get-Content -Path $logPath -TotalCount 1 -ErrorAction Stop
    } catch {
        Write-Host "Permission denied reading Client.log. Attempting to repair file permissions..." -ForegroundColor Yellow
        Start-Process icacls -ArgumentList "`"$logPath`" /grant Administrators:F /remove:d `"$env:USERNAME`"" -Verb RunAs -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue
    }
}

Write-Host "Scanning log files for Convene History URL..."

$conveneUrl = $null

# Extract from Client.log
if (Test-Path $logPath) {
    $urlMatches = @(Select-String -Path $logPath -Pattern 'https://aki-gm-resources(?:-oversea)?\.aki-game\.(?:net|com)/aki/gacha/index\.html#/record[^\s"''\)]*' -AllMatches | ForEach-Object { $_.Matches.Value })
    if ($urlMatches.Count -gt 0) {
        $conveneUrl = $urlMatches[-1]
    }
}

# Extract from debug.log if not found in Client.log
if (-not $conveneUrl -and $webviewLogPath -and (Test-Path $webviewLogPath)) {
    $webviewMatches = @(Select-String -Path $webviewLogPath -Pattern '"#url"\s*:\s*"(https://aki-gm-resources(?:-oversea)?\.aki-game\.(?:net|com)/aki/gacha/index\.html#/record[^"]*)"' -AllMatches | ForEach-Object { $_.Matches.Groups[1].Value })
    if ($webviewMatches.Count -gt 0) {
        $conveneUrl = $webviewMatches[-1]
    }
}

if (-not $conveneUrl) {
    Write-Host "Could not locate Convene History URL. Please open the game, access the in-game 'Convene History' screen so that logs are populated, and try running this script again." -ForegroundColor Red
    return
}

# Parse URL parameters
$queryString = ""
$qIndex = $conveneUrl.IndexOf('?')
if ($qIndex -ge 0) {
    $queryString = $conveneUrl.Substring($qIndex)
}

$query = [Web.HttpUtility]::ParseQueryString($queryString)
$player_id = $query.Get("player_id")
$record_id = $query.Get("record_id")
$server_id = $query.Get("svr_id")
if (-not $server_id) { $server_id = $query.Get("serverId") }
if (-not $server_id) { $server_id = $query.Get("server_id") }

if (-not $player_id -or -not $record_id) {
    Write-Host "Failed to parse session parameters from extracted URL. Please re-open your Convene History in game to refresh cache." -ForegroundColor Red
    Write-Host "`n--- Extraction Diagnostics ---" -ForegroundColor Yellow
    Write-Host "Extracted URL: $conveneUrl" -ForegroundColor Yellow
    Write-Host "Query Substring: $queryString" -ForegroundColor Yellow
    Write-Host "player_id parsed: '$player_id'" -ForegroundColor Yellow
    Write-Host "record_id parsed: '$record_id'" -ForegroundColor Yellow
    Write-Host "server_id parsed: '$server_id'" -ForegroundColor Yellow
    Write-Host "------------------------------`n" -ForegroundColor Yellow
    return
}

Write-Host "Successfully extracted session parameters (UID: $player_id)!" -ForegroundColor Green

# Determine endpoint domain
$apiDomain = "https://gmserver-api.aki-game2.net"
if ($conveneUrl -notmatch "-oversea") {
    $apiDomain = "https://gmserver-api.aki-game2.com"
}
$queryString = ""
$qIndex = $conveneUrl.IndexOf('?')
if ($qIndex -ge 0) {
    $queryString = $conveneUrl.Substring($qIndex)
}
$kuroApiUrl = "$apiDomain/gacha/record/query$queryString"

$headers = @{
    "Content-Type" = "application/json"
    "User-Agent"   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# cardPoolTypes:
# 1: Featured Resonator
# 2: Featured Weapon
# 3: Standard Resonator
# 4: Standard Weapon
# 5: Novice Convene
# 6: Beginner's Choice
$bannerTypes = @("1", "2", "3", "4", "5", "6")
$allPulls = @()
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
    
    $bannerCursor = $null
    if ($cursorObj -and $cursorObj.PSobject.Properties.Name -contains $gachaType) {
        $bannerCursor = $cursorObj.$gachaType
    }

    $body = @{
        playerId = $player_id
        cardPoolType = [int]$gachaType
        serverId = $server_id
        recordId = $record_id
        languageCode = "en"
    }
    $bodyJson = $body | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod -Uri $kuroApiUrl -Method Post -Headers $headers -Body $bodyJson
        
        if ($response.code -ne 0) {
            Write-Host "API Error: $($response.msg)" -ForegroundColor Red
            continue
        }

        $list = $response.data
        if (-not $list -or $list.Count -eq 0) {
            continue
        }

        # Sort raw list oldest first so we can assign deterministic indices chronologically
        $sortedList = $list | Sort-Object -Property time
        
        # Group pulls by timestamp to handle multiple pulls in the same second
        $pullsByTime = @{}
        $bannerPulls = @()
        
        foreach ($item in $sortedList) {
            $timeKey = $item.time
            if (-not $pullsByTime.ContainsKey($timeKey)) {
                $pullsByTime[$timeKey] = 0
            } else {
                $pullsByTime[$timeKey] = $pullsByTime[$timeKey] + 1
            }
            $indexWithinSecond = $pullsByTime[$timeKey]
            
            $itemType = "Weapon"
            $charMatch = "Resonator|$([char]0x89d2)$([char]0x8272)"
            if ($item.resourceType -match $charMatch) {
                $itemType = "Resonator"
            }
            
            # Generate deterministic pullId
            $cleanTime = $item.time -replace '[\s:]', '-'
            $pullId = "${player_id}_${gachaType}_${cleanTime}_${indexWithinSecond}"
            
            $bannerPulls += @{
                pullId     = $pullId
                bannerType = [string]$gachaType
                itemId     = [string]$item.resourceId
                itemName   = $item.name
                itemType   = $itemType
                rarity     = [int]$item.qualityLevel
                pulledAt   = $item.time
                extra      = @{
                    recordId              = $pullId
                    resourceId            = [string]$item.resourceId
                    qualityLevel          = [int]$item.qualityLevel
                    cardPoolType          = [int]$gachaType
                    pullIndexWithinSecond = [int]$indexWithinSecond
                }
            }
        }
        
        # Filter already imported pulls using deterministic stopping cursor
        $newPulls = @()
        $foundCursor = $false
        if ($bannerCursor) {
            for ($i = 0; $i -lt $bannerPulls.Count; $i++) {
                if ($bannerPulls[$i].pullId -eq $bannerCursor) {
                    $foundCursor = $true
                    if ($i + 1 -lt $bannerPulls.Count) {
                        $newPulls = $bannerPulls[($i + 1)..($bannerPulls.Count - 1)]
                    }
                    break
                }
            }
            if (-not $foundCursor) {
                $newPulls = $bannerPulls
            }
        } else {
            $newPulls = $bannerPulls
        }
        
        Write-Host "Found $($newPulls.Count) new pulls for banner $gachaType."
        $allPulls += $newPulls
        
        # Friendly rate limiting sleep between banners
        Start-Sleep -Milliseconds 300
    } catch {
        Write-Host "Failed to fetch pulls: $_" -ForegroundColor Red
    }
}

if ($allPulls.Count -eq 0) {
    Write-Host "No new pulls found." -ForegroundColor Yellow
    return
}

Write-Host "Fetched $($allPulls.Count) pulls total. Sending to tracker..."

$payload = @{
    gameId  = "wuwa"
    gameUid = $player_id
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
