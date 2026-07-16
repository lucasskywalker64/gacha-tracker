# CI/CD Deployment Setup Guide

This directory contains the GitHub Actions workflow for deploying the **Gacha Tracker API** to your target server.

## 1. GitHub Environment configuration (Secrets vs. Variables)

To improve debugging and keep your workflows clean, the parameters are split into **Environment Variables** (plain-text, readable in logs) and **Environment Secrets** (encrypted, masked in logs).

You must set up two environments in your GitHub repository (**Settings > Environments**):
1. **`production`** (linked to `main` branch, requires **6 secrets + 7 variables**)
2. **`development`** (linked to `develop` branch, requires **5 secrets + 6 variables**)

### A. Environment Variables (`vars.NAME`) — Public / Non-sensitive
Configure these under **Environment variables** in the respective environment settings:

* **BOTH `production` and `development` (6 Variables):**
  * `HOST`: The public domain or Cloudflare Tunnel hostname routed to the target server's SSH port (e.g., `ssh.yourdomain.com`).
  * `USER`: The SSH login username on the server (e.g., `lucas`).
  * `BETTER_AUTH_URL`: The canonical URL for the authentication system (e.g., `https://gacha-tracker.app` or `https://dev.gacha-tracker.app`).
  * `FRONTEND_URL`: The URL where the SvelteKit frontend is hosted.
  * `DISCORD_CLIENT_ID`: Public OAuth client ID for Discord login.
  * `GOOGLE_CLIENT_ID`: Public OAuth client ID for Google login.
* **`production` ONLY (1 Additional Variable):**
  * `DATABASE_URL`: Production database connection URL (e.g., Turso `libsql://your-db.turso.io` database).

---

### B. Environment Secrets (`secrets.NAME`) — Encrypted / Sensitive
Configure these under **Environment secrets** in the respective environment settings:

* **BOTH `production` and `development` (5 Secrets):**
  * `SSH_KEY`: The private SSH key used to authenticate with the target server. (The corresponding public key must be added to the server user's `~/.ssh/authorized_keys` file).
  * `BETTER_AUTH_SECRET`: A secure random 32-character key for session signing.
  * `RESEND_API_KEY`: API key for the Resend service (used to send login OTP emails).
  * `DISCORD_CLIENT_SECRET`: OAuth client secret for Discord login.
  * `GOOGLE_CLIENT_SECRET`: OAuth client secret for Google login.
* **`production` ONLY (1 Additional Secret):**
  * `DATABASE_AUTH_TOKEN`: Connection authorization token for the production database.

---

## 2. Server Setup Checklist

Ensure the following configurations are set up on your host server:

### A. Repository Directory Structure
The deployment script relies on specific paths in the user's home folder:
* **Production (`main` branch):** Cloned at `/home/<user>/gacha-tracker`
* **Development (`develop` branch):** Cloned at `/home/<user>/gacha-tracker-dev`

### B. Prerequisites & Runtime
* **Bun:** Installed and available at `/home/<user>/.bun/bin/bun` or globally.
* **Redis:** Installed on bare-metal (`redis-server`). Run `sudo systemctl enable --now redis-server.service` to verify it starts on boot.
* **Cloudflare Tunnel:** Set up a Cloudflare Tunnel for secure SSH routing. The workflow automatically attempts to route through `cloudflared` using the `HOST` variable.

### C. Passwordless sudo Configuration
The workflow triggers systemd restarts and service file copies. You must configure the deployment user to allow passwordless sudo for these commands. 

Add the following rule to your `/etc/sudoers` or inside a custom configuration file at `/etc/sudoers.d/gacha-tracker`:

```text
# Replace 'lucas' with your host SSH user
lucas ALL=(ALL) NOPASSWD: /bin/systemctl restart gacha-api, /bin/systemctl restart gacha-api-dev, /bin/systemctl daemon-reload, /bin/systemctl enable gacha-api.service, /bin/systemctl enable gacha-api-dev.service, /usr/bin/cp apps/api/gacha-api.service /etc/systemd/system/gacha-api.service, /usr/bin/cp apps/api/gacha-api-dev.service /etc/systemd/system/gacha-api-dev.service
```

---

## 3. Workflow Lifecycle

1. **Lint & Test:** Runs code checks and unit/E2E tests in a virtual Ubuntu environment.
2. **Setup SSH:** Configures `cloudflared` on the runner and starts an SSH tunnel.
3. **Environment Setup:** Creates the production `.env` config file dynamically.
4. **Deploy & Compile:** Generates systemd service configurations from the repository template (`apps/api/gacha-api.service.template`), copies them to `/etc/systemd/system/`, runs `bun run build`, and restarts the systemd services.
5. **Health Validation:** Hits the local `/health` endpoint via `curl` to verify a successful start. If a crash or error occurs, the runner automatically rolls back the code and systemd config to the previous working commit.
