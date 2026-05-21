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

    function colorFor(place) {
        return place.alertsOnEnter || place.alertsOnExit ? '#006c49' : '#76777d';
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
                html: `<div style="background:${color};color:#fff;font-family:Inter,sans-serif;font-size:12px;font-weight:600;padding:4px 8px;border-radius:9999px;box-shadow:0 4px 12px rgba(15,23,42,0.2);white-space:nowrap;">${escapeHtml(place.name)}</div>`,
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

    function fmtTime(mins) {
        if (mins == null) return '';
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
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
                    <h3 class="font-headline-md text-[16px] text-on-surface leading-tight">${escapeHtml(p.name)}</h3>
                    <p class="font-body-md text-body-md text-on-surface-variant text-sm mt-0.5">${escapeHtml(p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`)} · ${Math.round(p.radiusM)}m</p>
                    <div class="flex gap-3 text-xs text-on-surface-variant mt-2">
                        <span>Arrival: ${p.alertsOnEnter ? '🟢 on' : '⚪ off'}</span>
                        <span>Departure: ${p.alertsOnExit ? '🟢 on' : '⚪ off'}</span>
                    </div>
                </div>
                <div class="flex gap-2">
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

            const sync = async () => {
                const onEnter = enterCb.checked;
                const onExit = exitCb.checked;
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
                    body: JSON.stringify({ placeId: p.id, memberId: m.userId, onEnter, onExit }),
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
})();
