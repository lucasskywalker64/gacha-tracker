# Gacha Pull Tracker — Game Extraction Scripts

Extraction scripts live in per-game subdirectories. Each game has a Windows
(PowerShell) and macOS/Linux (Bash) variant.

## Supported Games

| Game              | Directory  | Status                    |
| ----------------- | ---------- | ------------------------- |
| Honkai: Star Rail | `hsr/`     | Phase 1                   |
| Genshin Impact    | `genshin/` | Phase 2                   |
| Zenless Zone Zero | `zzz/`     | Phase 2                   |
| Wuthering Waves   | `wuwa/`    | Phase 2 (feature-flagged) |

## Usage

Scripts are invoked by the Gacha Tracker import wizard. The wizard generates
a one-line command containing your short-lived import token and (on subsequent
imports) a JSON cursor object that skips already-imported pulls.

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/your-org/gacha-tracker/main/packages/game-scripts/hsr/extract.ps1 `
  | iex -Command { .\extract.ps1 -Token "<your-token>" -CursorJson '{"character":"<id>","lightcone":"<id>"}' }
```

### macOS / Linux (Bash)

```bash
curl -sL https://raw.githubusercontent.com/your-org/gacha-tracker/main/packages/game-scripts/hsr/extract.sh \
  | bash -s -- --token "<your-token>" --cursor-json '{"character":"<id>","lightcone":"<id>"}'
```

## Prerequisites

1. **Open your in-game pull/warp history** before running the script. The game
   logs the history URL to disk when you browse it — this is what the script
   reads. If you have not opened it recently, the cached URL may be expired or
   missing.
2. The script runs **locally on your machine**. It reads files from your game
   installation directory and makes HTTP requests to the game's API directly.
   It does not install anything or modify any game files.
3. Scripts are published to GitHub and served via CDN. You can always
   inspect the source on GitHub before running.

## Security

- Scripts only read game log files and web cache. They do not write, modify,
  or delete any game data.
- The import token embedded in the command is single-use and expires after
  15 minutes. If the script fails, simply return to the import wizard to
  generate a new token.
- Scripts POST to `https://gacha-tracker.app/api/pulls/import` only. No other
  outbound network requests are made (other than to the game's own pull history
  API to retrieve your history).
