// Safety Places page: Leaflet map, click to position a new geofence,
// inline create/edit/delete via the JSON API.

(function () {
    const state = window.__PLACES_STATE__;
    if (!state) { console.error('places state missing'); return; }

    const map = L.map('map', { zoomControl: true }).setView([37.7749, -122.4194], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const layers = new Map();   // id -> { circle, marker }
    const draftLayer = { circle: null, marker: null };
    let placingMode = false;
    let editingId = null;
    const subs = new Map();     // key "placeId-memberId" -> sub object

    const $ = (id) => document.getElementById(id);
    const form = $('edit-form');
    const hint = $('hint');
    const list = $('place-list');

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDuration(ms) {
        if (!ms || ms <= 0) return '0m';
        const mins = Math.floor(ms / 60000);
        const hrs = Math.floor(mins / 60);
        const m = mins % 60;
        if (hrs > 0) return `${hrs}h ${m}m`;
        return `${m}m`;
    }

    async function loadAnalytics(placeId, days) {
        const panel = document.querySelector(`[data-analytics-panel="${placeId}"]`);
        if (!panel) return;
        panel.innerHTML = '<div class="text-sm text-on-surface-variant py-2">Loading\u2026</div>';
        try {
            const res = await fetch(`/api/places/${placeId}/analytics?days=${days}`, { credentials: 'same-origin' });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            renderAnalytics(panel, data, days);
        } catch {
            panel.innerHTML = '<div class="text-sm text-error py-2">Failed to load analytics.</div>';
        }
    }

    function renderAnalytics(panel, data, currentDays) {
        const maxVisits = Math.max(1, ...data.perMember.map((m) => m.visitCount));

        let html = '<div class="flex gap-1 mb-3">';
        for (const d of [7, 30, 90]) {
            const active = d === currentDays;
            html += `<button class="analytics-days px-3 py-1 rounded text-xs font-semibold ${active ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}" data-days="${d}">${d}d</button>`;
        }
        html += '</div>';

        if (data.weekOverWeek) {
            const wow = data.weekOverWeek;
            const up = wow.deltaPct >= 0;
            const arrow = up ? 'trending_up' : 'trending_down';
            const color = up ? 'text-secondary' : 'text-error';
            html += `
                <div class="flex items-center gap-2 text-sm mb-3 px-3 py-2 rounded-lg bg-surface-container-low">
                    <span class="material-symbols-outlined text-base ${color}">${arrow}</span>
                    <span class="${color} font-semibold">${Math.abs(wow.deltaPct).toFixed(1)}%</span>
                    <span class="text-on-surface-variant">week over week (${wow.lastWeekCount} vs ${wow.prevWeekCount} visits)</span>
                </div>`;
        }

        if (data.perMember.length === 0) {
            html += '<div class="text-sm text-on-surface-variant py-2">No visits in this period.</div>';
        } else {
            html += '<div class="flex flex-col gap-3">';
            for (const m of data.perMember) {
                const barWidth = Math.round((m.visitCount / maxVisits) * 100);
                html += `
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-primary text-xs font-bold shrink-0">${escapeHtml(m.displayName.charAt(0).toUpperCase())}</div>
                        <div class="flex-1 min-w-0">
                            <div class="flex justify-between text-sm">
                                <span class="font-medium text-on-surface truncate">${escapeHtml(m.displayName)}</span>
                                <span class="text-on-surface-variant shrink-0 ml-2">${m.visitCount} visits</span>
                            </div>
                            <div class="w-full bg-surface-container rounded-full h-1.5 mt-1">
                                <div class="bg-secondary h-1.5 rounded-full" style="width:${barWidth}%"></div>
                            </div>
                            <div class="flex gap-3 text-xs text-on-surface-variant mt-1">
                                <span>Avg: ${formatDuration(m.avgDwellMs)}</span>
                                <span>Longest: ${formatDuration(m.longestDwellMs)}</span>
                            </div>
                        </div>
                    </div>`;
            }
            html += '</div>';
        }

        panel.innerHTML = html;
        panel.querySelectorAll('.analytics-days').forEach((btn) => {
            btn.addEventListener('click', () => {
                loadAnalytics(data.placeId, parseInt(btn.dataset.days));
            });
        });
    }

    const KIND_EMOJI = { home: '🏠', school: '🏫', work: '🏢', medical: '🏥', social: '☕', gym: '🏋️', shopping: '🛒', transit: '🚌', other: '📍' };
    const KIND_COLORS = { home: '#006c49', school: '#1a73e8', work: '#5f6368', medical: '#ba1a1a', social: '#e91e63', gym: '#ff6d00', shopping: '#7b1fa2', transit: '#00bcd4', other: '#76777d' };

    function kindEmoji(kind) {
        return KIND_EMOJI[kind] || KIND_EMOJI.other;
    }

    function colorFor(place) {
        return KIND_COLORS[place.kind] || KIND_COLORS.other;
    }

    function drawPlace(place) {
        clearPlace(place.id);
        const color = colorFor(place);
        const circle = L.circle([place.lat, place.lng], {
            radius: place.radiusM,
            color, weight: 2, opacity: 0.9, dashArray: '6 6',
            fillColor: color, fillOpacity: 0.1,
        }).addTo(map);
        const marker = L.marker([place.lat, place.lng], {
            icon: L.divIcon({
                className: 'fg-place-marker',
                html: `<div style="background:${color};color:#fff;font-family:Inter,sans-serif;font-size:12px;font-weight:600;padding:4px 8px;border-radius:9999px;box-shadow:0 4px 12px rgba(15,23,42,0.2);white-space:nowrap;">${kindEmoji(place.kind)} ${escapeHtml(place.name)}</div>`,
                iconSize: null,
                iconAnchor: [0, 0],
            }),
        }).addTo(map);
        layers.set(place.id, { circle, marker });
    }

    function clearPlace(id) {
        const layer = layers.get(id);
        if (!layer) return;
        map.removeLayer(layer.circle);
        map.removeLayer(layer.marker);
        layers.delete(id);
    }

    function clearDraft() {
        if (draftLayer.circle) { map.removeLayer(draftLayer.circle); draftLayer.circle = null; }
        if (draftLayer.marker) { map.removeLayer(draftLayer.marker); draftLayer.marker = null; }
    }

    function showDraft(lat, lng, radiusM) {
        clearDraft();
        draftLayer.circle = L.circle([lat, lng], {
            radius: radiusM,
            color: '#004ac6', weight: 2, opacity: 0.9,
            fillColor: '#004ac6', fillOpacity: 0.1,
        }).addTo(map);
        draftLayer.marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        draftLayer.marker.on('drag', (e) => {
            const { lat: la, lng: ln } = e.target.getLatLng();
            $('edit-lat').value = la.toFixed(6);
            $('edit-lng').value = ln.toFixed(6);
            draftLayer.circle.setLatLng([la, ln]);
        });
    }

    function subKey(placeId, memberId) {
        return `${placeId}-${memberId ?? 'any'}`;
    }

    function placeCard(p) {
        const li = document.createElement('div');
        li.className = 'flex flex-col';
        li.dataset.placeId = p.id;

        const card = document.createElement('div');
        card.className = 'p-5 flex flex-col gap-3 hover:bg-surface-container-lowest';
        card.innerHTML = `
            <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                    <span class="material-symbols-outlined">distance</span>
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="font-headline-md text-[16px] text-on-surface leading-tight">${kindEmoji(p.kind)} ${escapeHtml(p.name)}</h3>
                    <p class="font-body-md text-body-md text-on-surface-variant text-sm mt-0.5">${escapeHtml(p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`)} · ${Math.round(p.radiusM)}m</p>
                    <div class="flex gap-3 text-xs text-on-surface-variant mt-2">
                        <span>Arrival: ${p.alertsOnEnter ? '🟢 on' : '⚪ off'}</span>
                        <span>Departure: ${p.alertsOnExit ? '🟢 on' : '⚪ off'}</span>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button class="analytics-toggle text-on-surface-variant hover:text-secondary" title="Analytics"><span class="material-symbols-outlined">analytics</span></button>
                    <button class="notify-toggle text-on-surface-variant hover:text-secondary" title="Notifications"><span class="material-symbols-outlined">notifications</span></button>
                    <button class="edit text-on-surface-variant hover:text-primary" title="Edit"><span class="material-symbols-outlined">edit</span></button>
                    <button class="del text-on-surface-variant hover:text-error" title="Delete"><span class="material-symbols-outlined">delete</span></button>
                </div>
            </div>`;
        card.querySelector('.edit').addEventListener('click', () => startEdit(p));
        card.querySelector('.del').addEventListener('click', () => deletePlace(p.id));
        card.addEventListener('click', (ev) => {
            if (ev.target.closest('button')) return;
            map.flyTo([p.lat, p.lng], 16);
        });
        li.appendChild(card);

        const notifyPanel = document.createElement('div');
        notifyPanel.className = 'hidden border-t border-outline-variant/20 bg-surface-container-lowest px-5 py-4 flex flex-col gap-3';
        notifyPanel.dataset.subPanel = p.id;

        const members = state.members || [];
        const allMembers = [{ userId: null, displayName: 'Anyone' }, ...members];

        for (const m of allMembers) {
            const k = subKey(p.id, m.userId);
            const s = subs.get(k);
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3 text-sm';
            row.innerHTML = `
                <span class="flex-1 text-on-surface font-medium">${escapeHtml(m.displayName)}</span>
                <label class="flex items-center gap-1 text-xs text-on-surface-variant cursor-pointer">
                    <input type="checkbox" class="sub-enter" ${s?.onEnter ? 'checked' : ''} /> Arrives
                </label>
                <label class="flex items-center gap-1 text-xs text-on-surface-variant cursor-pointer">
                    <input type="checkbox" class="sub-exit" ${s?.onExit ? 'checked' : ''} /> Leaves
                </label>`;
            const enterCb = row.querySelector('.sub-enter');
            const exitCb = row.querySelector('.sub-exit');

            const scheduleRow = document.createElement('div');
            scheduleRow.className = 'flex flex-wrap items-center gap-2 text-xs text-on-surface-variant ml-0 mt-1';
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const dayBits = [1, 2, 4, 8, 16, 32, 64];
            const savedDays = s?.daysOfWeek ?? 127;
            for (let i = 0; i < days.length; i++) {
                const checked = (savedDays & dayBits[i]) !== 0 ? 'checked' : '';
                scheduleRow.innerHTML += `<label class="flex items-center gap-0.5 cursor-pointer px-1.5 py-0.5 rounded ${checked ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'} day-chip" data-bit="${dayBits[i]}"><input type="checkbox" class="day-cb sr-only" ${checked} />${days[i]}</label>`;
            }
            scheduleRow.innerHTML += `
                <input type="time" class="win-start border border-outline-variant/30 rounded px-1 py-0.5 text-xs bg-transparent" value="${s?.windowStart ?? ''}" placeholder="Start" />
                <span>–</span>
                <input type="time" class="win-end border border-outline-variant/30 rounded px-1 py-0.5 text-xs bg-transparent" value="${s?.windowEnd ?? ''}" placeholder="End" />`;
            row.appendChild(scheduleRow);

            scheduleRow.querySelectorAll('.day-cb').forEach((cb) => {
                cb.addEventListener('change', () => {
                    const label = cb.closest('.day-chip');
                    if (cb.checked) {
                        label.classList.add('bg-primary/10', 'text-primary');
                        label.classList.remove('bg-surface-container', 'text-on-surface-variant');
                    } else {
                        label.classList.remove('bg-primary/10', 'text-primary');
                        label.classList.add('bg-surface-container', 'text-on-surface-variant');
                    }
                });
            });

            const sync = async () => {
                const onEnter = enterCb.checked;
                const onExit = exitCb.checked;
                let daysOfWeek = 0;
                scheduleRow.querySelectorAll('.day-cb:checked').forEach((cb) => {
                    daysOfWeek |= parseInt(cb.closest('.day-chip').dataset.bit);
                });
                const windowStart = scheduleRow.querySelector('.win-start').value || undefined;
                const windowEnd = scheduleRow.querySelector('.win-end').value || undefined;
                if (!onEnter && !onExit) {
                    if (subs.has(k)) {
                        await fetch(`/api/place-subscriptions/${subs.get(k).id}`, { method: 'DELETE', credentials: 'same-origin' });
                        subs.delete(k);
                    }
                    return;
                }
                const res = await fetch(`/api/circles/${state.circleId}/place-subscriptions`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ placeId: p.id, memberId: m.userId, onEnter, onExit, daysOfWeek, windowStart, windowEnd }),
                });
                if (res.ok) {
                    const data = await res.json();
                    subs.set(k, data);
                }
            };
            enterCb.addEventListener('change', sync);
            exitCb.addEventListener('change', sync);
            notifyPanel.appendChild(row);
        }

        card.querySelector('.notify-toggle').addEventListener('click', (ev) => {
            ev.stopPropagation();
            notifyPanel.classList.toggle('hidden');
        });
        li.appendChild(notifyPanel);

        const analyticsPanel = document.createElement('div');
        analyticsPanel.className = 'hidden border-t border-outline-variant/20 bg-surface-container-lowest px-5 py-4';
        analyticsPanel.dataset.analyticsPanel = p.id;

        card.querySelector('.analytics-toggle').addEventListener('click', (ev) => {
            ev.stopPropagation();
            const opening = analyticsPanel.classList.contains('hidden');
            analyticsPanel.classList.toggle('hidden');
            if (opening && !analyticsPanel.dataset.loaded) {
                analyticsPanel.dataset.loaded = '1';
                loadAnalytics(p.id, 30);
            }
        });
        li.appendChild(analyticsPanel);

        return li;
    }

    function renderList() {
        list.innerHTML = '';
        if (state.places.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'p-6 text-center text-on-surface-variant text-sm';
            empty.textContent = 'No safety places yet. Click "Add New Place" above.';
            list.appendChild(empty);
            return;
        }
        for (const p of state.places) list.appendChild(placeCard(p));
    }

    function startAdd() {
        editingId = null;
        placingMode = true;
        hint.classList.remove('hidden');
        form.classList.remove('hidden');
        $('edit-id').value = '';
        $('edit-name').value = '';
        $('edit-address').value = '';
        $('edit-radius').value = '150';
        $('edit-enter').checked = true;
        $('edit-exit').checked = true;
        $('edit-kind').value = 'other';
        const center = map.getCenter();
        $('edit-lat').value = center.lat.toFixed(6);
        $('edit-lng').value = center.lng.toFixed(6);
        showDraft(center.lat, center.lng, 150);
    }

    function startEdit(p) {
        editingId = p.id;
        placingMode = true;
        hint.classList.add('hidden');
        form.classList.remove('hidden');
        $('edit-id').value = p.id;
        $('edit-name').value = p.name;
        $('edit-address').value = p.address || '';
        $('edit-lat').value = p.lat.toFixed(6);
        $('edit-lng').value = p.lng.toFixed(6);
        $('edit-radius').value = p.radiusM;
        $('edit-enter').checked = !!p.alertsOnEnter;
        $('edit-exit').checked = !!p.alertsOnExit;
        $('edit-kind').value = p.kind || 'other';
        showDraft(p.lat, p.lng, p.radiusM);
    }

    function endEdit() {
        editingId = null;
        placingMode = false;
        hint.classList.add('hidden');
        form.classList.add('hidden');
        clearDraft();
    }

    async function deletePlace(id) {
        if (!confirm('Delete this place?')) return;
        const res = await fetch(`/api/places/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        if (!res.ok) return alert('Delete failed: ' + res.status);
        state.places = state.places.filter((p) => p.id !== id);
        clearPlace(id);
        renderList();
    }

    async function submitForm(e) {
        e.preventDefault();
        const body = {
            name: $('edit-name').value.trim(),
            address: $('edit-address').value.trim() || undefined,
            lat: parseFloat($('edit-lat').value),
            lng: parseFloat($('edit-lng').value),
            radiusM: parseFloat($('edit-radius').value),
            alertsOnEnter: $('edit-enter').checked,
            alertsOnExit: $('edit-exit').checked,
            kind: $('edit-kind').value || 'other',
        };
        const id = $('edit-id').value;
        const url = id ? `/api/places/${id}` : `/api/circles/${state.circleId}/places`;
        const method = id ? 'PATCH' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            $('edit-error').classList.remove('hidden');
            $('edit-error').textContent = 'Save failed: ' + (data.error || res.status);
            return;
        }
        const saved = await res.json();
        const idx = state.places.findIndex((p) => p.id === saved.id);
        if (idx >= 0) state.places[idx] = saved; else state.places.push(saved);
        state.places.sort((a, b) => a.name.localeCompare(b.name));
        drawPlace(saved);
        renderList();
        endEdit();
    }

    $('add-btn').addEventListener('click', startAdd);
    $('edit-cancel').addEventListener('click', endEdit);
    form.addEventListener('submit', submitForm);

    map.on('click', (e) => {
        if (!placingMode) return;
        const { lat, lng } = e.latlng;
        $('edit-lat').value = lat.toFixed(6);
        $('edit-lng').value = lng.toFixed(6);
        const r = parseFloat($('edit-radius').value) || 150;
        showDraft(lat, lng, r);
    });

    $('edit-radius').addEventListener('input', () => {
        if (!draftLayer.circle) return;
        const r = parseFloat($('edit-radius').value);
        if (Number.isFinite(r) && r > 0) draftLayer.circle.setRadius(r);
    });

    // Boot
    for (const p of state.places) drawPlace(p);
    if (state.places.length > 0) {
        const bounds = L.latLngBounds(state.places.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
    renderList();
    setTimeout(() => map.invalidateSize(), 100);

    (async () => {
        try {
            const res = await fetch(`/api/circles/${state.circleId}/place-subscriptions`, { credentials: 'same-origin' });
            if (res.ok) {
                const data = await res.json();
                for (const s of (data.subscriptions || [])) {
                    subs.set(subKey(s.placeId, s.memberId), s);
                }
                renderList();
            }
        } catch {}
    })();

    (async () => {
        try {
            const res = await fetch('/api/users/me/place-suggestions', { credentials: 'same-origin' });
            if (!res.ok) return;
            const suggestions = await res.json();
            if (!suggestions || suggestions.length === 0) return;

            const banner = document.createElement('div');
            banner.className = 'mb-3 flex flex-col gap-2';
            banner.dataset.suggestionsBanner = '';

            for (const sug of suggestions) {
                const card = document.createElement('div');
                card.className = 'flex items-center gap-3 p-3 rounded-lg bg-yellow-50 border border-yellow-300';
                card.innerHTML = `
                    <span class="material-symbols-outlined text-yellow-600">lightbulb</span>
                    <div class="flex-1 min-w-0">
                        <span class="font-medium text-yellow-900 text-sm">${escapeHtml(sug.name || sug.address || 'Suggested place')}</span>
                        <span class="text-yellow-700 text-xs ml-2">${escapeHtml(sug.address || '')}</span>
                    </div>
                    <input type="text" class="sug-name border border-yellow-300 rounded px-2 py-1 text-xs bg-white" placeholder="Name" value="${escapeHtml(sug.name || '')}" />
                    <select class="sug-kind border border-yellow-300 rounded px-2 py-1 text-xs bg-white">
                        ${Object.keys(KIND_EMOJI).map((k) => `<option value="${k}" ${k === 'other' ? 'selected' : ''}>${KIND_EMOJI[k]} ${k}</option>`).join('')}
                    </select>
                    <input type="number" class="sug-radius border border-yellow-300 rounded px-2 py-1 text-xs bg-white w-20" placeholder="Radius (m)" value="150" min="10" />
                    <button class="sug-save px-3 py-1 rounded text-xs font-semibold bg-yellow-600 text-white hover:bg-yellow-700">Save as place</button>
                    <button class="sug-dismiss px-3 py-1 rounded text-xs font-semibold bg-yellow-200 text-yellow-800 hover:bg-yellow-300">Dismiss</button>`;

                card.querySelector('.sug-save').addEventListener('click', async () => {
                    const name = card.querySelector('.sug-name').value.trim();
                    const kind = card.querySelector('.sug-kind').value;
                    const radiusM = parseFloat(card.querySelector('.sug-radius').value) || 150;
                    const acceptRes = await fetch(`/api/place-suggestions/${sug.id}/accept`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ name, kind, radiusM }),
                    });
                    if (acceptRes.ok) {
                        const place = await acceptRes.json();
                        state.places.push(place);
                        state.places.sort((a, b) => a.name.localeCompare(b.name));
                        drawPlace(place);
                        renderList();
                        card.remove();
                        if (banner.children.length === 0) banner.remove();
                    }
                });

                card.querySelector('.sug-dismiss').addEventListener('click', async () => {
                    await fetch(`/api/place-suggestions/${sug.id}/dismiss`, {
                        method: 'POST',
                        credentials: 'same-origin',
                    });
                    card.remove();
                    if (banner.children.length === 0) banner.remove();
                });

                banner.appendChild(card);
            }

            list.parentElement.insertBefore(banner, list);
        } catch {}
    })();
})();
