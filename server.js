/**
 * Bedrock Connector
 *
 * 1. Plain HTTP web UI (port 8080) — enter server IP + port
 * 2. Bedrock redirect server (port 19132) — shows on LAN, transfers players
 */

const http    = require('http');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const { startBedrockServer, stopBedrockServer, getStatus } = require('./modules/bedrock-server');

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  targetHost:     '',
  targetPort:     19132,
  bedrockVersion: '1.21.50',
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

// ── Network helpers ────────────────────────────────────────────────────────────

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const out  = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        out.push({ name, address: net.address });
      }
    }
  }
  return out;
}

// ── Express ────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (_req, res) => {
  const ips = getLocalIPs();
  res.json({
    configured:  !!config.targetHost,
    targetHost:  config.targetHost,
    targetPort:  config.targetPort,
    bedrock:     getStatus(),
    primaryIP:   ips[0]?.address || '127.0.0.1',
    localIPs:    ips,
  });
});

app.get('/api/config', (_req, res) => res.json(config));

app.post('/api/config', (req, res) => {
  const { targetHost, targetPort, bedrockVersion } = req.body;

  if (!targetHost || !targetHost.trim()) {
    return res.status(400).json({ error: 'Server address is required' });
  }

  config.targetHost     = targetHost.trim();
  config.targetPort     = parseInt(targetPort) || 19132;
  config.bedrockVersion = (bedrockVersion || '').trim() || '1.21.50';
  saveConfig(config);

  const localIP = getLocalIPs()[0]?.address || '127.0.0.1';
  stopBedrockServer();
  startBedrockServer(config.targetHost, config.targetPort, 19132, config.bedrockVersion, localIP);

  res.json({ success: true });
});

// ── Boot ───────────────────────────────────────────────────────────────────────

const localIP = getLocalIPs()[0]?.address || '127.0.0.1';

startBedrockServer(
  config.targetHost || null,
  config.targetPort,
  19132,
  config.bedrockVersion,
  localIP
);

const WEB_PORT = 8080;
http.createServer(app).listen(WEB_PORT, () => {
  console.log(`\nBedrock Connector running`);
  console.log(`  Web UI:  http://localhost:${WEB_PORT}`);
  console.log(`  Web UI:  http://${localIP}:${WEB_PORT}`);
  console.log(`  Bedrock: ${localIP}:19132  (shows up in Minecraft LAN)\n`);
});
