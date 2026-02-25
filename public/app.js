/* Front-end logic for MC Bedrock Connector */

// ── Helpers ───────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function setStatusItem(id, state, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'status-item ' + state;
  const val = el.querySelector('.value');
  if (val) val.textContent = value;
}

// ── Status polling ─────────────────────────────────────────────────────────

async function refreshStatus() {
  try {
    const s = await apiFetch('/api/status');

    // DNS
    setStatusItem('s-dns', s.dnsRunning ? 'ok' : 'error', s.dnsRunning ? 'Running' : 'Stopped');

    // Bedrock redirect server
    if (s.bedrock?.running) {
      setStatusItem('s-bedrock', 'ok', `Running  (port ${s.bedrockListenPort})`);
    } else if (s.bedrock?.error) {
      setStatusItem('s-bedrock', 'error', 'Error: ' + s.bedrock.error.slice(0, 40));
    } else {
      setStatusItem('s-bedrock', 'warn', 'Not started');
    }

    // Target server
    if (s.configured) {
      setStatusItem('s-target', 'ok', `${s.targetHost}:${s.targetPort}`);
    } else {
      setStatusItem('s-target', 'warn', 'Not configured');
    }

    // LAN box + IP list
    renderLANBox(s);
    renderIPs(s.localIPs || [], s.primaryIP);

    // Update DNS IP in the guide
    const guideIP = document.getElementById('guide-ip');
    if (guideIP && s.primaryIP) {
      guideIP.textContent = s.primaryIP;
    }

  } catch (err) {
    setStatusItem('s-dns',     'error', 'Server unreachable');
    setStatusItem('s-bedrock', 'error', 'Server unreachable');
    setStatusItem('s-target',  'error', 'Server unreachable');
  }
}

// ── LAN box ────────────────────────────────────────────────────────────────

let _lanIP   = null;
let _lanPort = 19132;

function renderLANBox(status) {
  const ipEl    = document.getElementById('lan-ip');
  const portEl  = document.getElementById('lan-port');
  const badge   = document.getElementById('lan-badge');
  const badgeTx = document.getElementById('lan-badge-text');
  if (!ipEl) return;

  _lanIP   = status.primaryIP  || null;
  _lanPort = status.bedrockListenPort || 19132;

  ipEl.textContent   = _lanIP   || '—';
  portEl.textContent = _lanPort;

  if (badge) {
    if (status.bedrock?.running) {
      badge.className  = 'lan-badge ok';
      badgeTx.textContent = 'Broadcasting on LAN';
    } else if (status.bedrock?.error) {
      badge.className  = 'lan-badge error';
      badgeTx.textContent = 'Bedrock server error';
    } else {
      badge.className  = 'lan-badge warn';
      badgeTx.textContent = 'Not broadcasting yet';
    }
  }
}

function copyLAN(what) {
  const text = what === 'full' ? `${_lanIP}:${_lanPort}` : _lanIP;
  if (!text || text === 'null') return;

  navigator.clipboard.writeText(text).then(() => {
    const btnId = what === 'full' ? 'btn-copy-full' : 'btn-copy-ip';
    const btn   = document.getElementById(btnId);
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  });
}

// ── IP display ─────────────────────────────────────────────────────────────

function renderIPs(ips, primary) {
  const container = document.getElementById('ip-list');
  if (!container) return;

  if (!ips.length) {
    container.innerHTML = '<span class="loading">No network interfaces found</span>';
    return;
  }

  // Only show the extra chips if there are multiple interfaces
  if (ips.length <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = ips.map((ip) => `
    <div class="ip-chip" title="Click to copy" onclick="copyIP('${ip.address}')">
      ${ip.address}
      <small>${ip.name}</small>
    </div>
  `).join('');
}

function copyIP(ip) {
  navigator.clipboard.writeText(ip).then(() => {
    const chips = document.querySelectorAll('.ip-chip');
    chips.forEach((c) => {
      if (c.textContent.trim().startsWith(ip)) {
        const orig = c.style.background;
        c.style.background = 'rgba(78,204,163,0.25)';
        setTimeout(() => { c.style.background = orig; }, 600);
      }
    });
  });
}

// ── Config form ────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const cfg = await apiFetch('/api/config');
    document.getElementById('targetHost').value        = cfg.targetHost || '';
    document.getElementById('targetPort').value        = cfg.targetPort || 19132;
    document.getElementById('bedrockListenPort').value = cfg.bedrockListenPort || 19132;
    document.getElementById('bedrockVersion').value    = cfg.bedrockVersion || '1.21.50';
    checkPortWarning();
  } catch (_) {
    // Config load failure is not fatal
  }
}

function checkPortWarning() {
  const tp  = parseInt(document.getElementById('targetPort')?.value);
  const blp = parseInt(document.getElementById('bedrockListenPort')?.value);
  const warn = document.getElementById('port-warning');
  if (warn) warn.style.display = (tp === blp) ? 'block' : 'none';
}

document.getElementById('targetPort')?.addEventListener('input', checkPortWarning);
document.getElementById('bedrockListenPort')?.addEventListener('input', checkPortWarning);

document.getElementById('config-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    targetHost:        document.getElementById('targetHost').value.trim(),
    targetPort:        parseInt(document.getElementById('targetPort').value) || 19132,
    bedrockListenPort: parseInt(document.getElementById('bedrockListenPort').value) || 19132,
    bedrockVersion:    document.getElementById('bedrockVersion').value.trim() || '1.21.50',
  };

  const btn = e.target.querySelector('button[type="submit"]');
  const msg = document.getElementById('save-msg');

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(payload) });
    msg.textContent = '✓ Saved!';
    msg.className = 'save-msg visible';
    await refreshStatus();
  } catch (err) {
    msg.textContent = '✗ ' + err.message;
    msg.className = 'save-msg visible';
    msg.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Apply';
    setTimeout(() => { msg.className = 'save-msg'; }, 3000);
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────

loadConfig();
refreshStatus();
setInterval(refreshStatus, 5000); // poll every 5 s
