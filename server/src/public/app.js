// Family Guardian dashboard client
// - Renders Leaflet map with one marker per circle member
// - Opens WebSocket and applies `location_update` events live
// - Refreshes the sidebar member list

(function () {
    const state = window.__GUARDIAN_STATE__;
    if (!state) {
        console.error('Initial state missing.');
        return;
    }

    const DEFAULT_CENTER = [37.7749, -122.4194]; // SF — placeholder until first fix
    const map = L.map('map', { zoomControl: true, attributionControl: true }).setView(DEFAULT_CENTER, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const markers = new Map();     // userId -> L.Marker
    const members = new Map();     // userId -> { displayName, lat, lng, batteryPct, recordedAt }
    const placeLayers = new Map(); // placeId -> L.Circle
    const places = new Map();      // placeId -> { id, name, lat, lng, radiusM }
    const sosByUser = new Map();   // userId -> sos event (active only)
    const checkins = new Map();    // userId -> { status, createdAt }

    function initialsAvatar(name) {
        const initials = (name || '?')
            .split(/\s+/)
            .map((w) => w[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase();
        return initials || '?';
    }

    // Avatar inner HTML — initials always render; an <img> overlays them when
    // photoUrl is set, and onerror removes itself so the initials show through
    // if the upload was deleted server-side.
    function avatarInner(m) {
        const text = `<span style="position:relative;z-index:0">${escapeHtml(initialsAvatar(m.displayName))}</span>`;
        if (!m.photoUrl) return text;
        return `${text}<img src="${escapeHtml(m.photoUrl)}" alt="" loading="lazy" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;border-radius:9999px;object-fit:cover;z-index:1;background:transparent">`;
    }

    function makeIcon(member, active, sos) {
        if (sos) {
            return L.divIcon({
                html: `<div class="fg-sos-pulse" style="position:relative;overflow:hidden">${avatarInner(member)}</div>`,
                className: 'fg-sos-marker',
                iconSize: [36, 36],
                iconAnchor: [18, 18],
            });
        }
        const paused = member.paused;
        const border = paused ? '#943700' : (active ? '#006c49' : '#76777d');
        const grayscale = paused ? 'filter:grayscale(0.7);opacity:0.85;' : '';
        const badge = paused
            ? `<div style="position:absolute;bottom:-4px;right:-4px;background:#943700;color:#fff;border-radius:9999px;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:11px;border:1.5px solid #f8f9ff;z-index:2">⏸</div>`
            : '';
        const html = `
            <div style="position:relative">
              <div style="
                position:relative;overflow:hidden;
                background:#f8f9ff;
                border:2px solid ${border};
                border-radius:9999px;
                width:36px;height:36px;
                display:flex;align-items:center;justify-content:center;
                font-family:Inter,sans-serif;font-weight:700;font-size:12px;
                color:#0b1c30;
                box-shadow:0 4px 12px rgba(15,23,42,0.2);
                ${grayscale}
              ">${avatarInner(member)}</div>
              ${badge}
            </div>`;
        return L.divIcon({
            html,
            className: 'fg-marker',
            iconSize: [36, 36],
            iconAnchor: [18, 18],
        });
    }

    function formatPauseUntil(ms) {
        if (!ms) return '';
        const date = new Date(ms);
        const today = new Date();
        const sameDay = date.toDateString() === today.toDateString();
        const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return sameDay ? time : `${date.toLocaleDateString()} ${time}`;
    }

    function isActive(recordedAt) {
        return recordedAt && Date.now() - recordedAt < 5 * 60 * 1000;
    }

    function relativeTime(ms) {
        if (!ms) return '—';
        const diff = Date.now() - ms;
        if (diff < 60_000) return 'Just now';
        if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
        if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
        return Math.floor(diff / 86_400_000) + 'd ago';
    }

    function batteryColor(pct) {
        if (pct == null) return { fg: '#45464d', bg: '#e5eeff' };
        if (pct < 10) return { fg: '#ba1a1a', bg: '#ffdad6' };
        if (pct < 20) return { fg: '#943700', bg: '#ffdbcd' };
        return { fg: '#006c49', bg: '#e5eeff' };
    }

    function checkinLabel(status) {
        if (status === 'safe_home') return { text: 'Safe at home', icon: 'home', fg: '#006c49', bg: '#6cf8bb' };
        if (status === 'out_safe') return { text: 'Out & safe', icon: 'thumb_up', fg: '#006c49', bg: '#6cf8bb' };
        if (status === 'heading_home') return { text: 'Heading home', icon: 'directions_walk', fg: '#943700', bg: '#ffdbcd' };
        return null;
    }

    function renderMemberList() {
        const list = document.getElementById('member-list');
        const activeCount = document.getElementById('active-count');
        list.innerHTML = '';
        let active = 0;

        const sorted = Array.from(members.values()).sort((a, b) => {
            if (a.userId === state.me.userId) return -1;
            if (b.userId === state.me.userId) return 1;
            return (a.displayName || '').localeCompare(b.displayName || '');
        });

        for (const m of sorted) {
            const liveNow = isActive(m.recordedAt);
            if (liveNow) active += 1;
            const battery = batteryColor(m.batteryPct);
            const card = document.createElement('div');
            card.className = 'p-4 border-b border-surface-container flex items-start gap-3 hover:bg-surface-container-low cursor-pointer';
            card.innerHTML = `
                <div class="relative mt-1">
                    <div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center font-bold text-on-surface" style="position:relative;overflow:hidden">${avatarInner(m)}</div>
                    <div class="absolute -bottom-1 -right-1 w-3.5 h-3.5 ${liveNow ? 'bg-secondary' : 'bg-outline-variant'} border-2 border-surface rounded-full" style="z-index:2"></div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-headline-md text-headline-md text-on-surface text-base truncate">${escapeHtml(m.displayName || 'Member')}</span>
                        <span class="font-label-md text-label-md text-on-surface-variant whitespace-nowrap">${relativeTime(m.recordedAt)}</span>
                    </div>
                    <p class="font-body-md text-body-md text-on-surface-variant text-sm mb-2">${m.lat != null ? escapeHtml(m.address || `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`) : 'No location yet'}</p>
                    <div class="flex gap-status-pill-gap flex-wrap">
                        ${(() => {
                            const ci = checkins.get(m.userId);
                            const ciLabel = ci ? checkinLabel(ci.status) : null;
                            const ciPhoto = ci?.photoUrl ? `<img src="${escapeHtml(ci.photoUrl)}" alt="" class="w-4 h-4 rounded-full object-cover" onerror="this.remove()">` : '';
                            return ciLabel ? `
                            <div class="flex items-center gap-1 px-2 py-0.5 rounded-full" style="background:${ciLabel.bg}33">
                                ${ciPhoto}
                                <span class="material-symbols-outlined text-[14px]" style="color:${ciLabel.fg}">${ciLabel.icon}</span>
                                <span class="font-status-number text-status-number" style="color:${ciLabel.fg}">${ciLabel.text}</span>
                            </div>` : '';
                        })()}
                        ${m.batteryPct != null ? `
                            <div class="flex items-center gap-1 px-2 py-0.5 rounded-full" style="background:${battery.bg}33">
                                <span class="material-symbols-outlined text-[14px]" style="color:${battery.fg}">battery_full</span>
                                <span class="font-status-number text-status-number" style="color:${battery.fg}">${escapeHtml(m.batteryPct)}%</span>
                            </div>` : ''}
                        ${(() => {
                            const icon = window.FgUnits && window.FgUnits.activityIcon(m.activity);
                            if (!icon) return '';
                            const speed = m.speedMps != null && m.speedMps > 0.3
                                ? window.FgUnits.formatSpeed(m.speedMps) : '';
                            const label = (window.FgUnits.activityLabel(m.activity) || '') + (speed ? ' • ' + speed : '');
                            return `
                            <div class="flex items-center gap-1 px-2 py-0.5 rounded-full" style="background:#e5eeff66">
                                <span class="material-symbols-outlined text-[14px]" style="color:#0b1c30">${icon}</span>
                                <span class="font-status-number text-status-number" style="color:#0b1c30">${escapeHtml(label)}</span>
                            </div>`;
                        })()}
                        ${m.paused ? `
                            <div class="flex items-center gap-1 px-2 py-0.5 rounded-full" style="background:#ffdbcd66">
                                <span class="material-symbols-outlined text-[14px]" style="color:#943700">pause_circle</span>
                                <span class="font-status-number text-status-number" style="color:#943700">Paused${m.pausedUntil ? ' until ' + escapeHtml(formatPauseUntil(m.pausedUntil)) : ''}</span>
                            </div>` : ''}
                        ${(!m.paused && !liveNow) ? `
                            <div class="flex items-center gap-1 bg-surface-container px-2 py-0.5 rounded-full">
                                <span class="material-symbols-outlined text-[14px] text-outline">wifi_off</span>
                                <span class="font-status-number text-status-number text-outline">Idle</span>
                            </div>` : ''}
                    </div>
                </div>`;
            card.addEventListener('click', () => {
                window.location.href = '/member/' + encodeURIComponent(m.userId);
            });
            list.appendChild(card);
        }

        activeCount.textContent = `${active} Active`;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function upsertMarker(m) {
        if (m.lat == null || m.lng == null) return;
        const existing = markers.get(m.userId);
        const sos = sosByUser.has(m.userId);
        const icon = makeIcon(m, isActive(m.recordedAt), sos);
        if (existing) {
            existing.setLatLng([m.lat, m.lng]);
            existing.setIcon(icon);
        } else {
            const marker = L.marker([m.lat, m.lng], { icon }).addTo(map);
            marker.bindTooltip(escapeHtml(m.displayName || 'Member'), { direction: 'top', offset: [0, -16] });
            markers.set(m.userId, marker);
        }
    }

    function fitMapToMembers() {
        const points = Array.from(members.values()).filter((m) => m.lat != null).map((m) => [m.lat, m.lng]);
        if (points.length === 0) return;
        if (points.length === 1) {
            map.setView(points[0], 14);
        } else {
            map.fitBounds(points, { padding: [40, 40] });
        }
    }

    function drawPlace(p) {
        const existing = placeLayers.get(p.id);
        if (existing) {
            existing.setLatLng([p.lat, p.lng]);
            existing.setRadius(p.radiusM);
            return;
        }
        const layer = L.circle([p.lat, p.lng], {
            radius: p.radiusM,
            color: '#006c49',
            weight: 2,
            opacity: 0.8,
            dashArray: '6 6',
            fillColor: '#006c49',
            fillOpacity: 0.08,
            interactive: false,
        }).addTo(map);
        placeLayers.set(p.id, layer);
    }

    function toast(msg, kind = 'info') {
        const host = document.getElementById('toast-host');
        if (!host) return;
        const el = document.createElement('div');
        const bg = kind === 'enter' ? '#006c49' : kind === 'exit' ? '#ba1a1a' : '#0b1c30';
        el.style.cssText = `
            background:${bg};color:#fff;border-radius:10px;padding:10px 14px;
            font-family:Inter,sans-serif;font-size:14px;font-weight:500;
            box-shadow:0 12px 24px rgba(15,23,42,0.2);max-width:360px;
        `;
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity 0.4s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 500);
        }, 4_000);
    }

    function renderSosBanner() {
        const banner = document.getElementById('sos-banner');
        const title = document.getElementById('sos-banner-title');
        const meta = document.getElementById('sos-banner-meta');
        const locateBtn = document.getElementById('sos-locate');
        const resolveBtn = document.getElementById('sos-resolve');
        const active = Array.from(sosByUser.values());
        if (active.length === 0) { banner.classList.add('hidden'); return; }

        const first = active[0];
        const isMine = first.userId === state.me.userId;
        const firstMember = members.get(first.userId);
        const locText = first.lat != null
            ? (firstMember?.address || `${first.lat.toFixed(4)}, ${first.lng.toFixed(4)}`)
            : 'location unknown';
        title.textContent = `${first.displayName} triggered SOS`;
        meta.textContent =
            `at ${locText}` +
            ` · ${relativeTime(first.startedAt)}` +
            (active.length > 1 ? ` · ${active.length - 1} other active SOS` : '');
        banner.classList.remove('hidden');

        locateBtn.onclick = () => {
            if (first.lat != null) map.flyTo([first.lat, first.lng], 16);
        };

        if (isMine || state.me.role === 'admin') {
            resolveBtn.classList.remove('hidden');
            resolveBtn.onclick = async () => {
                resolveBtn.disabled = true;
                try {
                    const res = await fetch('/api/sos/' + encodeURIComponent(first.id) + '/resolve', {
                        method: 'POST', credentials: 'same-origin',
                    });
                    if (!res.ok) {
                        const e = await res.json().catch(() => ({}));
                        alert('Resolve failed: ' + (e.error || res.status));
                    }
                } finally { resolveBtn.disabled = false; }
            };
        } else {
            resolveBtn.classList.add('hidden');
        }
    }

    function applySosEvent(ev) {
        if (ev.type === 'sos_active') {
            sosByUser.set(ev.userId, ev);
            const existingMember = members.get(ev.userId) || { userId: ev.userId };
            if (ev.lat != null) {
                Object.assign(existingMember, {
                    displayName: ev.displayName || existingMember.displayName,
                    lat: ev.lat, lng: ev.lng, recordedAt: ev.startedAt,
                });
                members.set(ev.userId, existingMember);
                upsertMarker(existingMember);
            } else if (markers.has(ev.userId)) {
                // No coords on the event but we have a marker — re-skin as SOS pulse.
                upsertMarker(existingMember);
            }
        } else if (ev.type === 'sos_resolved') {
            sosByUser.delete(ev.userId);
            const m = members.get(ev.userId);
            if (m) upsertMarker(m);
        }
        renderSosBanner();
        renderMemberList();
    }

    // Sidebar SOS button — trigger an SOS for the current user
    const sosBtn = document.getElementById('sos-btn');
    if (sosBtn) {
        sosBtn.addEventListener('click', async () => {
            if (!confirm('Activate SOS now? This will alert everyone in your circle.')) return;
            sosBtn.disabled = true;
            try {
                const res = await fetch('/api/sos/activate', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({}),
                });
                if (!res.ok) {
                    const e = await res.json().catch(() => ({}));
                    alert('Failed to activate SOS: ' + (e.error || res.status));
                }
            } finally { sosBtn.disabled = false; }
        });
    }

    // Check-in button — toggle the status picker dialog
    const checkinBtn = document.getElementById('checkin-btn');
    const checkinDialog = document.getElementById('checkin-dialog');
    if (checkinBtn && checkinDialog) {
        checkinBtn.addEventListener('click', () => {
            checkinDialog.classList.toggle('hidden');
        });
        for (const opt of checkinDialog.querySelectorAll('.checkin-opt')) {
            opt.addEventListener('click', async () => {
                const status = opt.dataset.status;
                try {
                    const res = await fetch('/api/checkins', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ status }),
                    });
                    if (!res.ok) {
                        const e = await res.json().catch(() => ({}));
                        alert('Check-in failed: ' + (e.error || res.status));
                    }
                } finally {
                    checkinDialog.classList.add('hidden');
                }
            });
        }
    }

    // Initial state from server-side render
    for (const m of state.members || []) {
        members.set(m.userId, m);
        upsertMarker(m);
    }
    for (const p of state.places || []) {
        places.set(p.id, p);
        drawPlace(p);
    }
    for (const ev of state.sosActive || []) {
        sosByUser.set(ev.userId, ev);
        // re-skin marker if we already have one
        const m = members.get(ev.userId);
        if (m) upsertMarker(m);
    }
    for (const ci of state.latestCheckins || []) {
        checkins.set(ci.userId, { status: ci.status, createdAt: ci.createdAt, photoUrl: ci.photoUrl || null });
    }
    renderMemberList();
    renderSosBanner();
    fitMapToMembers();
    map.invalidateSize();

    // WebSocket — live location updates
    let ws;
    let reconnectDelay = 1000;
    function connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}/ws`);
        ws.addEventListener('open', () => { reconnectDelay = 1000; });
        ws.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type === 'location_update') {
                const existing = members.get(msg.userId) || { userId: msg.userId };
                const updated = Object.assign(existing, {
                    displayName: msg.displayName || existing.displayName,
                    lat: msg.lat,
                    lng: msg.lng,
                    batteryPct: msg.batteryPct,
                    speedMps: msg.speedMps,
                    activity: msg.activity,
                    activityConfidence: msg.activityConfidence,
                    bearing: msg.bearing,
                    altitudeM: msg.altitudeM,
                    recordedAt: msg.recordedAt,
                    address: msg.address ?? existing.address,
                });
                members.set(msg.userId, updated);
                upsertMarker(updated);
                renderMemberList();
            } else if (msg.type === 'location_address') {
                const existing = members.get(msg.userId);
                if (existing) {
                    existing.address = msg.address;
                    renderMemberList();
                }
            } else if (msg.type === 'speeding_alert') {
                const speed = window.FgUnits ? window.FgUnits.formatSpeed(msg.speedMps) : (msg.speedMps + ' m/s');
                toast(`⚠️ ${msg.displayName} is going ${speed}`, 'exit');
            } else if (msg.type === 'low_battery_alert') {
                toast(`🪫 ${msg.displayName}'s battery: ${msg.batteryPct}%`, 'exit');
            } else if (msg.type === 'offline_alert') {
                toast(`📵 ${msg.displayName} hasn't reported for ${msg.minutesOffline}m`, 'exit');
            } else if (msg.type === 'visit_end') {
                const dur = window.FgUnits ? window.FgUnits.formatDuration(msg.durationMs) : '';
                const where = msg.label || (msg.lat ? `${msg.lat.toFixed(3)}, ${msg.lng.toFixed(3)}` : 'a location');
                toast(`📍 ${msg.displayName} left ${where} after ${dur}`, 'enter');
            } else if (msg.type === 'geofence_enter') {
                if (!msg.notifyUserIds || msg.notifyUserIds.includes(state.me.userId))
                    toast(`${msg.displayName} arrived at ${msg.placeName}`, 'enter');
            } else if (msg.type === 'geofence_exit') {
                if (!msg.notifyUserIds || msg.notifyUserIds.includes(state.me.userId))
                    toast(`${msg.displayName} left ${msg.placeName}`, 'exit');
            } else if (msg.type === 'sos_active' || msg.type === 'sos_resolved') {
                applySosEvent(msg);
                if (msg.type === 'sos_active') {
                    toast(`🚨 ${msg.displayName} triggered SOS`, 'exit');
                } else {
                    toast(`SOS resolved for ${msg.displayName}`, 'enter');
                }
            } else if (msg.type === 'check_in') {
                checkins.set(msg.userId, { status: msg.status, createdAt: msg.createdAt, photoUrl: msg.photoUrl || null });
                renderMemberList();
                const ciLabel = checkinLabel(msg.status);
                if (ciLabel) toast(`${msg.displayName}: ${ciLabel.text}`, 'enter');
            } else if (msg.type === 'pause_changed') {
                const existing = members.get(msg.userId);
                if (existing) {
                    const wasPaused = !!existing.paused;
                    existing.paused = !!msg.pausedUntil;
                    existing.pausedUntil = msg.pausedUntil ?? null;
                    existing.pauseReason = msg.reason ?? null;
                    members.set(msg.userId, existing);
                    upsertMarker(existing);
                    renderMemberList();
                    if (msg.userId !== state.me.userId) {
                        if (existing.paused && !wasPaused) {
                            toast(`${existing.displayName || 'A member'} paused sharing`, 'exit');
                        } else if (!existing.paused && wasPaused) {
                            toast(`${existing.displayName || 'A member'} resumed sharing`, 'enter');
                        }
                    }
                }
            }
        });
        ws.addEventListener('close', () => {
            setTimeout(connectWs, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        });
        ws.addEventListener('error', () => { try { ws.close(); } catch {} });
    }
    connectWs();

    // Periodic re-render so "Just now / 2m ago" stays fresh
    setInterval(renderMemberList, 30_000);

    // Map needs an invalidateSize when the sidebar layout settles
    window.addEventListener('resize', () => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 100);
})();
