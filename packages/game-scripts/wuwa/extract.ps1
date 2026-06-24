[CmdletBinding()]
param(
    [string]$ImportToken = "",
    [string]$Cursors = "{}",
    [string]$ApiUrl = "https://api.gacha-tracker.app",
    [switch]$DebugMode
)

function Write-DebugLog {
    param([string]$Message)
    if ($DebugMode -or $DebugPreference -ne 'SilentlyContinue') {
        Write-Host "[DEBUG] $Message" -ForegroundColor DarkGray
    }
}

function ReadSharedFileBytes {
    param([string]$Path)
    $stream = $null
    $memoryStream = $null
    try {
        $fileShare = [System.IO.FileShare]([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $fileShare)
        $memoryStream = [System.IO.MemoryStream]::new()
        $stream.CopyTo($memoryStream)
        return $memoryStream.ToArray()
    }
    finally {
        if ($memoryStream) { $memoryStream.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
}

function GetDecryptedClientLogContent {
    param([string]$Path)
    [byte[]]$bytes = ReadSharedFileBytes $Path
    
    $canUseCSharp = $false
    try {
        if ([System.Type]::GetType("WuwaDecryptor") -or ([System.Management.Automation.PSTypeName]"WuwaDecryptor").Type) {
            $canUseCSharp = $true
        }
    } catch {}

    if (-not $canUseCSharp) {
        try {
            Add-Type -TypeDefinition @"
            public class WuwaDecryptor {
                public static void Decrypt(byte[] bytes) {
                    int len = bytes.Length;
                    for (int i = 0; i < len; i++) {
                        int b = bytes[i];
                        if (((b & 0x0F) % 2) == 1) {
                            bytes[i] = (byte)(b ^ 0xA5);
                        } else {
                            bytes[i] = (byte)(b ^ 0xEF);
                        }
                    }
                }
            }
"@ -ErrorAction Stop
            $canUseCSharp = $true
        } catch {
            Write-DebugLog "Failed to compile C# WuwaDecryptor, falling back to PowerShell loop: $_"
        }
    }

    if ($canUseCSharp) {
        Write-DebugLog "Decrypting using optimized C# method..."
        [WuwaDecryptor]::Decrypt($bytes)
        return [System.Text.Encoding]::UTF8.GetString($bytes)
    } else {
        $chunkSize = 512KB
        if ($bytes.Length -gt $chunkSize) {
            Write-DebugLog "File size ($($bytes.Length) bytes) exceeds fallback chunk size. Decrypting only the last $chunkSize bytes..."
            $decryptedBytes = [byte[]]::new($chunkSize)
            [Array]::Copy($bytes, $bytes.Length - $chunkSize, $decryptedBytes, 0, $chunkSize)
            for ($i = 0; $i -lt $decryptedBytes.Length; $i++) {
                $byte = [int]$decryptedBytes[$i]
                if ((($byte -band 0x0F) % 2) -eq 1) {
                    $decryptedBytes[$i] = [byte]($byte -bxor 0xA5)
                }
                else {
                    $decryptedBytes[$i] = [byte]($byte -bxor 0xEF)
                }
            }
            return [System.Text.Encoding]::UTF8.GetString($decryptedBytes)
        } else {
            Write-DebugLog "Decrypting entire file using PowerShell loop..."
            for ($i = 0; $i -lt $bytes.Length; $i++) {
                $byte = [int]$bytes[$i]
                if ((($byte -band 0x0F) % 2) -eq 1) {
                    $bytes[$i] = [byte]($byte -bxor 0xA5)
                }
                else {
                    $bytes[$i] = [byte]($byte -bxor 0xEF)
                }
            }
            return [System.Text.Encoding]::UTF8.GetString($bytes)
        }
    }
}

function GetSharedFileContent {
    param([string]$Path)
    [byte[]]$bytes = ReadSharedFileBytes $Path
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

Write-DebugLog "Script initialized with ApiUrl: $ApiUrl"
Write-DebugLog "Cursors: $Cursors"

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web

if ([string]::IsNullOrEmpty($ImportToken)) {
    Write-Host "Error: Import token is required." -ForegroundColor Red
    Write-Host "Please provide the import token to run this script."
    return
}

$ApiUrl = $ApiUrl.TrimEnd('/')

# Notify tracker that import is starting
try {
    Write-DebugLog "Sending start notification to $ApiUrl/pulls/import/start"
    Invoke-RestMethod -Uri "$ApiUrl/pulls/import/start" -Method Post `
        -Headers @{ "Authorization" = "Bearer $ImportToken"; "Content-Type" = "application/json" } `
        -Body (@{ gameId = "wuwa" } | ConvertTo-Json -Compress) | Out-Null
    Write-DebugLog "Start notification sent successfully."
} catch {
    Write-DebugLog "Failed to notify tracker: $_`n$($_.ScriptStackTrace)"
}

$ProgressPreference = 'SilentlyContinue'
$gamePath = ""

Write-Host "Locating Wuthering Waves game directory..."

# Multi-strategy log discovery
$paths = @()

# 1. MUI Cache (HKCU)
Write-DebugLog "Checking MUI Cache..."
$muiCachePath = "HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"
if (Test-Path $muiCachePath) {
    $muiItems = Get-Item $muiCachePath | Select-Object -ExpandProperty Property -ErrorAction SilentlyContinue | Where-Object { 
        $_ -like "*wuthering*client-win64-shipping.exe*"
    }
    $muiItems | ForEach-Object {
        Write-DebugLog "Found MUI Cache match: $_"
        $cleanPath = ($_ -split '\.FriendlyAppName')[0]
        if ($cleanPath -match "(.+?)\\Client\\Binaries\\Win64") {
            Write-DebugLog "Extracted path from MUI Cache: $($matches[1])"
            $paths += $matches[1]
        }
    }
}

# 2. Firewall Rules (HKLM)
Write-DebugLog "Checking Firewall Rules..."
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
                Write-DebugLog "Found Firewall Rule match: $path"
                if ($path -match "(.+?)\\Client\\Binaries\\Win64") {
                    Write-DebugLog "Extracted path from Firewall Rules: $($matches[1])"
                    $paths += $matches[1]
                }
            }
        }
    }
}

