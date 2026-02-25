/**
 * Bedrock Redirect Server
 *
 * Accepts incoming Minecraft Bedrock Edition connections (from consoles
 * whose DNS was redirected) and immediately sends a Transfer packet that
 * moves the player to the real Geyser server.
 *
 * The player sees it as seamlessly joining the target server — the
 * "featured server" hop is invisible.
 */

const bedrock = require('bedrock-protocol');

let server = null;
let connectionCount = 0;
let transferCount = 0;

const STATUS = {
  running: false,
  targetHost: null,
  targetPort: null,
  connections: 0,
  transfers: 0,
  error: null,
};

function startBedrockServer(targetHost, targetPort, listenPort = 19132, bedrockVersion = '1.21.50', localIP = null) {
  if (server) {
    stopBedrockServer();
  }

  const configured = !!(targetHost && targetHost.trim());

  STATUS.error = null;
  STATUS.targetHost = targetHost || null;
  STATUS.targetPort = targetPort;

  const motdText  = configured ? `Redirecting to ${targetHost}` : 'Open web UI to configure';
  const levelName = configured ? 'Connecting...' : 'MC Bedrock Connector';

  console.log(`[Bedrock] Starting server on port ${listenPort} (${configured ? `→ ${targetHost}:${targetPort}` : 'unconfigured — LAN discovery only'})`);

  try {
    server = bedrock.createServer({
      host: '0.0.0.0',
      port: listenPort,
      offline: true,   // Skip Xbox Live token verification — we just need to redirect
      version: bedrockVersion,
      maxPlayers: 20,
      motd: {
        levelName,
        motd: motdText,
      },
    });

    server.on('connect', (client) => {
      connectionCount++;
      STATUS.connections = connectionCount;
      const playerName = client.profile?.name || client.username || 'unknown';
      console.log(`[Bedrock] Player connecting: ${playerName}`);

      client.on('join', () => {
        const name = client.profile?.name || client.username || 'unknown';

        // When unconfigured, disconnect with instructions instead of transferring
        if (!configured) {
          const uiURL = localIP ? `https://${localIP}` : 'https://[server-ip]';
          console.log(`[Bedrock] Disconnecting "${name}" — server not configured`);
          try {
            client.disconnect(
              `MC Bedrock Connector is not configured yet.\nVisit ${uiURL} on any browser to set your target server.`
            );
          } catch (_) {}
          return;
        }

        console.log(`[Bedrock] Redirecting "${name}" → ${targetHost}:${targetPort}`);

        try {
          client.write('transfer', {
            server_address: targetHost,
            port: targetPort,
          });
          transferCount++;
          STATUS.transfers = transferCount;
        } catch (err) {
          console.error(`[Bedrock] Failed to send transfer packet to "${name}":`, err.message);
        }
      });

      client.on('error', (err) => {
        // Common: client disconnected before transfer completed
        if (!err.message.includes('ECONNRESET') && !err.message.includes('closed')) {
          console.error('[Bedrock] Client error:', err.message);
        }
      });

      client.on('close', () => {
        const name = client.profile?.name || client.username || 'unknown';
        console.log(`[Bedrock] Player disconnected: ${name}`);
      });
    });

    server.on('error', (err) => {
      STATUS.running = false;
      STATUS.error = err.message;
      console.error('[Bedrock] Server error:', err.message);
    });

    STATUS.running = true;
    console.log(`[Bedrock] Server listening on port ${listenPort}`);
  } catch (err) {
    STATUS.running = false;
    STATUS.error = err.message;
    console.error('[Bedrock] Failed to start server:', err.message);
    throw err;
  }

  return server;
}

function stopBedrockServer() {
  if (server) {
    try {
      server.close();
    } catch (_) {
      // Ignore close errors
    }
    server = null;
    STATUS.running = false;
    console.log('[Bedrock] Server stopped.');
  }
}

function getStatus() {
  return { ...STATUS };
}

module.exports = { startBedrockServer, stopBedrockServer, getStatus };
