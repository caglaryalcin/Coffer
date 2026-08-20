<img src="./public/og.png" width="512" alt="Coffer social preview" />

![Status](https://img.shields.io/badge/status-stable-ca7373) [![Latest Release](https://img.shields.io/github/v/release/caglaryalcin/Coffer?include_prereleases&color=blue)](https://github.com/caglaryalcin/Coffer/releases)

# Coffer

Coffer is a self-hosted, multi-user authenticator vault. It generates TOTP
codes in the browser and encrypts each user's vault before storing it on the
server. It also supports QR imports, groups, backups, and 2FAS transfers.

## Features

- Multi-user, browser-encrypted vaults
- TOTP generation with QR and manual account setup
- Groups, favorites, archive, search, and bulk actions
- Automatic local service logos and custom logo uploads
- Encrypted backups plus 2FAS, 2FAuth, and OTPAuth transfers
- Responsive light and dark interfaces

## Docker Compose

```bash
docker compose up --build -d
```

Open [http://localhost:3000](http://localhost:3000). Encrypted vault data is
stored in `./data` and remains there after `docker compose down`.

## Docker

```bash
docker build -t coffer .
docker volume create coffer-data
docker run -d --name coffer --init --restart unless-stopped -p 127.0.0.1:3000:3000 -v coffer-data:/app/data coffer
```

Open [http://localhost:3000](http://localhost:3000). The `coffer-data` volume
keeps encrypted vault data across container restarts and replacements.

> Passwords cannot be recovered. Keep a backup of your encrypted vault data.
