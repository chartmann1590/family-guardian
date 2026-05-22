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
            document.getElementById('member-coords').textContent = member.address || (member.lat.toFixed(4) + ', ' + member.lng.toFixed(4));
        }

        const battery = document.getElementById('battery-pct');
        battery.textContent = member.batteryPct != null ? member.batteryPct + '%' : '—';

        const speed = document.getElementById('speed-info');
        speed.textContent = window.FgUnits ? window.FgUnits.formatSpeed(member.speedMps) : (member.speedMps != null ? (member.speedMps * 3.6).toFixed(1) + ' km/h' : '—');

        const activityEl = document.getElementById('activity-info');
        if (activityEl) {
            const label = window.FgUnits && window.FgUnits.activityLabel(member.activity);
            activityEl.textContent = label || '—';
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
            currentMarker.bindTooltip(esc(member.displayName || 'Member'), { direction: 'top', offset: [0, -16] });
        }
    }

    const historyDots = [];
    const pathSegments = [];
    const visitMarkers = [];

    function clearHistoryLayers() {
        for (const d of historyDots) { map.removeLayer(d); }
        historyDots.length = 0;
        for (const s of pathSegments) { map.removeLayer(s); }
        pathSegments.length = 0;
        for (const v of visitMarkers) { map.removeLayer(v); }
        visitMarkers.length = 0;
    }

    function activityColor(activity) {
        switch (activity) {
            case 'driving': return '#ba1a1a';
            case 'running': return '#943700';
            case 'cycling': return '#006c49';
            case 'walking': return '#006c49';
            case 'still': return '#76777d';
            default: return '#0b1c30';
        }
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
                color: activityColor(p.activity),
                fillColor: activityColor(p.activity),
                fillOpacity: opacity,
                weight: 0,
            }).addTo(map);
            historyDots.push(dot);
        }

        if (points.length >= 2) {
            // Draw one polyline per same-activity run so each segment can be
            // coloured for the movement mode (driving = red, walking = green, …).
            let runStart = 0;
            for (let i = 1; i <= points.length; i++) {
                const prevActivity = points[runStart].activity || null;
                const curActivity = i < points.length ? (points[i].activity || null) : null;
                if (i === points.length || curActivity !== prevActivity) {
                    const slice = points.slice(runStart, i + 1).map(p => [p.lat, p.lng]);
                    if (slice.length >= 2) {
                        const line = L.polyline(slice, {
                            color: activityColor(prevActivity),
                            weight: 3,
                            opacity: 0.7,
                            smoothFactor: 1,
                        }).addTo(map);
                        pathSegments.push(line);
                    }
                    runStart = i;
                }
            }
        }

        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentMarker) bounds.extend(currentMarker.getLatLng());
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }

    function renderVisitPins(visits) {
        for (const v of visitMarkers) { map.removeLayer(v); }
        visitMarkers.length = 0;
        for (const v of visits) {
            const label = v.placeName || v.label || `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`;
            const dur = window.FgUnits ? window.FgUnits.formatDuration(v.durationMs) : '';
            const marker = L.marker([v.lat, v.lng], {
                icon: L.divIcon({
                    className: 'fg-visit-pin',
                    html: `<div style="background:#dce9ff;border:2px solid #006c49;border-radius:50%;width:14px;height:14px;"></div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7],
                }),
            }).addTo(map);
            marker.bindPopup(`<strong>${esc(label)}</strong><br>${esc(dur)}`);
            visitMarkers.push(marker);
        }
    }

    function rangeFrom(range) {
        const now = Date.now();
        switch (range) {
            case '1h': return now - 3600000;
            case '24h': return now - 86400000;
            case '7d': return now - 7 * 86400000;
            case '30d': return now - 30 * 86400000;
            default: return now - 86400000;
        }
    }

    let currentRange = '24h';

    async function loadHistory(range) {
        currentRange = range;
        const from = rangeFrom(range);
        const now = Date.now();
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
        // Refresh sidebar list whenever the range changes.
        if (activeTab === 'visits') loadVisits();
        else loadTrips();
    }

    let activeTab = 'visits';

    async function loadVisits() {
        const from = rangeFrom(currentRange);
        const now = Date.now();
        const list = document.getElementById('visits-trips-list');
        list.innerHTML = '<p class="font-label-md text-label-md text-on-surface-variant">Loading…</p>';
        try {
            const res = await fetch(
                '/api/circles/' + state.circleId + '/members/' + state.targetUserId + '/visits?from=' + from + '&to=' + now,
                { credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const visits = data.visits || [];
            renderVisitPins(visits);
            if (visits.length === 0) {
                list.innerHTML = '<p class="font-label-md text-label-md text-on-surface-variant">No visits in this period.</p>';
                return;
            }
            list.innerHTML = visits.map(v => {
                const label = esc(v.placeName || v.label || `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`);
                const when = new Date(v.startedAt).toLocaleString();
                const dur = v.endedAt == null
                    ? 'ongoing'
                    : (window.FgUnits ? window.FgUnits.formatDuration(v.durationMs) : '');
                return `<div class="p-2 rounded-lg bg-surface-container flex justify-between gap-2">
                    <div class="min-w-0">
                        <p class="font-status-number text-status-number truncate">${label}</p>
                        <p class="font-label-md text-label-md text-on-surface-variant">${esc(when)}</p>
                    </div>
                    <span class="font-status-number text-status-number whitespace-nowrap">${esc(dur)}</span>
                </div>`;
            }).join('');
        } catch (err) {
            list.innerHTML = '<p class="font-label-md text-label-md text-error">Failed: ' + esc(err.message) + '</p>';
        }
    }

    async function loadTrips() {
        const from = rangeFrom(currentRange);
        const now = Date.now();
        const list = document.getElementById('visits-trips-list');
        list.innerHTML = '<p class="font-label-md text-label-md text-on-surface-variant">Loading…</p>';
        // Clear visit pins when switching to trips tab.
        for (const v of visitMarkers) { map.removeLayer(v); }
        visitMarkers.length = 0;
        try {
            const res = await fetch(
                '/api/circles/' + state.circleId + '/members/' + state.targetUserId + '/trips?from=' + from + '&to=' + now,
                { credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const trips = data.trips || [];
            if (trips.length === 0) {
                list.innerHTML = '<p class="font-label-md text-label-md text-on-surface-variant">No trips in this period.</p>';
                return;
            }
            list.innerHTML = trips.map(t => {
                const fromLabel = esc(t.startLabel || (t.startLat != null ? `${t.startLat.toFixed(4)}, ${t.startLng.toFixed(4)}` : 'Unknown'));
                const toLabel = esc(t.endLabel || (t.endLat != null ? `${t.endLat.toFixed(4)}, ${t.endLng.toFixed(4)}` : 'Unknown'));
                const when = new Date(t.startedAt).toLocaleString();
                const parts = [];
                if (window.FgUnits) {
                    parts.push(window.FgUnits.formatDistance(t.distanceM));
                    parts.push(window.FgUnits.formatDuration(t.durationMs));
                    if (t.maxSpeedMps != null) parts.push('max ' + window.FgUnits.formatSpeed(t.maxSpeedMps));
                }
                return `<div class="p-2 rounded-lg bg-surface-container">
                    <p class="font-status-number text-status-number truncate">${fromLabel} → ${toLabel}</p>
                    <p class="font-label-md text-label-md text-on-surface-variant">${esc(when)}</p>
                    <p class="font-label-md text-label-md text-on-surface-variant">${esc(parts.join(' • '))}</p>
                </div>`;
            }).join('');
        } catch (err) {
            list.innerHTML = '<p class="font-label-md text-label-md text-error">Failed: ' + esc(err.message) + '</p>';
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

    const tabVisits = document.getElementById('tab-visits');
    const tabTrips = document.getElementById('tab-trips');
    function selectTab(name) {
        activeTab = name;
        if (name === 'visits') {
            tabVisits.className = 'px-3 py-1.5 rounded-full text-sm font-semibold bg-secondary text-on-secondary';
            tabTrips.className = 'px-3 py-1.5 rounded-full text-sm font-semibold bg-surface-container text-on-surface-variant hover:bg-surface-container-high';
            loadVisits();
        } else {
            tabTrips.className = 'px-3 py-1.5 rounded-full text-sm font-semibold bg-secondary text-on-secondary';
            tabVisits.className = 'px-3 py-1.5 rounded-full text-sm font-semibold bg-surface-container text-on-surface-variant hover:bg-surface-container-high';
            loadTrips();
        }
    }
    if (tabVisits) tabVisits.addEventListener('click', () => selectTab('visits'));
    if (tabTrips) tabTrips.addEventListener('click', () => selectTab('trips'));

    // Boot
    updateHeader();
    updateCurrentMarker();

    if (member.lat != null) {
        map.setView([member.lat, member.lng], 14);
    }

    loadHistory('24h');

    // Driving Safety Score
    let dsRange = 7;
    async function loadDrivingScore(days) {
        dsRange = days;
        const body = document.getElementById('ds-body');
        body.innerHTML = '<p class="font-label-md text-label-md text-on-surface-variant">Loading…</p>';
        try {
            const res = await fetch(
                '/api/users/' + state.targetUserId + '/driving-score?days=' + days,
                { credentials: 'same-origin' }
            );
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const d = await res.json();
            if (d.score == null) {
                body.innerHTML = '<p class="font-label-md text-label-md text-on-surface-variant">Not enough driving data.</p>';
                return;
            }
            const color = d.score >= 80 ? 'text-green-700' : d.score >= 60 ? 'text-amber-600' : 'text-red-700';
            const distStr = window.FgUnits ? window.FgUnits.formatDistance(d.distanceM) : (d.distanceM / 1000).toFixed(1) + ' km';
            const durStr = window.FgUnits ? window.FgUnits.formatDuration(d.drivingMs) : '';
            body.innerHTML =
                '<div class="flex items-center gap-4">' +
                    '<span class="font-headline-md text-headline-lg ' + color + '" style="font-size:40px;font-weight:900">' + Math.round(d.score) + '</span>' +
                    '<span class="font-label-md text-label-md text-on-surface-variant">/ 100</span>' +
                '</div>' +
                '<div class="flex flex-col gap-1 mt-2">' +
                    '<div class="flex justify-between"><span class="font-body-md text-on-surface-variant">Hard brakes</span><span class="font-status-number text-status-number">' + d.hardBrakeCount + ' (' + d.hardBrakePer100Km.toFixed(1) + ' / 100km)</span></div>' +
                    '<div class="flex justify-between"><span class="font-body-md text-on-surface-variant">Speeding</span><span class="font-status-number text-status-number">' + d.speedingMinutes.toFixed(1) + ' min</span></div>' +
                    '<div class="flex justify-between"><span class="font-body-md text-on-surface-variant">Night driving</span><span class="font-status-number text-status-number">' + (d.nightDrivingPct * 100).toFixed(0) + '%</span></div>' +
                    '<div class="flex justify-between"><span class="font-body-md text-on-surface-variant">Trips</span><span class="font-status-number text-status-number">' + d.tripCount + '</span></div>' +
                    '<div class="flex justify-between"><span class="font-body-md text-on-surface-variant">Distance</span><span class="font-status-number text-status-number">' + esc(distStr) + '</span></div>' +
                    '<div class="flex justify-between"><span class="font-body-md text-on-surface-variant">Driving time</span><span class="font-status-number text-status-number">' + esc(durStr) + '</span></div>' +
                '</div>';
        } catch (err) {
            body.innerHTML = '<p class="font-label-md text-label-md text-error">Failed: ' + esc(err.message) + '</p>';
        }
    }
    document.getElementById('ds-range').addEventListener('change', function () {
        loadDrivingScore(Number(this.value));
    });
    loadDrivingScore(7);

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
                    activity: msg.activity,
                    activityConfidence: msg.activityConfidence,
                    bearing: msg.bearing,
                    altitudeM: msg.altitudeM,
                    recordedAt: msg.recordedAt,
                    address: msg.address ?? member.address,
                });
                updateHeader();
                updateCurrentMarker();
            } else if (msg.type === 'location_address' && msg.userId === state.targetUserId) {
                member.address = msg.address;
                updateHeader();
            } else if (msg.type === 'visit_end' && msg.userId === state.targetUserId) {
                // Refresh the visits list when a new visit closes.
                if (activeTab === 'visits') loadVisits();
            } else if (msg.type === 'driving_score_updated' && msg.userId === state.targetUserId) {
                loadDrivingScore(dsRange);
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
