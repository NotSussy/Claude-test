/**
 * DNS Spoofing Server
 *
 * Intercepts DNS queries for Minecraft Bedrock featured server domains and
 * returns this machine's IP instead, so consoles (PS4/Xbox/Switch) get
 * redirected to our Bedrock redirect server instead of the real featured server.
 *
 * All other DNS queries are forwarded to Google (8.8.8.8) transparently so
 * internet connectivity on the PS4 is not broken.
 */

const dns2 = require('dns2');
const os = require('os');

// All known Minecraft Bedrock featured server domains used on consoles.
// These are the domains the game hard-codes for the "Featured Servers" list.
const BEDROCK_DOMAINS = [
  // The Hive
  'geo.hivebedrock.network',
  'hivebedrock.network',
  // CubeCraft
  'mco.cubecraft.net',
  'play.cubecraft.net',
  'cubecraft.net',
  // Mineplex
  'mco.mineplex.com',
  // Lifeboat
  'mco.lbsg.net',
  'lbsg.net',
  // Galaxite
  'geo.galaxite.net',
  'galaxite.net',
  // InPvP
  'play.inpvp.net',
  // Pixel Paradise
  'play.pixelparadise.gg',
  // Jellyfish
  'play.jellyfish.club',
  // Breadcrumb (newer featured server)
  'mco.breadcrumb.com',
];

function isBedrockDomain(name) {
  const lower = name.toLowerCase().replace(/\.$/, ''); // strip trailing dot
  return BEDROCK_DOMAINS.some(
    (domain) => lower === domain || lower.endsWith('.' + domain)
  );
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

let dnsServer = null;
let currentLocalIP = null;

async function startDNSServer(port = 53) {
  currentLocalIP = getLocalIP();

  return new Promise((resolve, reject) => {
    const upstream = dns2.UDPClient({ dns: '8.8.8.8', port: 53 });

    dnsServer = dns2.createServer({
      udp: true,
      handle: async (request, send, rinfo) => {
        const response = dns2.Packet.createResponseFromRequest(request);
        response.header.qr = 1; // this is a response

        for (const question of request.questions) {
          const isMinecraft = isBedrockDomain(question.name);
          const isARecord = question.type === dns2.Packet.TYPE.A;
          const isAAAARecord = question.type === dns2.Packet.TYPE.AAAA;

          if (isMinecraft && isARecord) {
            // Redirect A record to our machine's IP
            response.answers.push({
              name: question.name,
              type: dns2.Packet.TYPE.A,
              class: dns2.Packet.CLASS.IN,
              ttl: 10,
              address: currentLocalIP,
            });
          } else if (isMinecraft && isAAAARecord) {
            // Return empty for AAAA so the console falls back to IPv4
            // (do nothing — empty answer forces IPv4 fallback)
          } else {
            // Forward all other queries upstream
            try {
              const result = await upstream(question.name, question.type);
              if (result && result.answers) {
                response.answers.push(...result.answers);
              }
            } catch (_) {
              // Upstream failed — leave answer empty (client will retry)
            }
          }
        }

        try {
          send(response);
        } catch (_) {
          // Client may have timed out already
        }
      },
    });

    dnsServer.on('requestError', (err) => {
      console.error('[DNS] Request error:', err.message);
    });

    dnsServer.on('error', (err) => {
      reject(err);
    });

    dnsServer.listen({ udp: { port, address: '0.0.0.0' } });

    dnsServer.on('listening', () => {
      console.log(`[DNS] Listening on UDP port ${port} — spoofing Bedrock domains → ${currentLocalIP}`);
      resolve(currentLocalIP);
    });
  });
}

function stopDNSServer() {
  if (dnsServer) {
    dnsServer.close();
    dnsServer = null;
    console.log('[DNS] Server stopped.');
  }
}

function getLocalIPAddresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  return ips;
}

module.exports = { startDNSServer, stopDNSServer, getLocalIPAddresses, getLocalIP };
