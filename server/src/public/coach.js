// First-visit coach marks on the dashboard. Highlights key UI elements with
// a short tooltip card. Once finished or skipped, sets a localStorage flag so
// it never re-appears.

(function () {
    const KEY = 'fg-coach-done-v1';
    if (localStorage.getItem(KEY) === '1') return;

    const steps = [
        {
            selector: '#member-list',
            title: 'Your live circle',
            body: "Every family member shows up here with their last known location. Markers move in real time as the Android app reports GPS.",
            position: 'left',
        },
        {
            selector: '[data-coach="invite"]',
            title: 'Add family',
            body: "Tap here to mint a one-tap invite link + QR code. Share it via text — the recipient signs up in seconds.",
            position: 'right',
        },
        {
            selector: '#open-install',
            title: 'Install on Android',
            body: "The Android APK is baked into your server. This shows a QR your family can scan to install on their phones.",
            position: 'right',
        },
        {
            selector: 'a[href="/chat"]',
            title: 'Family chat',
            body: "Private group chat that flows through your server only.",
            position: 'right',
        },
    ];

    const $ = (id) => document.getElementById(id);
    const overlay = $('coach');
    const card = $('coach-card');
    const title = $('coach-title');
    const body = $('coach-body');
    const nextBtn = $('coach-next');
    const skipBtn = $('coach-skip');

    let idx = 0;
    let highlighted = null;

    function clearHighlight() {
        if (highlighted) {
            highlighted.style.boxShadow = '';
            highlighted.style.position = '';
            highlighted.style.zIndex = '';
            highlighted = null;
        }
    }

    function finish() {
        clearHighlight();
        overlay.classList.add('hidden');
        card.classList.add('hidden');
        localStorage.setItem(KEY, '1');
    }

    function placeCard(target, position) {
        const rect = target.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const pad = 12;
        let top, left;
        if (position === 'right') {
            left = Math.min(rect.right + pad, window.innerWidth - cardRect.width - pad);
            top = Math.max(pad, Math.min(rect.top, window.innerHeight - cardRect.height - pad));
        } else if (position === 'left') {
            left = Math.max(pad, rect.left - cardRect.width - pad);
            top = Math.max(pad, Math.min(rect.top, window.innerHeight - cardRect.height - pad));
        } else {
            left = Math.max(pad, rect.left);
            top = Math.min(rect.bottom + pad, window.innerHeight - cardRect.height - pad);
        }
        card.style.top = `${top}px`;
        card.style.left = `${left}px`;
    }

    function showStep() {
        clearHighlight();
        // Skip past steps whose target isn't on the page (e.g. mobile-only buttons hidden on desktop).
        while (idx < steps.length) {
            const s = steps[idx];
            const t = document.querySelector(s.selector);
            if (t && t.offsetParent !== null) {
                title.textContent = s.title;
                body.textContent = s.body;
                t.style.position = t.style.position || 'relative';
                t.style.zIndex = '57';
                t.style.boxShadow = '0 0 0 4px rgba(0,108,73,0.45), 0 0 0 8px rgba(0,108,73,0.18)';
                highlighted = t;
                overlay.classList.remove('hidden');
                card.classList.remove('hidden');
                requestAnimationFrame(() => placeCard(t, s.position));
                nextBtn.textContent = (idx === steps.length - 1) ? 'Got it' : 'Next';
                return;
            }
            idx++;
        }
        finish();
    }

    nextBtn.addEventListener('click', () => { idx++; showStep(); });
    skipBtn.addEventListener('click', finish);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { idx++; showStep(); } });
    window.addEventListener('resize', () => {
        if (!highlighted) return;
        placeCard(highlighted, steps[idx].position);
    });

    // Wait a tick so app.js can populate member-list before highlighting.
    setTimeout(showStep, 400);
})();
