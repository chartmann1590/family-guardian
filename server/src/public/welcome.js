// Welcome / onboarding wizard. Three steps:
//   1. Display name + optional photo (PATCH /api/users/me, POST /api/users/me/photo)
//   2. Generate first invite code (admins only) or just info
//   3. Confirmation → /dashboard
// Backed by the existing API; doesn't persist a separate "onboarded" flag.
// Reachable any time by going to /welcome.

(function () {
    const state = window.__WELCOME_STATE__;
    if (!state) { console.error('welcome state missing'); return; }

    const $ = (id) => document.getElementById(id);

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showAlert(msg) {
        const a = $('alert');
        a.textContent = msg;
        a.classList.remove('hidden');
    }
    function clearAlert() { $('alert').classList.add('hidden'); }

    const stepLabel = $('step-label');
    const dots = [$('dot-1'), $('dot-2'), $('dot-3')];
    const sections = { profile: $('step-profile'), invite: $('step-invite'), done: $('step-done') };
    const order = ['profile', 'invite', 'done'];
    const labels = ['Step 1 of 3 · Your profile', 'Step 2 of 3 · Invite family', 'Step 3 of 3 · Done'];

    function goto(stepKey) {
        const idx = order.indexOf(stepKey);
        for (const k of order) sections[k].classList.toggle('hidden', k !== stepKey);
        dots.forEach((d, i) => {
            d.classList.toggle('bg-primary', i <= idx);
            d.classList.toggle('bg-surface-container-high', i > idx);
        });
        stepLabel.textContent = labels[idx];
        clearAlert();
        if (stepKey === 'done') $('skip-link').classList.add('hidden');
    }

    // --- Step 1: profile (display name + optional photo)
    $('display-name').value = state.me.displayName || '';
    if (state.me.photoUrl) {
        $('avatar-img').src = state.me.photoUrl + (state.me.photoUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
        $('avatar-img').classList.remove('hidden');
        $('avatar-placeholder').classList.add('hidden');
    }

    $('photo-input').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const form = new FormData();
        form.append('photo', file, file.name);
        try {
            const res = await fetch('/api/users/me/photo', { method: 'POST', body: form, credentials: 'same-origin' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || ('HTTP ' + res.status));
            }
            const data = await res.json();
            state.me.photoUrl = data.photoUrl;
            $('avatar-img').src = data.photoUrl + '?t=' + Date.now();
            $('avatar-img').classList.remove('hidden');
            $('avatar-placeholder').classList.add('hidden');
        } catch (err) {
            showAlert('Photo upload failed: ' + err.message);
        } finally {
            e.target.value = '';
        }
    });

    $('step-profile-next').addEventListener('click', async () => {
        const name = $('display-name').value.trim();
        if (!name) { showAlert('Display name is required.'); return; }
        try {
            const res = await fetch('/api/users/me', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ displayName: name }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || ('HTTP ' + res.status));
            }
            state.me.displayName = name;
        } catch (err) {
            showAlert('Could not save: ' + err.message);
            return;
        }
        // Non-admins skip the invite step entirely.
        if (state.me.isAdmin) goto('invite');
        else goto('done');
    });

    // --- Step 2: invite
    if (!state.me.isAdmin) {
        $('invite-headline').textContent = 'You’re joining ' + (state.circleName || 'this circle');
        $('invite-body').textContent = 'Your family admin will see your location appear on their dashboard as soon as the Android app reports your first fix.';
        $('invite-admin').classList.add('hidden');
    } else {
        $('invite-admin').classList.remove('hidden');
    }

    $('generate-invite').addEventListener('click', async () => {
        const btn = $('generate-invite');
        btn.disabled = true;
        try {
            const res = await fetch('/api/circles/' + state.circleId + '/invite', {
                method: 'POST', credentials: 'same-origin',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || ('HTTP ' + res.status));
            }
            const data = await res.json();
            $('invite-code').textContent = data.code;
            const hrs = Math.max(1, Math.round((data.expiresAt - Date.now()) / 3_600_000));
            $('invite-expires').textContent = 'Expires in ~' + hrs + ' hour' + (hrs === 1 ? '' : 's');
            $('invite-result').classList.remove('hidden');
        } catch (err) {
            showAlert('Could not generate code: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });

    $('invite-copy').addEventListener('click', async () => {
        const code = $('invite-code').textContent;
        if (!code) return;
        try { await navigator.clipboard.writeText(code); } catch {}
    });

    $('step-invite-next').addEventListener('click', () => goto('done'));

    // --- Boot
    goto('profile');
})();