# 3. Uninstall Registry
Write-DebugLog "Checking Uninstall Registry..."
$uninstallPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($unPath in $uninstallPaths) {
    Get-ItemProperty -Path $unPath -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -like "*wuthering*" -or $_.Publisher -like "*kuro*"
    } | ForEach-Object {
        Write-DebugLog "Found Uninstall Registry entry: DisplayName='$($_.DisplayName)', Publisher='$($_.Publisher)', InstallPath='$($_.InstallPath)'"
        if ($_.InstallPath) {
            $paths += $_.InstallPath
        }
    }
}

# 4. Common hardcoded paths fallback
Write-DebugLog "Checking default/fallback paths..."
$defaultPaths = @(
    "C:\Wuthering Waves",
    "C:\Program Files\Wuthering Waves",
    "C:\Program Files\Epic Games\WutheringWavesj3oFh",
    "D:\Wuthering Waves",
    "E:\Wuthering Waves"
)
foreach ($dp in $defaultPaths) {
    $exists = Test-Path $dp
    Write-DebugLog "Checking default path: $dp (Exists: $exists)"
    if ($exists) {
        $paths += $dp
    }
}

# Uniquify paths and check existence
Write-DebugLog "Raw paths collected: $($paths -join ', ')"
$uniquePaths = $paths | Select-Object -Unique | Where-Object { [string]::IsNullOrWhiteSpace($_) -eq $false -and (Test-Path $_) }
Write-DebugLog "Unique existing paths: $($uniquePaths -join ', ')"

foreach ($p in $uniquePaths) {
    $clientPath = Join-Path $p "Client"
    $hasClient = Test-Path $clientPath
    Write-DebugLog "Checking if path '$p' contains 'Client' directory: $hasClient"
    if ($hasClient) {
        $gamePath = $p
        break
    }
}

if ([string]::IsNullOrEmpty($gamePath)) {
    Write-Host "Error: Could not locate Wuthering Waves game directory." -ForegroundColor Red
    Write-Host "Please ensure the game is installed, or try running this script directly from your Wuthering Waves installation folder."
    return
}

Write-Host "Game directory found: $gamePath" -ForegroundColor Green

