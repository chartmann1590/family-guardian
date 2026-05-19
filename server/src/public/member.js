// Member detail page: Leaflet map with path polyline, device health, time range selector.

(function () {
    const state = window.__MEMBER_STATE__;
    if (!state) { console.error('member state missing'); return; }

    const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([37.7749, -122.4194], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const member = state.member;
    let pathLine = null;
    let currentMarker = null;
    let historyPoints = [];

    function initials(name) {
        return (name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
    }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function relativeTime(ms) {
        if (!ms) return '—';
        const diff = Date.now() - ms;
        if (diff < 60_000) return 'Just now';
        if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
        if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
        return Math.floor(diff / 86_400_000) + 'd ago';
    }

    function isActive(recordedAt) {
        return recordedAt && Date.now() - recordedAt < 5 * 60 * 1000;
    }

    function updateHeader() {
        const avatar = document.getElementById('avatar');
        const initialsText = esc(initials(member.displayName));
        if (member.photoUrl) {
            avatar.innerHTML = `<span style="position:relative;z-index:0">${initialsText}</span>` +
                `<img src="${esc(member.photoUrl)}" alt="" onerror="this.remove()" ` +
                `style="position:absolute;inset:0;width:100%;height:100%;border-radius:9999px;object-fit:cover;z-index:1">`;
        } else {
            avatar.textContent = initials(member.displayName);
        }
        document.getElementById('member-name').textContent = member.displayName || 'Member';
        const dot = document.getElementById('status-dot');
        dot.className = 'absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-surface ' +
            (isActive(member.recordedAt) ? 'bg-secondary' : 'bg-outline-variant');

        if (member.lat != null) {
            document.getElementById('member-coords').textContent = member.lat.toFixed(4) + ', ' + member.lng.toFixed(4);
        }

        const battery = document.getElementById('battery-pct');
        battery.textContent = member.batteryPct != null ? member.batteryPct + '%' : '—';

        const speed = document.getElementById('speed-info');
        if (member.speedMps != null) {
            const kmh = (member.speedMps * 3.6).toFixed(1);
            speed.textContent = kmh + ' km/h';
        } else {
            speed.textContent = '—';
        }

        document.getElementById('last-seen').textContent = relativeTime(member.recordedAt);
    }

    function makeIcon() {
        const border = isActive(member.recordedAt) ? '#006c49' : '#76777d';
        const initialsHtml = '<span style="position:relative;z-index:0">' + esc(initials(member.displayName)) + '</span>';
        const photoHtml = member.photoUrl
            ? '<img src="' + esc(member.photoUrl) + '" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;border-radius:9999px;object-fit:cover;z-index:1">'
            : '';
        return L.divIcon({
            html: '<div style="position:relative;overflow:hidden;background:#f8f9ff;border:2px solid ' + border + ';border-radius:9999px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-weight:700;font-size:12px;color:#0b1c30;box-shadow:0 4px 12px rgba(15,23,42,0.2);">' + initialsHtml + photoHtml + '</div>',
            className: 'fg-marker',
            iconSize: [36, 36],
            iconAnchor: [18, 18],
        });
    }

    function updateCurrentMarker() {
        if (member.lat == null || member.lng == null) return;
        if (currentMarker) {
            currentMarker.setLatLng([member.lat, member.lng]);
            currentMarker.setIcon(makeIcon());
        } else {
            currentMarker = L.marker([member.lat, member.lng], { icon: makeIcon() }).addTo(map);
            currentMarker.bindTooltip(member.displayName || 'Member', { direction: 'top', offset: [0, -16] });
        }
    }

    const historyDots = [];

    function clearHistoryLayers() {
        for (const d of historyDots) { map.removeLayer(d); }
        historyDots.length = 0;
        if (pathLine) { map.removeLayer(pathLine); pathLine = null; }
    }

    function renderHistory(points) {
        clearHistoryLayers();
        historyPoints = points;

        if (points.length === 0) {
            document.getElementById('point-count').textContent = 'No location data for this period.';
            return;
        }

        document.getElementById('point-count').textContent = points.length + ' data point' + (points.length === 1 ? '' : 's');

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const opacity = 0.3 + 0.7 * (i / points.length);
            const dot = L.circleMarker([p.lat, p.lng], {
                radius: 3,
                color: '#006c49',
                fillColor: '#006c49',
                fillOpacity: opacity,
                weight: 0,
            }).addTo(map);
            historyDots.push(dot);
        }

        if (points.length >= 2) {
            const latlngs = points.map(p => [p.lat, p.lng]);
            pathLine = L.polyline(latlngs, {
                color: '#006c49',
                weight: 3,
                opacity: 0.6,
                smoothFactor: 1,
                dashArray: '6 4',
            }).addTo(map);
        }

        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentMarker) bounds.extend(currentMarker.getLatLng());
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }

    async function loadHistory(range) {
        const now = Date.now();
        let from;
        switch (range) {
            case '1h': from = now - 3600000; break;
            case '24h': from = now - 86400000; break;
            case '7d': from = now - 7 * 86400000; break;
            case '30d': from = now - 30 * 86400000; break;
            default: from = now - 86400000;
        }

        try {
            const res = await fetch(
                '/api/circles/' + state.circleId + '/members/' + state.targetUserId + '/history?from=' + from + '&to=' + now + '&limit=5000',
                { credentials: 'same-origin' }
            );
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            renderHistory(data.points || []);
        } catch (err) {
            document.getElementById('point-count').textContent = 'Failed to load history: ' + err.message;
        }
    }

    // Time range buttons
    const rangeButtons = document.querySelectorAll('#range-buttons button');
    rangeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeButtons.forEach(b => {
                b.className = 'px-3 py-1.5 rounded-full text-sm font-semibold bg-surface-container text-on-surface-variant hover:bg-surface-container-high';
            });
            btn.className = 'px-3 py-1.5 rounded-full text-sm font-semibold bg-secondary text-on-secondary';
            loadHistory(btn.dataset.range);
        });
    });

    document.getElementById('center-btn').addEventListener('click', () => {
        if (currentMarker) {
            map.flyTo(currentMarker.getLatLng(), 15);
        }
    });

    // Boot
    updateHeader();
    updateCurrentMarker();

    if (member.lat != null) {
        map.setView([member.lat, member.lng], 14);
    }

    loadHistory('24h');

    // WebSocket — live location updates
    let ws, reconnectDelay = 1000;
    function connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host + '/ws');
        ws.addEventListener('open', () => { reconnectDelay = 1000; });
        ws.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type === 'location_update' && msg.userId === state.targetUserId) {
                Object.assign(member, {
                    lat: msg.lat,
                    lng: msg.lng,
                    batteryPct: msg.batteryPct,
                    speedMps: msg.speedMps,
                    recordedAt: msg.recordedAt,
                });
                updateHeader();
                updateCurrentMarker();
            }
        });
        ws.addEventListener('close', () => {
            setTimeout(connectWs, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        });
        ws.addEventListener('error', () => { try { ws.close(); } catch {} });
    }
    connectWs();

    // Refresh relative times
    setInterval(() => {
        document.getElementById('last-seen').textContent = relativeTime(member.recordedAt);
    }, 30_000);

    setTimeout(() => map.invalidateSize(), 100);
    window.addEventListener('resize', () => map.invalidateSize());
})();
