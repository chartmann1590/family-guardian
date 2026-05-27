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
    const healthData = new Map();  // userId -> { drivingScore, staleMinutes, ... }
    let healthFetchTimer = null;
    let digestData = null;
    let digestFetchTimer = null;

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

    const upcomingArrivals = new Map((state.upcomingArrivals || []).map(a => [`${a.userId}-${a.placeId}`, a]));

    function renderUpcomingArrivals() {
        const container = document.getElementById('upcoming-arrivals');
        if (!container) return;
        const items = Array.from(upcomingArrivals.values())
            .filter(a => a.expectedAt > Date.now())
            .sort((a, b) => a.expectedAt - b.expectedAt)
            .slice(0, 5);
        if (!items.length) { container.classList.add('hidden'); return; }
        container.classList.remove('hidden');
        container.innerHTML = '<div class="text-xs text-on-surface-variant mb-1 font-medium">Coming up</div>' +
            items.map(a => {
                const inMin = Math.round((a.expectedAt - Date.now()) / 60000);
                const timeLabel = inMin > 0 ? `${inMin}m` : 'now';
                return `<div class="flex items-center gap-2 text-xs py-1">
                    <span class="font-medium">${esc(a.displayName)}</span>
                    <span class="text-on-surface-variant">${esc(a.placeName)}</span>
                    <span class="text-on-surface-variant">${formatTime(a.expectedAt)}</span>
                    <span class="text-primary font-medium">${timeLabel}</span>
                </div>`;
            }).join('');
    }

    async function refreshArrivals() {
        try {
            const res = await fetch(`/api/circles/${state.circleId}/expected-arrivals?within=240`);
            const data = await res.json();
            upcomingArrivals.clear();
            for (const a of (data.arrivals || [])) upcomingArrivals.set(`${a.userId}-${a.placeId}`, a);
            renderUpcomingArrivals();
        } catch {}
    }

    async function fetchHealth() {
        try {
            const res = await fetch(`/api/circles/${state.circleId}/health`, { credentials: 'same-origin' });
            const data = await res.json();
            healthData.clear();
            for (const m of data.members || []) healthData.set(m.userId, m);
            renderHealthStrip();
            renderMemberList();
        } catch {}
    }

    function scheduleHealthRefresh() {
        if (healthFetchTimer) return;
        healthFetchTimer = setTimeout(() => {
            healthFetchTimer = null;
            fetchHealth();
        }, 1000);
    }

    async function fetchDigest() {
        try {
            const res = await fetch(`/api/circles/${state.circleId}/digest/current`, { credentials: 'same-origin' });
            const data = await res.json();
            digestData = data.digest || null;
            renderDigestCard();
        } catch {}
    }

    function scheduleDigestRefresh() {
        if (digestFetchTimer) return;
        digestFetchTimer = setTimeout(() => {
            digestFetchTimer = null;
            fetchDigest();
        }, 1000);
    }

    function renderDigestCard() {
        const container = document.getElementById('digest-card');
        if (!container) return;
        if (!digestData) { container.classList.add('hidden'); return; }
        container.classList.remove('hidden');

        function fmtKm(km) {
            if (km == null) return '\u2014';
            if (window.FgUnits && window.FgUnits.isImperial()) {
                const mi = km * 0.621371;
                return mi < 10 ? mi.toFixed(1) + ' mi' : Math.round(mi) + ' mi';
            }
            return km < 10 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';
        }

        const totalKm = fmtKm(digestData.totalKm);
        const totalAlerts = digestData.totalAlerts ?? 0;
        const busiest = digestData.busiestPlace;

        let memberHtml = '';
        if (digestData.perMember && digestData.perMember.length) {
            memberHtml = '<div class="mt-2 flex flex-col gap-0.5">' +
                digestData.perMember.map(m => {
                    const parts = [];
                    if (m.km != null) parts.push(fmtKm(m.km));
                    if (m.alerts) parts.push(m.alerts + ' alert' + (m.alerts !== 1 ? 's' : ''));
                    const detail = parts.length ? '<span class="text-on-surface-variant ml-1">' + parts.join(' \u00b7 ') + '</span>' : '';
                    return '<div class="text-xs flex items-center gap-1"><span class="font-medium">' + escapeHtml(m.displayName || '?') + '</span>' + detail + '</div>';
                }).join('') +
                '</div>';
        }

        container.innerHTML =
            '<div class="px-4 py-2.5 flex items-center justify-between cursor-pointer select-none" id="digest-toggle-header">' +
                '<div class="flex items-center gap-2">' +
                    '<span class="material-symbols-outlined text-secondary" style="font-size:18px">summarize</span>' +
                    '<span class="font-label-md text-label-md text-on-surface font-bold">This week</span>' +
                '</div>' +
                '<span class="material-symbols-outlined text-on-surface-variant transition-transform" style="font-size:18px" id="digest-chevron">expand_less</span>' +
            '</div>' +
            '<div id="digest-body" class="px-4 pb-3">' +
                '<div class="flex gap-4 text-xs">' +
                    '<div class="flex items-center gap-1">' +
                        '<span class="material-symbols-outlined text-on-surface-variant" style="font-size:14px">straighten</span>' +
                        '<span class="font-bold text-on-surface">' + escapeHtml(totalKm) + '</span>' +
                    '</div>' +
                    '<div class="flex items-center gap-1">' +
                        '<span class="material-symbols-outlined text-on-surface-variant" style="font-size:14px">notifications_active</span>' +
                        '<span class="font-bold text-on-surface">' + totalAlerts + '</span>' +
                    '</div>' +
                '</div>' +
                (busiest ? '<div class="flex items-center gap-1 text-xs mt-1"><span class="material-symbols-outlined text-secondary" style="font-size:14px">place</span><span class="font-medium">' + escapeHtml(busiest) + '</span></div>' : '') +
                memberHtml +
            '</div>';

        document.getElementById('digest-toggle-header').addEventListener('click', () => {
            const body = document.getElementById('digest-body');
            const chevron = document.getElementById('digest-chevron');
            const hidden = !body.classList.contains('hidden');
            body.classList.toggle('hidden', hidden);
            chevron.textContent = hidden ? 'expand_more' : 'expand_less';
        });
    }

    function renderHealthStrip() {
        const strip = document.getElementById('health-strip');
        if (!strip) return;
        const items = Array.from(healthData.values());
        if (!items.length) { strip.classList.add('hidden'); return; }
        strip.classList.remove('hidden');

        const sorted = items.sort((a, b) => {
            if (a.userId === state.me.userId) return -1;
            if (b.userId === state.me.userId) return 1;
            return (a.displayName || '').localeCompare(b.displayName || '');
        });

        strip.innerHTML = sorted.map(m => {
            const paused = m.paused;
            let dotColor = '#76777d';
            if (paused) dotColor = '#76777d';
            else if (m.staleMinutes != null && m.staleMinutes < 5) dotColor = '#006c49';
            else if (m.staleMinutes != null && m.staleMinutes < 30) dotColor = '#943700';
            else if (m.staleMinutes != null) dotColor = '#ba1a1a';

            const battery = m.batteryPct != null
                ? `<span class="material-symbols-outlined" style="font-size:12px;color:${batteryColor(m.batteryPct).fg}">battery_full</span>`
                : '';
            const scoreChip = m.drivingScore != null
                ? `<span style="font-size:10px;font-weight:700;color:${m.drivingScore >= 80 ? '#006c49' : m.drivingScore >= 60 ? '#943700' : '#ba1a1a'};background:${m.drivingScore >= 80 ? '#6cf8bb33' : m.drivingScore >= 60 ? '#ffdbcd33' : '#ffdad633'};border-radius:9999px;padding:0 4px;line-height:16px">${m.drivingScore}</span>`
                : '';
            const pauseBadge = paused
                ? `<span style="font-size:10px;color:#943700">⏸</span>`
                : '';

            return `<a href="/member/${m.userId}" class="flex flex-col items-center gap-1 px-2 py-2 rounded-xl bg-surface/90 backdrop-blur-sm border border-outline-variant/20 shadow-sm hover:bg-surface-container-high min-w-[64px]" style="text-decoration:none;color:inherit">
                <div class="relative">
                    <div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center font-bold text-on-surface text-xs" style="position:relative;overflow:hidden">${avatarInner(m)}</div>
                    <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface" style="background:${dotColor};z-index:2"></div>
                </div>
                <span class="font-label-md text-label-md text-on-surface truncate max-w-[56px] text-center">${escapeHtml(m.displayName || '?')}</span>
                <div class="flex items-center gap-0.5">${battery}${scoreChip}${pauseBadge}</div>
            </a>`;
        }).join('');
    }

    function formatTime(epochMs) {
        return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
                        ${(() => {
                            const h = healthData.get(m.userId);
                            if (h?.drivingScore == null) return '';
                            const sc = h.drivingScore;
                            const color = sc >= 80 ? '#006c49' : sc >= 60 ? '#943700' : '#ba1a1a';
                            const bg = sc >= 80 ? '#6cf8bb33' : sc >= 60 ? '#ffdbcd33' : '#ffdad633';
                            return `<span style="font-size:10px;font-weight:700;color:${color};background:${bg};border-radius:9999px;padding:0 4px;line-height:16px;margin-left:4px">${sc}</span>`;
                        })()}
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

    const PLACE_KIND_COLORS = {
        home: '#006c49', school: '#1a73e8', work: '#5f6368', medical: '#ba1a1a',
        social: '#e91e63', gym: '#ff6d00', shopping: '#7b1fa2', transit: '#00bcd4',
        other: '#006c49',
    };

    function drawPlace(p) {
        const c = PLACE_KIND_COLORS[p.kind] || PLACE_KIND_COLORS.other;
        const existing = placeLayers.get(p.id);
        if (existing) {
            existing.setLatLng([p.lat, p.lng]);
            existing.setRadius(p.radiusM);
            existing.setStyle({ color: c, fillColor: c });
            return;
        }
        const layer = L.circle([p.lat, p.lng], {
            radius: p.radiusM,
            color: c,
            weight: 2,
            opacity: 0.8,
            dashArray: '6 6',
            fillColor: c,
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

    const shareLiveBtn = document.getElementById('share-live-btn');
    if (shareLiveBtn) {
        shareLiveBtn.addEventListener('click', async () => {
            shareLiveBtn.disabled = true;
            try {
                const res = await fetch('/api/users/me/trip-shares', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ durationMinutes: 60 }),
                });
                if (!res.ok) {
                    const e = await res.json().catch(() => ({}));
                    alert('Failed to share live: ' + (e.error || res.status));
                    return;
                }
                const data = await res.json();
                if (data.url) {
                    await navigator.clipboard.writeText(data.url);
                    toast('Link copied!');
                }
            } catch (err) {
                alert('Failed to share live: ' + err.message);
            } finally { shareLiveBtn.disabled = false; }
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
                scheduleHealthRefresh();
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
                scheduleHealthRefresh();
                if (msg.type === 'sos_active') {
                    toast(`🚨 ${msg.displayName} triggered SOS${msg.source === 'crash' ? ' (crash detected)' : ''}`, 'exit');
                } else {
                    toast(`SOS resolved for ${msg.displayName}`, 'enter');
                }
            } else if (msg.type === 'crash_pending') {
                const banner = document.getElementById('crash-banner');
                if (banner) {
                    banner.textContent = `Possible crash detected for ${msg.displayName || 'a member'} — waiting for confirmation…`;
                    banner.style.display = 'block';
                    setTimeout(() => { banner.style.display = 'none'; }, 35000);
                }
            } else if (msg.type === 'check_in') {
                checkins.set(msg.userId, { status: msg.status, createdAt: msg.createdAt, photoUrl: msg.photoUrl || null });
                renderMemberList();
                scheduleHealthRefresh();
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
                    scheduleHealthRefresh();
                }
                if (msg.type === 'routine_deviation') {
                    const m = members.get(msg.userId);
                    const name = msg.displayName || (m ? m.displayName : 'A member');
                    const kindLabel = msg.kind === 'missed_arrival' ? "didn't arrive at" : msg.kind === 'overstay' ? 'stayed too long at' : 'deviated from';
                    toast(`${name} ${kindLabel} ${msg.placeName || 'a place'}`, 'exit');
                }
            } else if (msg.type === 'digest_ready') {
                scheduleDigestRefresh();
            } else if (msg.type === 'eta_updated') {
                const m = members.get(msg.userId);
                const name = msg.displayName || (m ? m.displayName : 'A member');
                const etaMin = msg.etaMinutes != null ? msg.etaMinutes + ' min' : 'soon';
                toast(`${name} · ETA ${etaMin} to ${msg.placeName || 'a place'}`);
            } else if (msg.type === 'arrived_safely') {
                const m = members.get(msg.userId);
                const name = msg.displayName || (m ? m.displayName : 'A member');
                toast(`${name} arrived safely at ${msg.placeName || 'a place'}`, 'enter');
            } else if (msg.type === 'break_suggested') {
                const m = members.get(msg.userId);
                const name = msg.displayName || (m ? m.displayName : 'A member');
                const dur = msg.driveMinutes ? `${Math.round(msg.driveMinutes / 60)}hr+` : 'a while';
                toast(`${name}, you've been driving ${dur}. Time for a break?`);
            } else if (msg.type === 'routine_deviation_bundle') {
                toast('Multiple routine alerts');
            } else if (msg.type === 'driving_score_updated') {
                scheduleHealthRefresh();
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
    setInterval(refreshArrivals, 300_000);

    refreshArrivals();
    fetchHealth();
    fetchDigest();

    // Map needs an invalidateSize when the sidebar layout settles
    window.addEventListener('resize', () => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 100);
})();
