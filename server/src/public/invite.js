// Dashboard: invite modal (code + link + QR) and Android install modal.

(function () {
    const $ = (id) => document.getElementById(id);
    const state = window.__GUARDIAN_STATE__;
    if (!state) return;

    const inviteModal = $('invite-modal');
    const installModal = $('install-modal');

    function open(el) { el.classList.remove('hidden'); }
    function close(el) { el.classList.add('hidden'); }

    document.querySelectorAll('.invite-close').forEach(b => b.addEventListener('click', () => close(inviteModal)));
    document.querySelectorAll('.install-close').forEach(b => b.addEventListener('click', () => close(installModal)));
    [inviteModal, installModal].forEach(m => m.addEventListener('click', (e) => { if (e.target === m) close(m); }));

    // --- Invite ---

    async function mintInvite() {
        const loading = $('invite-loading');
        const content = $('invite-content');
        const errBox = $('invite-error');
        loading.classList.remove('hidden');
        content.classList.add('hidden');
        errBox.classList.add('hidden');
        try {
            const res = await fetch(`/api/circles/${state.circleId}/invite`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            const j = await res.json();
            $('invite-link').value = j.joinUrl;
            $('invite-code').textContent = j.code;
            $('invite-qr').innerHTML = j.qrSvg;
            content.classList.remove('hidden');
        } catch (err) {
            errBox.textContent = `Could not generate invite: ${err.message}`;
            errBox.classList.remove('hidden');
        } finally {
            loading.classList.add('hidden');
        }
    }

    $('open-invite').addEventListener('click', () => { open(inviteModal); mintInvite(); });

    // Allow other pages to deep-link the modals via /dashboard?modal=invite (or install).
    // Clean the URL after triggering so a refresh doesn't re-open the modal.
    const params = new URLSearchParams(location.search);
    const modal = params.get('modal');
    if (modal === 'invite') {
        history.replaceState(null, '', location.pathname);
        open(inviteModal);
        mintInvite();
    } else if (modal === 'install') {
        history.replaceState(null, '', location.pathname);
        open(installModal);
        // fillInstall is defined below; call after a tick so DOM is ready.
        setTimeout(() => fillInstall(), 0);
    }
    $('invite-new').addEventListener('click', mintInvite);
    $('invite-copy').addEventListener('click', async () => {
        const link = $('invite-link').value;
        try {
            await navigator.clipboard.writeText(link);
            $('invite-copy').textContent = 'Copied!';
            setTimeout(() => { $('invite-copy').textContent = 'Copy'; }, 1200);
        } catch {
            $('invite-link').select();
        }
    });

    // --- Install Android app ---

    function fillInstall() {
        const url = `${location.origin}/download/family-guardian.apk`;
        $('install-link').value = url;
        $('install-qr').innerHTML = `<img src="/download/qr.svg" alt="Install QR" width="220" height="220"/>`;
    }

    $('open-install').addEventListener('click', () => { open(installModal); fillInstall(); });
})();
