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

    function renderMembers() {
        memberCount.textContent = `${state.members.length} member${state.members.length === 1 ? '' : 's'}`;
        memberList.innerHTML = '';
        for (const m of state.members) {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3 py-3';
            const isMe = m.userId === state.me.userId;
            row.innerHTML = `
                <div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface font-bold" style="position:relative;overflow:hidden">
                    ${avatarInner(m)}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="font-headline-md text-on-surface text-base">${esc(m.displayName)}</span>
                        ${isMe ? '<span class="text-xs bg-surface-container px-2 py-0.5 rounded-full text-on-surface-variant">You</span>' : ''}
                        ${m.role === 'admin' ? '<span class="text-xs bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full">Admin</span>' : ''}
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

    // Boot
    renderMembers();
    renderMyAvatar();
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
