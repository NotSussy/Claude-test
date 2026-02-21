/**
 * MC Bedrock Connector - Main Server
 *
 * Starts three things:
 *   1. Web UI (Express)  — configure your target server and see instructions
 *   2. DNS server        — intercepts Minecraft featured-server domains
 *   3. Bedrock server    — accepts incoming connections and redirects them
 *
 * Run with root/sudo so the DNS server can bind to port 53:
 *   sudo node server.js
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { startDNSServer, stopDNSServer, getLocalIPAddresses, getLocalIP } = require('./modules/dns-server');
const { startBedrockServer, stopBedrockServer, getStatus } = require('./modules/bedrock-server');

// ── Config persistence ────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  targetHost: '',
  targetPort: 19132,
  bedrockListenPort: 19132,
  bedrockVersion: '1.21.50',
  webPort: 3000,
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

// ── Express web server ────────────────────────────────────────────────────────

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

  config.targetHost = targetHost.trim();
  config.targetPort = parseInt(targetPort) || 19132;
  config.bedrockListenPort = parseInt(bedrockListenPort) || 19132;
  config.bedrockVersion = bedrockVersion || '1.21.50';
  saveConfig(config);

  // Restart Bedrock redirect server with new settings
  try {
    stopBedrockServer();
    startBedrockServer(config.targetHost, config.targetPort, config.bedrockListenPort, config.bedrockVersion);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET live status for dashboard
app.get('/api/status', (_req, res) => {
  const bedrockStatus = getStatus();
  const ips = getLocalIPAddresses();

  res.json({
    configured: !!config.targetHost,
    targetHost: config.targetHost,
    targetPort: config.targetPort,
    bedrockListenPort: config.bedrockListenPort,
    bedrockVersion: config.bedrockVersion,
    bedrock: bedrockStatus,
    dnsRunning: true,         // If we got here, DNS is up
    localIPs: ips,
    primaryIP: ips[0]?.address || getLocalIP(),
  });
});

// ── Boot sequence ─────────────────────────────────────────────────────────────

async function main() {
  console.log('=== MC Bedrock Connector ===\n');

  // 1. DNS server (needs root for port 53)
  try {
    await startDNSServer(53);
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
      console.error('\n[DNS] ERROR: Cannot bind to port 53.');
      if (err.code === 'EACCES') {
        console.error('  → Run with sudo/root: sudo node server.js');
      } else {
        console.error('  → Port 53 is already in use.');
        console.error('  → On Ubuntu/Debian, disable systemd-resolved:');
        console.error('    sudo systemctl stop systemd-resolved');
        console.error('    sudo systemctl disable systemd-resolved');
      }
      console.error('\nContinuing without DNS server — manual DNS config required.\n');
    } else {
      console.error('[DNS] Unexpected error:', err.message);
    }
  }

  // 2. Bedrock redirect server
  if (config.targetHost) {
    try {
      startBedrockServer(
        config.targetHost,
        config.targetPort,
        config.bedrockListenPort,
        config.bedrockVersion
      );
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Bedrock] Port ${config.bedrockListenPort} is in use — is Geyser running on this machine?`);
        console.error('  → Set a different bedrockListenPort in the web UI, or move Geyser to another port.');
      }
    }
  } else {
    console.log('[Bedrock] No target configured yet — visit the web UI to set one.');
  }

  // 3. Web UI
  app.listen(config.webPort, () => {
    const localIP = getLocalIPAddresses()[0]?.address || 'localhost';
    console.log(`\n[Web] UI available at:`);
    console.log(`  http://localhost:${config.webPort}`);
    console.log(`  http://${localIP}:${config.webPort}`);
    console.log('\nOpen the above URL in your browser to configure and get PS4 setup instructions.\n');
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
