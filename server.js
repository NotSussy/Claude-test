/**
 * MC Bedrock Connector - Main Server
 *
 * Starts four things:
 *   1. HTTPS web UI (Express + self-signed TLS) — configure your target server
 *   2. HTTP redirect server                      — redirects :80 → :443
 *   3. DNS server                                — intercepts Minecraft featured-server domains
 *   4. Bedrock redirect server                   — accepts connections and sends Transfer packet
 *
 * Run with root/sudo (needed for ports 53, 80, and 443):
 *   sudo node server.js
 *
 * Your browser will show a "certificate not trusted" warning because the cert
 * is self-signed. Click "Advanced → Proceed" (Chrome) or "Accept the Risk"
 * (Firefox) to continue — this is normal for a local self-hosted tool.
 */

const https   = require('https');
const http    = require('http');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const { startDNSServer, getLocalIPAddresses, getLocalIP } = require('./modules/dns-server');
const { startBedrockServer, stopBedrockServer, getStatus } = require('./modules/bedrock-server');

// ── TLS certificate ───────────────────────────────────────────────────────────

const CERT_DIR  = path.join(__dirname, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'server.crt');
const KEY_FILE  = path.join(CERT_DIR, 'server.key');

function loadOrCreateCert() {
  // Reuse an existing cert so the browser only needs to accept it once
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    console.log('[TLS] Loaded existing certificate from certs/');
    return { cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) };
  }

  console.log('[TLS] Generating self-signed certificate (one-time, takes a moment)…');
  const selfsigned = require('selfsigned');
  const attrs = [{ name: 'commonName', value: 'mc-bedrock-connector' }];
  const pems  = selfsigned.generate(attrs, {
    days:      825,   // max accepted by most browsers
    keySize:   2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_FILE, pems.cert);
  fs.writeFileSync(KEY_FILE,  pems.private);
  console.log('[TLS] Certificate saved to certs/ — will be reused on next start.');
  return { cert: pems.cert, key: pems.private };
}

// ── Config persistence ────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  targetHost:        '',
  targetPort:        19132,
  bedrockListenPort: 19132,
  bedrockVersion:    '1.21.50',
  httpsPort:         443,
  httpPort:          80,
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

let config = loadConfig();

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET current config
app.get('/api/config', (_req, res) => {
  res.json(config);
});

// POST update config and restart Bedrock server
app.post('/api/config', (req, res) => {
  const { targetHost, targetPort, bedrockListenPort, bedrockVersion } = req.body;

  if (!targetHost || typeof targetHost !== 'string' || targetHost.trim() === '') {
    return res.status(400).json({ error: 'targetHost is required' });
  }

  config.targetHost        = targetHost.trim();
  config.targetPort        = parseInt(targetPort)        || 19132;
  config.bedrockListenPort = parseInt(bedrockListenPort) || 19132;
  config.bedrockVersion    = bedrockVersion              || '1.21.50';
  saveConfig(config);

  const localIP = getLocalIPAddresses()[0]?.address || getLocalIP();
  try {
    stopBedrockServer();
    startBedrockServer(config.targetHost, config.targetPort, config.bedrockListenPort, config.bedrockVersion, localIP);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET live status for dashboard
app.get('/api/status', (_req, res) => {
  const bedrockStatus = getStatus();
  const ips           = getLocalIPAddresses();

  res.json({
    configured:        !!config.targetHost,
    targetHost:        config.targetHost,
    targetPort:        config.targetPort,
    bedrockListenPort: config.bedrockListenPort,
    bedrockVersion:    config.bedrockVersion,
    bedrock:           bedrockStatus,
    dnsRunning:        true,
    localIPs:          ips,
    primaryIP:         ips[0]?.address || getLocalIP(),
  });
});

// ── Boot sequence ─────────────────────────────────────────────────────────────

async function main() {
  console.log('=== MC Bedrock Connector ===\n');

  // 1. TLS cert
  const tls = loadOrCreateCert();

  // 2. DNS server
  try {
    await startDNSServer(53);
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
      console.error('\n[DNS] ERROR: Cannot bind to port 53.');
      if (err.code === 'EACCES') {
        console.error('  → Run with sudo/root: sudo node server.js');
      } else {
        console.error('  → Port 53 is already in use.');
        console.error('  → On Ubuntu/Debian: sudo systemctl stop systemd-resolved');
      }
      console.error('Continuing without DNS server — manual DNS config required.\n');
    } else {
      console.error('[DNS] Unexpected error:', err.message);
    }
  }

  // 3. Bedrock redirect server — always start so it shows up on LAN via RakNet ping
  const localIP = getLocalIPAddresses()[0]?.address || getLocalIP();
  try {
    startBedrockServer(
      config.targetHost || null,
      config.targetPort,
      config.bedrockListenPort,
      config.bedrockVersion,
      localIP
    );
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Bedrock] Port ${config.bedrockListenPort} already in use — is Geyser on this machine?`);
      console.error('  → Use a different bedrockListenPort in the web UI, or move Geyser to another port.');
    } else {
      console.error('[Bedrock] Failed to start:', err.message);
    }
  }

  // 4a. HTTPS server
  const httpsServer = https.createServer(tls, app);
  httpsServer.listen(config.httpsPort, () => {
    const localIP = getLocalIPAddresses()[0]?.address || 'localhost';
    console.log('\n[Web] HTTPS UI available at:');
    console.log(`  https://localhost:${config.httpsPort}`);
    console.log(`  https://${localIP}:${config.httpsPort}`);
    console.log('\nNote: Your browser will warn about the self-signed certificate.');
    console.log('Click "Advanced → Proceed" (Chrome) or "Accept the Risk" (Firefox).\n');
  });

  httpsServer.on('error', (err) => {
    if (err.code === 'EACCES') {
      console.error(`[Web] Cannot bind HTTPS to port ${config.httpsPort} — run with sudo.`);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`[Web] HTTPS port ${config.httpsPort} is already in use.`);
    } else {
      console.error('[Web] HTTPS error:', err.message);
    }
  });

  // 4b. HTTP → HTTPS redirect
  const redirectApp = http.createServer((req, res) => {
    const host = req.headers.host?.replace(/:\d+$/, '') || 'localhost';
    const port = config.httpsPort === 443 ? '' : `:${config.httpsPort}`;
    res.writeHead(301, { Location: `https://${host}${port}${req.url}` });
    res.end();
  });

  redirectApp.listen(config.httpPort, () => {
    console.log(`[Web] HTTP redirect listening on port ${config.httpPort} → HTTPS`);
  });

  redirectApp.on('error', (err) => {
    if (err.code !== 'EACCES' && err.code !== 'EADDRINUSE') {
      console.error('[Web] HTTP redirect error:', err.message);
    }
    // Non-fatal — HTTPS is still available directly
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
