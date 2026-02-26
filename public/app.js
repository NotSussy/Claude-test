async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function refreshStatus() {
  try {
    const s = await apiFetch('/api/status');
    const dot  = document.getElementById('dot');
    const text = document.getElementById('status-text');
    const addr = document.getElementById('lan-address');

    addr.textContent = s.primaryIP ? `${s.primaryIP}:19132` : '—';

    if (s.bedrock?.running) {
      dot.className   = 'dot green';
      text.textContent = s.configured
        ? `→ ${s.targetHost}:${s.targetPort}`
        : 'Visible on LAN — enter a server above';
    } else if (s.bedrock?.error) {
      dot.className   = 'dot red';
      text.textContent = s.bedrock.error.slice(0, 80);
    } else {
      dot.className   = 'dot yellow';
      text.textContent = 'Starting…';
    }
  } catch (_) {}
}

async function loadConfig() {
  try {
    const cfg = await apiFetch('/api/config');
    document.getElementById('host').value = cfg.targetHost || '';
    document.getElementById('port').value = cfg.targetPort || 19132;
  } catch (_) {}
}

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const host = document.getElementById('host').value.trim();
  const port = parseInt(document.getElementById('port').value) || 19132;
  const btn  = document.getElementById('submit-btn');

  if (!host) return;

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    await apiFetch('/api/config', {
      method: 'POST',
      body: JSON.stringify({ targetHost: host, targetPort: port, bedrockVersion: '1.21.50' }),
    });
    await refreshStatus();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Connect';
  }
});

loadConfig();
refreshStatus();
setInterval(refreshStatus, 4000);
