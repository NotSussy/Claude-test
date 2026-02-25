// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// ── Status polling ────────────────────────────────────────────────────────────

async function refreshStatus() {
  try {
    const s = await apiFetch('/api/status');
    const dot     = document.getElementById('lan-dot');
    const label   = document.getElementById('lan-label');
    const address = document.getElementById('lan-address');

    address.textContent = s.primaryIP ? `${s.primaryIP}:19132` : '—';

    if (s.bedrock?.running) {
      dot.className   = 'dot green';
      label.textContent = s.configured
        ? `Connected to ${s.targetHost}:${s.targetPort}`
        : 'Visible on LAN — enter a server above';
    } else if (s.bedrock?.error) {
      dot.className   = 'dot red';
      label.textContent = 'Error: ' + s.bedrock.error.slice(0, 60);
    } else {
      dot.className   = 'dot yellow';
      label.textContent = 'Starting…';
    }
  } catch (_) {
    const label = document.getElementById('lan-label');
    if (label) label.textContent = 'Server unreachable';
  }
}

// ── Form ──────────────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const cfg = await apiFetch('/api/config');
    document.getElementById('host').value    = cfg.targetHost || '';
    document.getElementById('port').value    = cfg.targetPort || 19132;
    document.getElementById('version').value = cfg.bedrockVersion || '1.21.50';
  } catch (_) {}
}

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const host    = document.getElementById('host').value.trim();
  const port    = parseInt(document.getElementById('port').value) || 19132;
  const version = document.getElementById('version').value.trim() || '1.21.50';
  const btn     = document.getElementById('submit-btn');
  const msg     = document.getElementById('msg');

  if (!host) {
    msg.textContent  = 'Enter a server address first.';
    msg.className    = 'msg visible error';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Connecting…';
  msg.className   = 'msg';

  try {
    await apiFetch('/api/config', {
      method: 'POST',
      body: JSON.stringify({ targetHost: host, targetPort: port, bedrockVersion: version }),
    });
    msg.textContent = '✓ Connected!';
    msg.className   = 'msg visible';
    await refreshStatus();
  } catch (err) {
    msg.textContent = '✗ ' + err.message;
    msg.className   = 'msg visible error';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Connect';
    setTimeout(() => { msg.className = 'msg'; }, 3000);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

loadConfig();
refreshStatus();
setInterval(refreshStatus, 4000);
