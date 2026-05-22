(function () {
  const state = window.__GUARDIAN_APP_STATE__;
  if (!state) return;

  const API_BASE = location.origin;
  const api = {
    async json(path, options = {}) {
      const url = new URL(path, API_BASE);
      if (url.origin !== API_BASE || !url.pathname.startsWith('/api/')) throw new Error('Invalid API path');
      const res = await fetch(url.toString(), {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
        ...options,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
      return res.json();
    },
  };

  const members = new Map((state.members || []).map((m) => [m.userId, m]));
  const places = new Map((state.places || []).map((p) => [p.id, p]));
  const sosByUser = new Map((state.sosActive || []).map((s) => [s.userId, s]));
  const checkins = new Map((state.latestCheckins || []).map((c) => [c.userId, c]));
  const markers = new Map();
  const placeLayers = new Map();
  let watchId = null;
  let lastFix = null;
  let ws = null;

  const map = L.map('mobile-map', { zoomControl: false }).setView([37.7749, -122.4194], 13);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function initials(name) { return (name || '?').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'; }
  function rel(ms) {
    if (!ms) return 'No fix yet';
    const d = Date.now() - ms;
    if (d < 60000) return 'Just now';
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  }
  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $('toast-host').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 350); }, 3600);
  }
  let crashBannerTimer = null;
  function showCrashBanner(msg) {
    const el = $('crash-banner');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(crashBannerTimer);
    crashBannerTimer = setTimeout(hideCrashBanner, 35000);
  }
  function hideCrashBanner() {
    const el = $('crash-banner');
    if (el) el.style.display = 'none';
    clearTimeout(crashBannerTimer);
  }
  function avatarHtml(m) {
    if (m.photoUrl) return `<img src="${escapeHtml(m.photoUrl)}" alt="${escapeHtml(initials(m.displayName))}">`;
    return `<span>${escapeHtml(initials(m.displayName))}</span>`;
  }
  function markerIcon(m) {
    return L.divIcon({
      className: '',
      html: `<div class="marker ${sosByUser.has(m.userId) ? 'sos' : ''}">${avatarHtml(m)}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 36],
    });
  }
  function upsertMarker(m) {
    if (m.lat == null || m.lng == null) return;
    const ll = [m.lat, m.lng];
    if (markers.has(m.userId)) {
      markers.get(m.userId).setLatLng(ll).setIcon(markerIcon(m));
    } else {
      const marker = L.marker(ll, { icon: markerIcon(m) }).addTo(map).bindTooltip(m.displayName || 'Member');
      markers.set(m.userId, marker);
    }
  }
  function drawPlace(p) {
    if (p.lat == null || p.lng == null) return;
    if (placeLayers.has(p.id)) {
      placeLayers.get(p.id).setLatLng([p.lat, p.lng]).setRadius(p.radiusM);
      return;
    }
    const layer = L.circle([p.lat, p.lng], { radius: p.radiusM, color: '#006c49', weight: 2, fillOpacity: .08, dashArray: '6 6' }).addTo(map);
    placeLayers.set(p.id, layer);
  }
  function fitMap() {
    const pts = Array.from(members.values()).filter((m) => m.lat != null && m.lng != null).map((m) => [m.lat, m.lng]);
    if (pts.length === 1) map.setView(pts[0], 14);
    if (pts.length > 1) map.fitBounds(pts, { padding: [50, 80] });
  }
  function fmtPauseUntil(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const sameDay = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
  }
  function appendAvatar(container, m) {
    if (m.photoUrl && m.photoUrl.startsWith('/')) {
      const img = document.createElement('img');
      img.src = m.photoUrl;
      img.alt = initials(m.displayName);
      container.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.textContent = initials(m.displayName);
      container.appendChild(span);
    }
  }
  function renderMembers() {
    let active = 0;
    const list = $('member-list');
    list.innerHTML = '';
    for (const m of Array.from(members.values()).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))) {
      if (m.recordedAt && Date.now() - m.recordedAt < 300000) active++;
      upsertMarker(m);
      const div = document.createElement('button');
      div.className = 'card member-card';
      const avatarDiv = document.createElement('div');
      avatarDiv.className = 'avatar';
      appendAvatar(avatarDiv, m);
      const info = document.createElement('div');
      info.style.textAlign = 'left';
      info.style.minWidth = '0';
      const nameEl = document.createElement('strong');
      nameEl.textContent = m.displayName || '';
      const addrEl = document.createElement('div');
      addrEl.className = 'meta';
      addrEl.textContent = m.address || (m.lat != null ? `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}` : 'No location yet');
      const metaEl = document.createElement('div');
      metaEl.className = 'meta';
      metaEl.textContent = `${rel(m.recordedAt)}${m.batteryPct != null ? ` · ${m.batteryPct}%` : ''}`;
      info.appendChild(nameEl);
      info.appendChild(addrEl);
      info.appendChild(metaEl);
      if (m.paused) {
        const pauseEl = document.createElement('div');
        pauseEl.className = 'meta';
        pauseEl.style.color = '#943700';
        pauseEl.textContent = `⏸ Paused${m.pausedUntil ? ' until ' + fmtPauseUntil(m.pausedUntil) : ''}`;
        info.appendChild(pauseEl);
      }
      div.appendChild(avatarDiv);
      div.appendChild(info);
      div.addEventListener('click', () => openMember(m.userId));
      list.appendChild(div);
    }
    $('active-count').textContent = `${active} active`;
  }
  function renderPlaces() {
    const list = $('places-list');
    list.innerHTML = '';
    for (const p of places.values()) {
      drawPlace(p);
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `<strong>${escapeHtml(p.name)}</strong><div class="meta">${escapeHtml(p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`)} · ${Math.round(p.radiusM)}m</div><button class="danger" data-delete-place="${p.id}" style="margin-top:10px">Delete</button>`;
      list.appendChild(div);
    }
    list.querySelectorAll('[data-delete-place]').forEach((btn) => btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.deletePlace);
      if (!confirm('Delete this place?')) return;
      await api.json(`/api/places/${id}`, { method: 'DELETE' });
      places.delete(id);
      if (placeLayers.has(id)) { map.removeLayer(placeLayers.get(id)); placeLayers.delete(id); }
      renderPlaces();
    }));
  }
  async function openMember(userId) {
    const m = members.get(userId);
    const box = $('member-detail');
    box.className = 'detail card stack';
    box.innerHTML = `<div class="row spread"><strong>${escapeHtml(m.displayName)}</strong><button class="pill" id="close-member">Close</button></div><div class="meta">Loading history...</div>`;
    $('close-member').onclick = () => box.classList.add('hidden');
    try {
      const to = Date.now();
      const from = to - 7 * 86400000;
      const [hist, visits, trips] = await Promise.all([
        api.json(`/api/circles/${state.circleId}/members/${userId}/history?from=${from}&to=${to}&limit=500`),
        api.json(`/api/circles/${state.circleId}/members/${userId}/visits?from=${from}&to=${to}&limit=50`),
        api.json(`/api/circles/${state.circleId}/members/${userId}/trips?from=${from}&to=${to}&limit=50`),
      ]);
      box.innerHTML = `<div class="row spread"><strong>${escapeHtml(m.displayName)}</strong><button class="pill" id="close-member">Close</button></div>
        <div class="meta">${hist.points.length} history points · ${visits.visits.length} visits · ${trips.trips.length} trips in 7 days</div>
        <strong>Recent visits</strong>${visits.visits.slice(0, 5).map((v) => `<div class="meta">${escapeHtml(v.placeName || v.label || 'Unknown place')} · ${rel(v.startedAt)}</div>`).join('') || '<div class="meta">None</div>'}
        <strong>Recent trips</strong>${trips.trips.slice(0, 5).map((t) => `<div class="meta">${escapeHtml(t.mode)} · ${Math.round(t.distanceM)}m · ${rel(t.startedAt)}</div>`).join('') || '<div class="meta">None</div>'}`;
      $('close-member').onclick = () => box.classList.add('hidden');
    } catch (err) { toast(`Member load failed: ${err.message}`); }
  }
  async function loadChat() {
    const data = await api.json(`/api/circles/${state.circleId}/messages?limit=80`);
    $('chat-list').innerHTML = '';
    data.messages.forEach(addMessage);
  }
  function addMessage(m) {
    const div = document.createElement('div');
    div.className = `message ${m.userId === state.me.userId ? 'mine' : ''}`;
    div.innerHTML = `<strong>${escapeHtml(m.displayName || 'Member')}</strong><div>${escapeHtml(m.body)}</div><div class="meta">${rel(m.createdAt)}</div>`;
    $('chat-list').appendChild(div);
    $('chat-list').scrollTop = $('chat-list').scrollHeight;
  }
  async function loadAlerts() {
    const [prefs, alerts] = await Promise.all([
      api.json('/api/users/me/alert-prefs'),
      api.json(`/api/circles/${state.circleId}/alerts?limit=80`),
    ]);
    $('speeding-enabled').checked = prefs.speedingEnabled;
    $('speeding-threshold').value = Math.round((prefs.speedingThresholdMps || 0) * 2.23694);
    $('battery-enabled').checked = prefs.lowBatteryEnabled;
    $('battery-threshold').value = prefs.lowBatteryThreshold;
    $('offline-enabled').checked = prefs.offlineEnabled;
    $('offline-minutes').value = prefs.offlineMinutes;
    $('alerts-list').innerHTML = alerts.alerts.map((a) => `<div class="card"><strong>${escapeHtml(a.displayName || 'Member')}</strong><div class="meta">${escapeHtml(a.type)}${a.value != null ? ` · ${a.value}` : ''} · ${rel(a.createdAt)}</div></div>`).join('') || '<div class="card meta">No alerts yet.</div>';
  }
  async function refreshMembers() {
    const data = await api.json(`/api/circles/${state.circleId}/members`);
    members.clear();
    data.members.forEach((m) => members.set(m.userId, m));
    renderMembers();
  }
  async function reportLocation(pos) {
    const c = pos.coords;
    lastFix = { lat: c.latitude, lng: c.longitude, accuracyM: c.accuracy, speedMps: c.speed, bearing: c.heading, altitudeM: c.altitude, recordedAt: pos.timestamp };
    const batteryPct = await getBatteryPct();
    const body = { ...lastFix, batteryPct, activity: inferActivity(c.speed), activityConfidence: c.speed == null ? null : 50 };
    await api.json('/api/locations', { method: 'POST', body: JSON.stringify(body) });
    $('location-status').textContent = `Sharing from ${new Date(pos.timestamp).toLocaleTimeString()} · ±${Math.round(c.accuracy || 0)}m`;
    members.set(state.me.userId, { ...(members.get(state.me.userId) || state.me), lat: c.latitude, lng: c.longitude, accuracyM: c.accuracy, speedMps: c.speed, recordedAt: pos.timestamp, batteryPct });
    renderMembers();
  }
  async function getBatteryPct() {
    try {
      if (!navigator.getBattery) return null;
      const b = await navigator.getBattery();
      return Math.round(b.level * 100);
    } catch { return null; }
  }
  function inferActivity(speed) {
    if (speed == null) return null;
    if (speed < .7) return 'still';
    if (speed < 2.5) return 'walking';
    if (speed < 7) return 'running';
    return 'driving';
  }
  function startLocation() {
    if (!navigator.geolocation) { toast('Geolocation is not available.'); return; }
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; $('share-location').textContent = 'Share GPS'; $('location-status').textContent = 'Location sharing stopped.'; return; }
    watchId = navigator.geolocation.watchPosition((pos) => reportLocation(pos).catch((e) => toast(`GPS post failed: ${e.message}`)), (err) => toast(err.message), { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    $('share-location').textContent = 'Stop GPS';
    $('location-status').textContent = 'Requesting iPhone location permission...';
  }
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    $('ws-state').textContent = 'connecting';
    ws.onopen = () => { $('ws-state').textContent = 'live'; };
    ws.onclose = () => { $('ws-state').textContent = 'offline'; setTimeout(connectWs, 3000); };
    ws.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      if (ev.type === 'location_update') { members.set(ev.userId, { ...(members.get(ev.userId) || {}), ...ev }); renderMembers(); }
      if (ev.type === 'location_address') { const m = members.get(ev.userId); if (m) { m.address = ev.address; renderMembers(); } }
      if (ev.type === 'chat_message') addMessage(ev);
      if (ev.type === 'sos_active') { sosByUser.set(ev.userId, ev); renderMembers(); toast(`SOS active${ev.source === 'crash' ? ' (crash detected)' : ''}: ${ev.displayName || 'Member'}`); hideCrashBanner(); }
      if (ev.type === 'sos_resolved') { for (const [uid, sos] of sosByUser) if (sos.id === ev.id) sosByUser.delete(uid); renderMembers(); toast('SOS resolved'); hideCrashBanner(); }
      if (ev.type === 'crash_pending') { showCrashBanner(`Possible crash detected for ${ev.displayName || 'a member'} — waiting for confirmation…`); }
      if (ev.type === 'check_in') { checkins.set(ev.userId, ev); toast(`${ev.displayName || 'Member'} checked in`); }
      if (ev.type === 'pause_changed') {
        const existing = members.get(ev.userId) || { userId: ev.userId };
        existing.paused = !!ev.pausedUntil;
        existing.pausedUntil = ev.pausedUntil ?? null;
        existing.pauseReason = ev.reason ?? null;
        members.set(ev.userId, existing);
        renderMembers();
        if (ev.userId === state.me.userId) renderPauseStateMobile(ev.pausedUntil);
      }
      if (ev.type && ev.type.includes('alert')) toast(`${ev.displayName || 'Member'}: ${ev.type.replaceAll('_', ' ')}`);
      if (ev.type === 'geofence_enter' || ev.type === 'geofence_exit') toast(`${ev.displayName || 'Member'} ${ev.type.endsWith('enter') ? 'arrived at' : 'left'} ${ev.placeName}`);
    };
  }

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.tab).classList.add('active');
    setTimeout(() => map.invalidateSize(), 50);
    if (tab.dataset.tab === 'chat-view' && !$('chat-list').children.length) loadChat().catch((e) => toast(e.message));
    if (tab.dataset.tab === 'alerts-view') loadAlerts().catch((e) => toast(e.message));
  }));
  $('share-location').onclick = startLocation;
  $('locate-me').onclick = () => lastFix ? map.setView([lastFix.lat, lastFix.lng], 16) : fitMap();
  $('refresh-members').onclick = () => refreshMembers().catch((e) => toast(e.message));
  $('sos-button').onclick = async () => {
    if (!confirm('Activate SOS for your circle?')) return;
    const body = lastFix ? { lat: lastFix.lat, lng: lastFix.lng, accuracyM: lastFix.accuracyM } : {};
    const ev = await api.json('/api/sos/activate', { method: 'POST', body: JSON.stringify(body) });
    sosByUser.set(ev.userId, ev); renderMembers(); toast('SOS sent.');
  };
  document.querySelectorAll('[data-checkin]').forEach((b) => b.onclick = async () => {
    const body = { status: b.dataset.checkin, ...(lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : {}) };
    const ev = await api.json('/api/checkins', { method: 'POST', body: JSON.stringify(body) });
    checkins.set(ev.userId, ev); toast('Check-in sent.');
  });
  $('chat-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = $('chat-input').value.trim();
    if (!body) return;
    $('chat-input').value = '';
    const msg = await api.json(`/api/circles/${state.circleId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    addMessage(msg);
  };
  $('place-use-map').onclick = () => { const c = map.getCenter(); $('place-lat').value = c.lat.toFixed(6); $('place-lng').value = c.lng.toFixed(6); };
  $('place-form').onsubmit = async (e) => {
    e.preventDefault();
    const p = await api.json(`/api/circles/${state.circleId}/places`, { method: 'POST', body: JSON.stringify({ name: $('place-name').value.trim(), address: $('place-address').value.trim() || null, lat: Number($('place-lat').value), lng: Number($('place-lng').value), radiusM: Number($('place-radius').value), alertsOnEnter: $('place-enter').checked, alertsOnExit: $('place-exit').checked }) });
    places.set(p.id, p); e.target.reset(); $('place-radius').value = '150'; $('place-enter').checked = true; $('place-exit').checked = true; renderPlaces(); toast('Place saved.');
  };
  $('save-alerts').onclick = async () => {
    await api.json('/api/users/me/alert-prefs', { method: 'PATCH', body: JSON.stringify({ speedingEnabled: $('speeding-enabled').checked, speedingThresholdMps: Number($('speeding-threshold').value) / 2.23694, lowBatteryEnabled: $('battery-enabled').checked, lowBatteryThreshold: Number($('battery-threshold').value), offlineEnabled: $('offline-enabled').checked, offlineMinutes: Number($('offline-minutes').value) }) });
    toast('Alert settings saved.');
  };

  function renderPauseStateMobile(pausedUntil) {
    const status = $('pause-status-mobile');
    const unpauseBtn = $('pause-unpause-mobile');
    if (pausedUntil && pausedUntil > Date.now()) {
      status.textContent = `Paused until ${fmtPauseUntil(pausedUntil)}`;
      status.style.color = '#943700';
      unpauseBtn.classList.remove('hidden');
    } else {
      status.textContent = 'Sharing is on.';
      status.style.color = '';
      unpauseBtn.classList.add('hidden');
    }
  }
  async function setPauseMobile(minutes) {
    try {
      const data = await api.json('/api/users/me/pause', { method: 'POST', body: JSON.stringify({ durationMinutes: minutes }) });
      renderPauseStateMobile(data.pausedUntil);
      toast(`Paused until ${fmtPauseUntil(data.pausedUntil)}`);
    } catch (err) { toast(`Pause failed: ${err.message}`); }
  }
  async function unpauseMobile() {
    try {
      await api.json('/api/users/me/pause', { method: 'DELETE' });
      renderPauseStateMobile(null);
      toast('Sharing resumed');
    } catch (err) { toast(`Resume failed: ${err.message}`); }
  }
  function minutesUntilTonight() {
    const now = new Date();
    const t = new Date(now);
    t.setHours(20, 0, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return Math.max(1, Math.min(1440, Math.round((t - now) / 60000)));
  }
  document.querySelectorAll('.pause-opt-mobile').forEach((btn) => btn.addEventListener('click', () => setPauseMobile(Number(btn.dataset.minutes))));
  $('pause-tonight-mobile').addEventListener('click', () => setPauseMobile(minutesUntilTonight()));
  $('pause-unpause-mobile').addEventListener('click', unpauseMobile);
  api.json('/api/users/me/pause').then((d) => renderPauseStateMobile(d.pausedUntil)).catch(() => {});

  for (const p of places.values()) drawPlace(p);
  renderMembers(); renderPlaces(); fitMap(); connectWs();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/public/app-mobile/sw.js').catch(() => {});
})();