# 5. Engine.ini configuration checks
$engineIniPath = Join-Path $gamePath "Client\Saved\Config\WindowsNoEditor\Engine.ini"
Write-DebugLog "Engine.ini path: $engineIniPath"
if (Test-Path $engineIniPath) {
    Write-DebugLog "Engine.ini exists, reading content..."
    $engineIniContent = Get-Content $engineIniPath -Raw -ErrorAction SilentlyContinue
    Write-DebugLog "Engine.ini length: $($engineIniContent.Length) characters"
    if ($engineIniContent -match '\[Core\.Log\][\r\n]+Global=(off|none)') {
        Write-DebugLog "Match found for disabled logging in Engine.ini: $($matches[0])"
        Write-Host "Warning: Game logging is disabled in your settings." -ForegroundColor Yellow
        Write-Host "Logging must be enabled for the script to find your Convene URL."
        
        $choices = [System.Management.Automation.Host.ChoiceDescription[]]@(
            New-Object System.Management.Automation.Host.ChoiceDescription "&Yes", "Enable logging and restart game"
            New-Object System.Management.Automation.Host.ChoiceDescription "&No", "Do not enable logging"
        )
        $decision = $Host.UI.PromptForChoice("Enable Game Logging?", "Would you like to automatically enable game logging?", $choices, 0)
        if ($decision -eq 0) {
            Write-Host "Backing up configuration file..."
            Copy-Item -Path $engineIniPath -Destination "$engineIniPath.backup" -Force
            # Remove the [Core.Log] disable segment
            $newContent = $engineIniContent -replace '\[Core\.Log\][\r\n]+Global=(off|none)', ''
            $newContent = $newContent -replace '(?:\r?\n){3,}', "`r`n`r`n"
            Set-Content -Path $engineIniPath -Value $newContent -Force
            Write-Host "Logging has been enabled successfully!" -ForegroundColor Green
            Write-Host "Please start Wuthering Waves, open the in-game 'Convene History' screen, and then run this script again."
            return
        }
    }
}

# 6. Locate Log files
$logPath = Join-Path $gamePath "Client\Saved\Logs\Client.log"
$webviewLogPath = $null
Write-DebugLog "Client.log path: $logPath (Exists: $(Test-Path $logPath))"

$sdkPath = Join-Path $gamePath "Client\Binaries\Win64\ThirdParty"
Write-DebugLog "ThirdParty SDK path: $sdkPath (Exists: $(Test-Path $sdkPath))"
if (Test-Path $sdkPath) {
    Write-DebugLog "Searching for debug.log in $sdkPath..."
    $foundLogs = Get-ChildItem -Path $sdkPath -Filter "debug.log" -Recurse -File -ErrorAction SilentlyContinue
    if ($foundLogs) {
        $webviewLogPath = $foundLogs[0].FullName
        Write-DebugLog "Found debug.log path: $webviewLogPath"
    } else {
        Write-DebugLog "debug.log not found in SDK path."
    }
}

# 7. Check/Repair ACL Permissions on Client.log if blocked
if (Test-Path $logPath) {
    $fileObj = Get-Item $logPath
    Write-DebugLog "Client.log read-only attribute: $($fileObj.IsReadOnly)"
    if ($fileObj.IsReadOnly) {
        Write-DebugLog "Clearing Read-Only attribute on Client.log..."
        $fileObj.IsReadOnly = $false
    }
    
    try {
        Write-DebugLog "Attempting to read first line of Client.log..."
        $testRead = Get-Content -Path $logPath -TotalCount 1 -ErrorAction Stop
        Write-DebugLog "Successfully read first line of Client.log."
    } catch {
        Write-Host "Adjusting log file permissions to allow reading..." -ForegroundColor Yellow
        Write-DebugLog "Read test failed: $_"
        Start-Process icacls -ArgumentList "`"$logPath`" /grant Administrators:F /remove:d `"$env:USERNAME`"" -Verb RunAs -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue
    }
}

Write-Host "Scanning log files for Convene History URL..."

$conveneUrl = $null

# Extract from Client.log
if (Test-Path $logPath) {
    Write-DebugLog "Scanning Client.log for Convene URL..."
    $urlPattern = 'https://aki-gm-resources(?:-oversea)?\.aki-game\.(?:net|com)/aki/gacha/index\.html#/record[^\s"''\)]*'
    try {
        Write-DebugLog "Attempting to decrypt Client.log content..."
        $decryptedContent = GetDecryptedClientLogContent $logPath
        $urlMatches = [regex]::Matches($decryptedContent, $urlPattern)
        Write-DebugLog "Found $($urlMatches.Count) URL matches in decrypted Client.log."
        if ($urlMatches.Count -gt 0) {
            $conveneUrl = $urlMatches[$urlMatches.Count - 1].Value
            Write-DebugLog "Selected latest decrypted Convene URL: $conveneUrl"
        } else {
            Write-DebugLog "No matches found in decrypted content. Trying raw plain text content..."
            $rawContent = GetSharedFileContent $logPath
            $urlMatches = [regex]::Matches($rawContent, $urlPattern)
            Write-DebugLog "Found $($urlMatches.Count) URL matches in raw Client.log."
            if ($urlMatches.Count -gt 0) {
                $conveneUrl = $urlMatches[$urlMatches.Count - 1].Value
                Write-DebugLog "Selected latest raw Convene URL: $conveneUrl"
            }
        }
    } catch {
        Write-DebugLog "Failed to read/decrypt Client.log: $_"
    }
}

