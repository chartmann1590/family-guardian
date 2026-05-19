// First-run setup wizard: welcome → create admin → success.

(function () {
    const $ = (id) => document.getElementById(id);
    const steps = [$('step-1'), $('step-2'), $('step-3')];
    const dots = [$('dot-1'), $('dot-2'), $('dot-3')];

    function go(idx) {
        steps.forEach((s, i) => s.classList.toggle('hidden', i !== idx));
        dots.forEach((d, i) => {
            d.classList.remove('step-active', 'step-done', 'step-pending');
            if (i < idx) d.classList.add('step-done');
            else if (i === idx) d.classList.add('step-active');
            else d.classList.add('step-pending');
        });
    }

    $('btn-step-1-next').addEventListener('click', () => go(1));

    const form = $('form-admin');
    const errBox = $('step-2-error');
    const nameInput = form.elements['displayName'];
    const circleDefault = $('circle-default');
    nameInput.addEventListener('input', () => {
        const name = nameInput.value.trim();
        circleDefault.textContent = name ? `${name}'s Family` : 'Your family';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.classList.add('hidden');
        const data = Object.fromEntries(new FormData(form).entries());
        if (!data.circleName) delete data.circleName;
        const btn = $('btn-step-2-submit');
        const label = $('btn-step-2-label');
        btn.disabled = true;
        label.textContent = 'Creating…';
        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j.error || `HTTP ${res.status}`);
            }
            go(2);
        } catch (err) {
            errBox.textContent = `Could not create account: ${err.message}`;
            errBox.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            label.textContent = 'Create my account';
        }
    });
})();
