# Cannoli — Pokemon Showdown Server Setup

No fork needed. Clone the official repos, drop in config + plugin.

## Quick Setup

```bash
# 1. Clone PS game server
git clone https://github.com/smogon/pokemon-showdown.git showdown-server
cd showdown-server && npm install

# 2. Copy Cannoli config
cp ../cannoli/ps/config-example.js config/config.js

# 3. Copy chat plugin
cp ../cannoli/ps/cannoli.ts server/chat-plugins/cannoli.ts

# 4. Generate RSA keypair (once)
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# 5. Set env vars
export PS_RSA_PUBLIC_KEY="$(cat public.pem)"
# Also set PS_RSA_PRIVATE_KEY on the Cannoli backend

# 6. Set public key in config
# Edit config/config.js and paste the public key as loginserverpublickey

# 7. Give CannoliBot global voice
echo "cannolibot,+" >> config/usergroups.csv

# 8. Start
node pokemon-showdown start
```

## PS Client Setup

```bash
# Clone PS client
git clone https://github.com/smogon/pokemon-showdown-client.git showdown-client

# Serve statically (nginx, etc.)
# Configure server URL via URL param: sim.cannoli.live/?~~sim.cannoli.live:8000
# Or set in js/config.js (optional)
```

## Reverse Proxy (nginx/Traefik)

```nginx
# sim.cannoli.live — PS client static files
server {
    server_name sim.cannoli.live;

    location / {
        root /path/to/showdown-client;
        add_header Content-Security-Policy "frame-ancestors 'self' https://cannoli.live";
    }

    # WebSocket upgrade for game server
    location /showdown/websocket {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `PS_RSA_PRIVATE_KEY` | Cannoli backend | RSA private key (PEM) for signing assertions |
| `PS_RSA_PUBLIC_KEY` | PS game server config | RSA public key (PEM) for verifying assertions |
| `PS_KEY_ID` | Both | Key ID (default: 4) |
| `PS_HOSTNAME` | Cannoli backend | Hostname in assertions (default: cannoli.live) |
| `PS_LOGIN_SERVER_URL` | PS game server config | URL to Cannoli login endpoints |
| `BOT_USERNAME` | Cannoli backend | Bot account name (default: CannoliBot) |
| `BOT_PASSWORD` | Cannoli backend | Bot account password |
| `PS_SERVER_WS_URL` | Cannoli backend | WebSocket URL to PS game server |

## Architecture

```
cannoli.live (Elysia)
  ├── /api/ps/login      — PS login protocol (assertion signing)
  ├── /api/ps/upkeep     — Session renewal
  ├── /api/ps/getassertion
  └── /api/ps/logout

sim.cannoli.live (static client + game server)
  ├── / — PS client (auto-authenticates via sid cookie on .cannoli.live)
  └── /showdown/websocket — PS game server (verifies assertions with RSA public key)
```

No separate login server service needed. Cannoli IS the login server.