# Extract from debug.log if not found in Client.log
if (-not $conveneUrl -and $webviewLogPath -and (Test-Path $webviewLogPath)) {
    Write-DebugLog "Scanning debug.log for Convene URL..."
    $webviewMatches = @(Select-String -Path $webviewLogPath -Pattern '"#url"\s*:\s*"(https://aki-gm-resources(?:-oversea)?\.aki-game\.(?:net|com)/aki/gacha/index\.html#/record[^"]*)"' -AllMatches | ForEach-Object { $_.Matches.Groups[1].Value })
    Write-DebugLog "Found $($webviewMatches.Count) URL matches in debug.log."
    if ($webviewMatches.Count -gt 0) {
        $conveneUrl = $webviewMatches[-1]
        Write-DebugLog "Selected latest Convene URL: $conveneUrl"
    }
}

if (-not $conveneUrl) {
    Write-Host "Error: Could not find Convene History URL." -ForegroundColor Red
    Write-Host "Please open the game, open the 'Convene History' screen so the game logs the URL, and run this script again."
    return
}

# Parse URL parameters
$queryString = ""
$qIndex = $conveneUrl.IndexOf('?')
if ($qIndex -ge 0) {
    $queryString = $conveneUrl.Substring($qIndex)
}
Write-DebugLog "Query string parsed: $queryString"

$query = [Web.HttpUtility]::ParseQueryString($queryString)
$player_id = $query.Get("player_id")
$record_id = $query.Get("record_id")
$server_id = $query.Get("svr_id")
if (-not $server_id) { $server_id = $query.Get("serverId") }
if (-not $server_id) { $server_id = $query.Get("server_id") }

Write-DebugLog "Parsed player_id: $player_id"
Write-DebugLog "Parsed record_id: $record_id"
Write-DebugLog "Parsed server_id: $server_id"

if (-not $player_id -or -not $record_id) {
    Write-Host "Error: Could not parse session parameters from the Convene URL." -ForegroundColor Red
    Write-Host "Please open the in-game 'Convene History' screen to refresh the cache, then try again."
    
    if ($DebugMode) {
        Write-Host "`n--- Extraction Diagnostics ---" -ForegroundColor Yellow
        Write-Host "Extracted URL: $conveneUrl" -ForegroundColor Yellow
        Write-Host "Query Substring: $queryString" -ForegroundColor Yellow
        Write-Host "player_id parsed: '$player_id'" -ForegroundColor Yellow
        Write-Host "record_id parsed: '$record_id'" -ForegroundColor Yellow
        Write-Host "server_id parsed: '$server_id'" -ForegroundColor Yellow
        Write-Host "------------------------------`n" -ForegroundColor Yellow
    }
    return
}

Write-Host "Connected to account with UID: $player_id" -ForegroundColor Green

# Determine endpoint domain
$apiDomain = "https://gmserver-api.aki-game2.net"
if ($conveneUrl -notmatch "-oversea") {
    $apiDomain = "https://gmserver-api.aki-game2.com"
}
Write-DebugLog "Using API domain: $apiDomain"
$queryString = ""
$qIndex = $conveneUrl.IndexOf('?')
if ($qIndex -ge 0) {
    $queryString = $conveneUrl.Substring($qIndex)
}
$kuroApiUrl = "$apiDomain/gacha/record/query$queryString"
Write-DebugLog "Kuro API URL: $kuroApiUrl"

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
$bannerNames = @{
    "1" = "Featured Resonator"
    "2" = "Featured Weapon"
    "3" = "Standard Resonator"
    "4" = "Standard Weapon"
    "5" = "Novice Convene"
    "6" = "Beginner's Choice"
}
$allPulls = @()
$cursorObj = $null

