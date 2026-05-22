// Settings page: members list + invite management.
(function () {
    const state = window.__SETTINGS_STATE__;
    if (!state) { console.error('settings state missing'); return; }

    const $ = (id) => document.getElementById(id);
    const memberList = $('member-list');
    const memberCount = $('member-count');
    const inviteList = $('invite-list');
    const generateBtn = $('generate-btn');
    const toastHost = $('toast-host');
    const inviteSection = $('invite-section');
    const nonAdminNote = $('non-admin-note');

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(msg, kind = 'info') {
        const el = document.createElement('div');
        const bg = kind === 'success' ? '#006c49' : kind === 'error' ? '#ba1a1a' : '#0b1c30';
        el.style.cssText = `background:${bg};color:#fff;border-radius:10px;padding:10px 14px;font-family:Inter,sans-serif;font-size:14px;font-weight:500;box-shadow:0 8px 16px rgba(15,23,42,0.2);max-width:360px;`;
        el.textContent = msg;
        toastHost.appendChild(el);
        setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 3500);
    }

    function avatarInner(m) {
        const text = `<span style="position:relative;z-index:0">${esc(initials(m.displayName))}</span>`;
        if (!m.photoUrl) return text;
        return text + `<img src="${esc(m.photoUrl)}" alt="" loading="lazy" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;border-radius:9999px;object-fit:cover;z-index:1">`;
    }

    function formatPauseUntil(ms) {
        if (!ms) return '';
        const date = new Date(ms);
        const today = new Date();
        const sameDay = date.toDateString() === today.toDateString();
        const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return sameDay ? time : `${date.toLocaleDateString()} ${time}`;
    }

    function renderMembers() {
        memberCount.textContent = `${state.members.length} member${state.members.length === 1 ? '' : 's'}`;
        memberList.innerHTML = '';
        for (const m of state.members) {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3 py-3';
            const isMe = m.userId === state.me.userId;
            const pauseBadge = m.paused
                ? `<span class="text-xs bg-surface-container px-2 py-0.5 rounded-full text-on-surface-variant inline-flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">pause_circle</span>Paused until ${esc(formatPauseUntil(m.pausedUntil))}</span>`
                : '';
            row.innerHTML = `
                <div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface font-bold" style="position:relative;overflow:hidden">
                    ${avatarInner(m)}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-headline-md text-on-surface text-base">${esc(m.displayName)}</span>
                        ${isMe ? '<span class="text-xs bg-surface-container px-2 py-0.5 rounded-full text-on-surface-variant">You</span>' : ''}
                        ${m.role === 'admin' ? '<span class="text-xs bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full">Admin</span>' : ''}
                        ${pauseBadge}
                    </div>
                    <span class="text-sm text-on-surface-variant">${esc(m.email)}</span>
                </div>`;
            memberList.appendChild(row);
        }
    }

    function renderMyAvatar() {
        const me = state.members.find((m) => m.userId === state.me.userId) || state.me;
        const wrap = $('my-avatar');
        wrap.innerHTML = avatarInner(me);
        $('remove-photo').classList.toggle('hidden', !me.photoUrl);
    }

    async function uploadPhoto(file) {
        const form = new FormData();
        form.append('photo', file, file.name);
        const res = await fetch('/api/users/me/photo', {
            method: 'POST', body: form, credentials: 'same-origin',
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || ('HTTP ' + res.status));
        }
        const data = await res.json();
        // Bust the cache for the new image everywhere on the page.
        const cacheBuster = '?t=' + Date.now();
        const newUrl = data.photoUrl + cacheBuster;
        for (const m of state.members) {
            if (m.userId === state.me.userId) m.photoUrl = newUrl;
        }
        renderMembers();
        renderMyAvatar();
    }

    async function removePhoto() {
        if (!confirm('Remove your profile photo?')) return;
        const res = await fetch('/api/users/me/photo', { method: 'DELETE', credentials: 'same-origin' });
        if (!res.ok) { toast('Remove failed', 'error'); return; }
        for (const m of state.members) {
            if (m.userId === state.me.userId) m.photoUrl = null;
        }
        renderMembers();
        renderMyAvatar();
        toast('Photo removed', 'success');
    }

    function initials(name) {
        return (name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    }

    function renderInvites(invites) {
        inviteList.innerHTML = '';
        if (invites.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'py-4 text-sm text-on-surface-variant text-center';
            empty.textContent = 'No active invitations. Generate one above to add a family member.';
            inviteList.appendChild(empty);
            return;
        }
        for (const inv of invites) {
            const expiresIn = Math.max(0, Math.round((inv.expiresAt - Date.now()) / 3_600_000));
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3 py-3';
            row.innerHTML = `
                <div class="flex-1 min-w-0">
                    <div class="font-mono text-lg tracking-widest text-primary">${esc(inv.code)}</div>
                    <div class="text-xs text-on-surface-variant">Expires in ~${expiresIn} hour${expiresIn === 1 ? '' : 's'}</div>
                </div>
                <button class="copy text-on-surface-variant hover:text-primary p-2" title="Copy code"><span class="material-symbols-outlined">content_copy</span></button>
                <button class="revoke text-on-surface-variant hover:text-error p-2" title="Revoke"><span class="material-symbols-outlined">delete</span></button>`;
            row.querySelector('.copy').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(inv.code); toast('Copied!', 'success'); }
                catch { toast('Could not copy.', 'error'); }
            });
            row.querySelector('.revoke').addEventListener('click', () => revokeInvite(inv.code));
            inviteList.appendChild(row);
        }
    }

    async function loadInvites() {
        if (!state.isAdmin) return;
        try {
            const res = await fetch(`/api/circles/${state.circleId}/invites`, { credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            renderInvites(data.invites || []);
        } catch (err) {
            toast('Failed to load invites: ' + err.message, 'error');
        }
    }

    async function generateInvite() {
        try {
            generateBtn.disabled = true;
            const res = await fetch(`/api/circles/${state.circleId}/invite`, {
                method: 'POST',
                credentials: 'same-origin',
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || res.status);
            }
            const data = await res.json();
            toast(`New code: ${data.code}`, 'success');
            await loadInvites();
        } catch (err) {
            toast('Failed: ' + err.message, 'error');
        } finally {
            generateBtn.disabled = false;
        }
    }

    async function revokeInvite(code) {
        if (!confirm(`Revoke invite code ${code}?`)) return;
        try {
            const res = await fetch(`/api/invites/${code}`, { method: 'DELETE', credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            toast('Revoked.', 'success');
            await loadInvites();
        } catch (err) {
            toast('Failed: ' + err.message, 'error');
        }
    }

    function renderPauseState(pausedUntil) {
        const status = $('pause-status');
        const unpauseBtn = $('pause-unpause');
        if (pausedUntil && pausedUntil > Date.now()) {
            status.textContent = `Paused until ${formatPauseUntil(pausedUntil)}`;
            status.classList.add('text-error');
            status.classList.remove('text-on-surface-variant');
            unpauseBtn.classList.remove('hidden');
        } else {
            status.textContent = 'Sharing is on';
            status.classList.remove('text-error');
            status.classList.add('text-on-surface-variant');
            unpauseBtn.classList.add('hidden');
        }
    }

    async function fetchPause() {
        try {
            const res = await fetch('/api/users/me/pause', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();
            renderPauseState(data.pausedUntil);
        } catch { /* ignore */ }
    }

    async function setPause(minutes) {
        try {
            const res = await fetch('/api/users/me/pause', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ durationMinutes: minutes }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || ('HTTP ' + res.status));
            }
            const data = await res.json();
            renderPauseState(data.pausedUntil);
            toast(`Paused until ${formatPauseUntil(data.pausedUntil)}`, 'success');
            for (const m of state.members) {
                if (m.userId === state.me.userId) {
                    m.paused = true;
                    m.pausedUntil = data.pausedUntil;
                }
            }
            renderMembers();
        } catch (err) {
            toast('Pause failed: ' + err.message, 'error');
        }
    }

    async function unpause() {
        try {
            const res = await fetch('/api/users/me/pause', {
                method: 'DELETE', credentials: 'same-origin',
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            renderPauseState(null);
            toast('Sharing resumed', 'success');
            for (const m of state.members) {
                if (m.userId === state.me.userId) {
                    m.paused = false;
                    m.pausedUntil = null;
                }
            }
            renderMembers();
        } catch (err) {
            toast('Resume failed: ' + err.message, 'error');
        }
    }

    function minutesUntilTonight() {
        const now = new Date();
        const target = new Date(now);
        target.setHours(20, 0, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return Math.max(1, Math.min(1440, Math.round((target - now) / 60000)));
    }

    const RESOURCE_LABELS = {
        history: 'Location history',
        visits: 'Visits',
        trips: 'Trips',
        member_page: 'Profile page',
    };

    function formatViewLogTime(ms) {
        const d = new Date(ms);
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = d.toDateString() === yesterday.toDateString();
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (sameDay) return `Today at ${time}`;
        if (isYesterday) return `Yesterday at ${time}`;
        return `${d.toLocaleDateString()} ${time}`;
    }

    function renderViewLog(views) {
        const container = $('view-log-list');
        container.innerHTML = '';
        if (views.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'py-4 text-sm text-on-surface-variant text-center';
            empty.textContent = 'Nobody has viewed your data recently.';
            container.appendChild(empty);
            return;
        }
        for (const v of views) {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3 py-3';
            const avatarHtml = v.viewerPhotoUrl
                ? `<img src="${esc(v.viewerPhotoUrl)}" alt="" loading="lazy" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;border-radius:9999px;object-fit:cover;z-index:1">` +
                  `<span style="position:relative;z-index:0">${esc(initials(v.viewerName))}</span>`
                : `<span>${esc(initials(v.viewerName))}</span>`;
            row.innerHTML = `
                <div class="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface font-bold text-sm" style="position:relative;overflow:hidden">
                    ${avatarHtml}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-headline-md text-on-surface text-sm">${esc(v.viewerName)}</span>
                        <span class="text-xs bg-surface-container px-2 py-0.5 rounded-full text-on-surface-variant">${esc(RESOURCE_LABELS[v.resource] || v.resource)}</span>
                    </div>
                    <span class="text-xs text-on-surface-variant">${esc(formatViewLogTime(v.viewedAt))}</span>
                </div>`;
            container.appendChild(row);
        }
    }

    async function loadViewLog() {
        try {
            const res = await fetch('/api/users/me/view-log?days=7', { credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            renderViewLog(data.views || []);
        } catch (err) {
            const container = $('view-log-list');
            container.innerHTML = `<div class="py-4 text-sm text-error text-center">Failed to load: ${esc(err.message)}</div>`;
        }
    }

    async function exportData() {
        try {
            const res = await fetch('/api/users/me/export', { credentials: 'same-origin' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || ('HTTP ' + res.status));
            }
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            const match = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/);
            a.download = match ? match[1] : 'family-guardian-export.json';
            a.click();
            URL.revokeObjectURL(a.href);
            toast('Export downloaded', 'success');
        } catch (err) {
            toast('Export failed: ' + err.message, 'error');
        }
    }

    async function deleteAccount() {
        const password = prompt('Enter your password to confirm account deletion:');
        if (!password) return;
        if (!confirm('This permanently deletes your account and all your data. Are you sure?')) return;
        try {
            const res = await fetch('/api/users/me', {
                method: 'DELETE',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ password }),
            });
            if (res.status === 409) {
                const e = await res.json();
                if (e.error === 'requires_admin_handoff') {
                    showPromoteSection();
                    toast('You must promote another admin first.', 'error');
                    return;
                }
            }
            if (res.status === 401) {
                toast('Wrong password.', 'error');
                return;
            }
            if (!res.ok && res.status !== 204) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || ('HTTP ' + res.status));
            }
            window.location.href = '/';
        } catch (err) {
            toast('Delete failed: ' + err.message, 'error');
        }
    }

    function showPromoteSection() {
        const section = $('promote-section');
        const list = $('promote-list');
        const others = state.members.filter((m) => m.userId !== state.me.userId);
        if (others.length === 0) {
            list.innerHTML = '<p class="text-sm text-on-surface-variant">No other members to promote.</p>';
        } else {
            list.innerHTML = '';
            for (const m of others) {
                const btn = document.createElement('button');
                btn.className = 'bg-secondary-container text-on-secondary px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-secondary-container/80';
                btn.textContent = `Promote ${m.displayName}`;
                btn.addEventListener('click', async () => {
                    try {
                        const res = await fetch(`/api/circles/${state.circleId}/admins/${m.userId}`, {
                            method: 'POST',
                            credentials: 'same-origin',
                        });
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        toast(`${m.displayName} is now an admin. You can delete your account.`, 'success');
                        section.classList.add('hidden');
                    } catch (err) {
                        toast('Promote failed: ' + err.message, 'error');
                    }
                });
                list.appendChild(btn);
            }
        }
        section.classList.remove('hidden');
    }

    // Boot
    renderMembers();
    renderMyAvatar();
    fetchPause();
    loadViewLog();

    const readReceiptsToggle = $('read-receipts-toggle');
    if (readReceiptsToggle) {
        fetch('/api/users/me', { credentials: 'same-origin' })
            .then(r => r.json())
            .then(d => {
                readReceiptsToggle.checked = !!d.readReceiptsEnabled;
                const crashToggle = $('crash-detection-toggle');
                if (crashToggle) crashToggle.checked = !!d.crashDetectionEnabled;
            })
            .catch(() => {});
        readReceiptsToggle.addEventListener('change', async () => {
            try {
                await fetch('/api/users/me', {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ readReceiptsEnabled: readReceiptsToggle.checked }),
                });
                toast(readReceiptsToggle.checked ? 'Read receipts enabled' : 'Read receipts disabled', 'success');
            } catch (err) {
                toast('Failed: ' + err.message, 'error');
                readReceiptsToggle.checked = !readReceiptsToggle.checked;
            }
        });
    }

    const crashDetectionToggle = $('crash-detection-toggle');
    if (crashDetectionToggle) {
        crashDetectionToggle.addEventListener('change', async () => {
            try {
                await fetch('/api/users/me', {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ crashDetectionEnabled: crashDetectionToggle.checked }),
                });
                toast(crashDetectionToggle.checked ? 'Crash detection enabled' : 'Crash detection disabled', 'success');
            } catch (err) {
                toast('Failed: ' + err.message, 'error');
                crashDetectionToggle.checked = !crashDetectionToggle.checked;
            }
        });
    }
    $('view-log-refresh').addEventListener('click', loadViewLog);
    $('export-btn').addEventListener('click', exportData);
    $('delete-btn').addEventListener('click', deleteAccount);
    for (const btn of document.querySelectorAll('.pause-opt')) {
        btn.addEventListener('click', () => setPause(Number(btn.dataset.minutes)));
    }
    $('pause-until-tonight').addEventListener('click', () => setPause(minutesUntilTonight()));
    $('pause-unpause').addEventListener('click', unpause);
    $('photo-input').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try { await uploadPhoto(file); toast('Photo updated', 'success'); }
        catch (err) { toast('Upload failed: ' + err.message, 'error'); }
        finally { e.target.value = ''; }
    });
    $('remove-photo').addEventListener('click', removePhoto);
    if (state.isAdmin) {
        generateBtn.addEventListener('click', generateInvite);
        loadInvites();
    } else {
        inviteSection.classList.add('hidden');
        nonAdminNote.classList.remove('hidden');
    }
})();
