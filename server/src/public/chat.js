// Family chat page: load history, send messages, append live WS frames.

(function () {
    const state = window.__CHAT_STATE__;
    if (!state) { console.error('chat state missing'); return; }

    const $ = (id) => document.getElementById(id);
    const list = $('messages');
    const composer = $('composer');
    const input = $('composer-text');
    const sendBtn = $('composer-send');
    const newMsgPill = $('new-msg-pill');

    const seen = new Set();
    let lastAuthor = null;
    let userScrolledUp = false;
    let unreadCount = 0;

    const membersMap = new Map();
    for (const m of state.members || []) membersMap.set(m.userId, m);

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function initials(name) {
        return (name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    }

    function avatarHtml(userId) {
        const m = membersMap.get(userId) || {};
        const ini = `<span style="position:relative;z-index:0">${esc(initials(m.displayName))}</span>`;
        if (!m.photoUrl) return ini;
        return `${ini}<img src="${esc(m.photoUrl)}" alt="" loading="lazy" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;border-radius:9999px;object-fit:cover;z-index:1;background:transparent">`;
    }

    function dayLabel(ts) {
        const d = new Date(ts);
        const today = new Date();
        const isSameDay = d.toDateString() === today.toDateString();
        if (isSameDay) return 'Today';
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }

    function timeLabel(ts) {
        return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function dayDivider(label) {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-3 my-3 text-xs uppercase tracking-wider text-on-surface-variant';
        div.innerHTML = `<div class="flex-1 h-px bg-outline-variant/40"></div>${esc(label)}<div class="flex-1 h-px bg-outline-variant/40"></div>`;
        return div;
    }

    function bubble(msg, mine) {
        const wrap = document.createElement('div');
        wrap.className = 'flex items-start gap-3 ' + (mine ? 'flex-row-reverse' : '');
        wrap.dataset.author = msg.userId;
        const showAvatar = lastAuthor !== msg.userId;
        const avatarWrap = `<div class="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center font-bold text-on-surface text-sm shrink-0 ${showAvatar ? '' : 'invisible'}" style="position:relative;overflow:hidden">${avatarHtml(msg.userId)}</div>`;
        wrap.innerHTML = `
            ${avatarWrap}
            <div class="max-w-[70%] flex flex-col gap-1">
                ${showAvatar ? `
                    <div class="text-xs text-on-surface-variant ${mine ? 'text-right' : ''}">
                        <span class="font-semibold text-on-surface">${esc(msg.displayName || 'Member')}</span>
                        <span class="ml-2">${esc(timeLabel(msg.createdAt))}</span>
                    </div>` : ''}
                <div class="${mine
                    ? 'bg-primary text-on-primary rounded-2xl rounded-tr-md'
                    : 'bg-surface-container-lowest text-on-surface rounded-2xl rounded-tl-md'} px-4 py-2.5 text-sm shadow-sm whitespace-pre-wrap break-words">
                    ${esc(msg.body)}
                </div>
            </div>`;
        return wrap;
    }

    let lastDayLabel = null;
    function appendMessage(msg) {
        if (seen.has(msg.id)) return;
        seen.add(msg.id);
        const dl = dayLabel(msg.createdAt);
        if (dl !== lastDayLabel) {
            list.appendChild(dayDivider(dl));
            lastDayLabel = dl;
            lastAuthor = null;
        }
        const mine = msg.userId === state.me.userId;
        list.appendChild(bubble(msg, mine));
        lastAuthor = msg.userId;
    }

    function isNearBottom() {
        return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    }

    function scrollToBottom() {
        list.scrollTop = list.scrollHeight;
    }

    function showPill() {
        if (!newMsgPill) return;
        unreadCount++;
        newMsgPill.textContent = unreadCount === 1 ? '↓ New message' : `↓ ${unreadCount} new messages`;
        newMsgPill.classList.remove('hidden');
    }

    function hidePill() {
        if (!newMsgPill) return;
        unreadCount = 0;
        newMsgPill.classList.add('hidden');
    }

    if (newMsgPill) {
        newMsgPill.addEventListener('click', () => {
            scrollToBottom();
            hidePill();
        });
    }

    list.addEventListener('scroll', () => {
        userScrolledUp = !isNearBottom();
        if (!userScrolledUp) hidePill();
    });

    async function loadHistory() {
        try {
            const res = await fetch(`/api/circles/${state.circleId}/messages`, { credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            for (const m of data.messages || []) appendMessage(m);
            scrollToBottom();
            userScrolledUp = false;
        } catch (err) {
            const note = document.createElement('div');
            note.className = 'text-center text-sm text-error py-2';
            note.textContent = 'Could not load messages: ' + err.message;
            list.appendChild(note);
        }
    }

    async function send(body) {
        const res = await fetch(`/api/circles/${state.circleId}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ body }),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || res.status);
        }
        return res.json();
    }

    composer.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        input.value = '';
        input.style.height = 'auto';
        try {
            const msg = await send(text);
            appendMessage(msg);
            scrollToBottom();
            userScrolledUp = false;
        } catch (err) {
            input.value = text;
            alert('Send failed: ' + err.message);
        } finally {
            sendBtn.disabled = false;
            input.focus();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            composer.requestSubmit();
        }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    });

    let ws, reconnectDelay = 1000;
    function connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}/ws`);
        ws.addEventListener('open', () => { reconnectDelay = 1000; });
        ws.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type !== 'chat_message') return;
            appendMessage(msg);
            if (msg.userId === state.me.userId || !userScrolledUp) {
                scrollToBottom();
                userScrolledUp = false;
            } else {
                showPill();
            }
        });
        ws.addEventListener('close', () => {
            setTimeout(connectWs, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        });
        ws.addEventListener('error', () => { try { ws.close(); } catch {} });
    }

    loadHistory().then(connectWs);
    input.focus();
})();