try {
    if (-not [string]::IsNullOrWhiteSpace($Cursors)) {
        $cursorObj = ConvertFrom-Json $Cursors
    }
} catch {
    Write-DebugLog "Failed to parse Cursors: $_`n$($_.ScriptStackTrace)"
}

foreach ($gachaType in $bannerTypes) {
    $bannerName = $bannerNames[$gachaType]
    Write-Host "Fetching pulls for $bannerName..."
    
    $bannerCursor = $null
    if ($cursorObj -and $cursorObj.PSobject.Properties.Name -contains $gachaType) {
        $bannerCursor = $cursorObj.$gachaType
    }
    Write-DebugLog "Cursor for banner ${gachaType}: $bannerCursor"

    $body = @{
        playerId = $player_id
        cardPoolType = [int]$gachaType
        serverId = $server_id
        recordId = $record_id
        languageCode = "en"
    }
    $bodyJson = $body | ConvertTo-Json -Compress
    Write-DebugLog "API Request Body: $bodyJson"

    try {
        $response = Invoke-RestMethod -Uri $kuroApiUrl -Method Post -Headers $headers -Body $bodyJson
        Write-DebugLog "API Response Code: $($response.code)"
        Write-DebugLog "API Response Msg: $($response.msg)"
        
        if ($response.code -ne 0) {
            Write-Host "Error: Failed to fetch pulls for $bannerName ($($response.msg))" -ForegroundColor Red
            continue
        }

        $list = $response.data
        if (-not $list -or $list.Count -eq 0) {
            Write-DebugLog "No data returned in response for banner $gachaType."
            continue
        }
        Write-DebugLog "API Response data count for banner ${gachaType}: $($list.Count)"

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
            Write-DebugLog "Filtering banner $gachaType pulls with cursor $bannerCursor..."
            for ($i = 0; $i -lt $bannerPulls.Count; $i++) {
                if ($bannerPulls[$i].pullId -eq $bannerCursor) {
                    $foundCursor = $true
                    Write-DebugLog "Found cursor match at index $i (Total pulls: $($bannerPulls.Count))"
                    if ($i + 1 -lt $bannerPulls.Count) {
                        $newPulls = $bannerPulls[($i + 1)..($bannerPulls.Count - 1)]
                    }
                    break
                }
            }
            if (-not $foundCursor) {
                Write-DebugLog "Cursor $bannerCursor not found in pulled data. Importing all $($bannerPulls.Count) pulls."
                $newPulls = $bannerPulls
            }
        } else {
            $newPulls = $bannerPulls
        }
        
        if ($newPulls.Count -gt 0) {
            Write-Host "Found $($newPulls.Count) new pulls for $bannerName."
            $allPulls += $newPulls
        }
        
        # Friendly rate limiting sleep between banners
        Start-Sleep -Milliseconds 300
    } catch {
        Write-Host "Error: Failed to fetch pulls for $bannerName." -ForegroundColor Red
        Write-DebugLog "Fetch exception: $_`n$($_.ScriptStackTrace)"
    }
}

if ($allPulls.Count -eq 0) {
    Write-Host "No new pulls found." -ForegroundColor Yellow
    return
}

Write-Host "Sending $($allPulls.Count) pulls to Gacha Tracker..."

$payload = @{
    gameId  = "wuwa"
    gameUid = $player_id
    pulls   = $allPulls
}
$payloadJson = $payload | ConvertTo-Json -Depth 10
Write-DebugLog "Sending payload to tracker (JSON size: $($payloadJson.Length) characters)..."

try {
    $importUrl = "$ApiUrl/pulls/import"
    Write-DebugLog "Import URL: $importUrl"
    $result = Invoke-RestMethod -Uri $importUrl -Method Post -Headers @{
        "Authorization" = "Bearer $ImportToken"
        "Content-Type"  = "application/json"
    } -Body $payloadJson
    Write-DebugLog "Tracker response success: $($result.success), message: $($result.message), error: $($result.error)"

    if ($result.success) {
        Write-Host "Successfully imported pulls!" -ForegroundColor Green
    } else {
        Write-Host "Error: Import failed ($($result.error))" -ForegroundColor Red
        return
    }
} catch {
    Write-Host "Error: Failed to send data to Gacha Tracker server." -ForegroundColor Red
    Write-Host "Please check your internet connection and try again."
    Write-DebugLog "Import exception: $_`n$($_.ScriptStackTrace)"
    return
}

Write-Host "Done! You can close this window now." -ForegroundColor Green
