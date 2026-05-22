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
    const micBtn = $('composer-mic');
    const imgBtn = $('composer-img');
    const imgInput = $('composer-img-input');

    const seen = new Set();
    let lastAuthor = null;
    let userScrolledUp = false;
    let unreadCount = 0;
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

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

    const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    const reactionsMap = new Map();

    const typingUsers = new Map();
    let typingLastSent = 0;
    const typingLine = document.createElement('div');
    typingLine.className = 'px-4 py-1 text-xs text-on-surface-variant italic';
    typingLine.style.display = 'none';
    const typingContainer = $('typing-line');
    if (typingContainer) typingContainer.appendChild(typingLine);

    function updateTypingUI() {
        const now = Date.now();
        for (const [k, v] of typingUsers) { if (v.expiresAt < now) typingUsers.delete(k); }
        const names = Array.from(typingUsers.values()).map(v => v.displayName);
        if (names.length > 0 && typingContainer) {
            typingLine.textContent = names.join(', ') + ' typing…';
            typingLine.style.display = '';
            typingContainer.style.display = '';
        } else if (typingContainer) {
            typingLine.style.display = 'none';
            typingContainer.style.display = 'none';
        }
    }
    setInterval(updateTypingUI, 1000);

    const readQueue = [];
    let readTimer = null;
    function flushReads() {
        if (readQueue.length === 0) return;
        const ids = readQueue.splice(0, 50);
        fetch('/api/messages/read-batch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ messageIds: ids }),
        }).catch(() => {});
    }

    function reactionsHtml(msg) {
        const rxs = msg.reactions || reactionsMap.get(msg.id) || [];
        if (rxs.length === 0) return '';
        const chips = rxs.map(rx => {
            const isMine = rx.userIds.includes(state.me.userId);
            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer ${isMine ? 'bg-secondary-container text-on-secondary' : 'bg-surface-container text-on-surface-variant'}" data-msg-id="${esc(msg.id)}" data-emoji="${esc(rx.emoji)}" data-action="toggle-reaction">${esc(rx.emoji)} ${esc(rx.userIds.length)}</span>`;
        }).join('');
        return `<div class="flex flex-wrap gap-1 mt-1">${chips}</div>`;
    }

    function reactionPickerHtml(msgId) {
        const btns = EMOJIS.map(e =>
            `<button class="text-lg px-1 py-0.5 hover:bg-surface-container rounded" data-msg-id="${esc(msgId)}" data-emoji="${esc(e)}" data-action="react">${esc(e)}</button>`
        ).join('');
        return `<div class="hidden absolute bottom-full left-0 mb-1 bg-surface-container-lowest rounded-lg shadow-lg px-2 py-1 flex gap-1 z-10" data-picker="${esc(msgId)}">${btns}</div>`;
    }

    function attachmentHtml(msg) {
        if (!msg.attachmentKind) return '';
        if (msg.attachmentKind === 'image') {
            return `<div class="mb-2"><img src="${esc(msg.attachmentUrl)}" alt="Photo" loading="lazy" class="rounded-lg max-w-xs max-h-64 object-cover cursor-pointer" data-action="view-image" data-src="${esc(msg.attachmentUrl)}"></div>`;
        }
        if (msg.attachmentKind === 'audio') {
            return `<div class="mb-2"><audio controls preload="metadata" class="max-w-[240px] h-8" src="${esc(msg.attachmentUrl)}"></audio></div>`;
        }
        return '';
    }

    function bubble(msg, mine) {
        const wrap = document.createElement('div');
        wrap.className = 'flex items-start gap-3 ' + (mine ? 'flex-row-reverse' : '');
        wrap.dataset.author = msg.userId;
        wrap.dataset.msgId = msg.id;
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
                <div class="relative group">
                    <div class="${mine
                        ? 'bg-primary text-on-primary rounded-2xl rounded-tr-md'
                        : 'bg-surface-container-lowest text-on-surface rounded-2xl rounded-tl-md'} px-4 py-2.5 text-sm shadow-sm whitespace-pre-wrap break-words">
                        ${attachmentHtml(msg)}${msg.body ? esc(msg.body) : ''}
                    </div>
                    <button class="absolute top-1 ${mine ? 'left-1' : 'right-1'} opacity-0 group-hover:opacity-100 text-xs text-on-surface-variant hover:text-primary w-6 h-6 flex items-center justify-center rounded-full hover:bg-surface-container" data-msg-id="${esc(msg.id)}" data-action="show-picker">+</button>
                    ${reactionPickerHtml(msg.id)}
                    ${reactionsHtml(msg)}
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

    async function sendAttachment(file, kind, body) {
        const form = new FormData();
        form.append('file', file);
        form.append('kind', kind);
        if (body) form.append('body', body);
        const res = await fetch(`/api/circles/${state.circleId}/messages/attachment`, {
            method: 'POST',
            credentials: 'same-origin',
            body: form,
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
        const now = Date.now();
        if (now - typingLastSent > 3000) {
            typingLastSent = now;
            fetch(`/api/circles/${state.circleId}/typing`, {
                method: 'POST', credentials: 'same-origin',
            }).catch(() => {});
        }
    });

    if (imgBtn && imgInput) {
        imgBtn.addEventListener('click', () => imgInput.click());
        imgInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            imgBtn.disabled = true;
            try {
                const msg = await sendAttachment(file, 'image', null);
                appendMessage(msg);
                scrollToBottom();
                userScrolledUp = false;
            } catch (err) {
                alert('Image upload failed: ' + err.message);
            } finally {
                imgBtn.disabled = false;
                imgInput.value = '';
            }
        });
    }

    function getSupportedMimeType() {
        const types = [
            'audio/mp4;codecs=mp4a.40.2',
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
        ];
        for (const t of types) {
            if (MediaRecorder.isTypeSupported(t)) return t;
        }
        return '';
    }

    if (micBtn && typeof MediaRecorder !== 'undefined') {
        micBtn.addEventListener('pointerdown', async (e) => {
            e.preventDefault();
            if (isRecording) return;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mimeType = getSupportedMimeType();
                mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
                audioChunks = [];
                mediaRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunks.push(ev.data); };
                mediaRecorder.onstop = async () => {
                    stream.getTracks().forEach((t) => t.stop());
                    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/mp4' });
                    const ext = blob.type.includes('webm') ? 'webm' : 'm4a';
                    const file = new File([blob], `voice.${ext}`, { type: blob.type });
                    micBtn.disabled = true;
                    try {
                        const msg = await sendAttachment(file, 'audio', null);
                        appendMessage(msg);
                        scrollToBottom();
                        userScrolledUp = false;
                    } catch (err) {
                        alert('Voice upload failed: ' + err.message);
                    } finally {
                        micBtn.disabled = false;
                        isRecording = false;
                        micBtn.textContent = 'mic';
                        micBtn.classList.remove('text-error');
                        micBtn.classList.add('text-on-surface-variant');
                    }
                };
                mediaRecorder.start();
                isRecording = true;
                micBtn.textContent = 'stop';
                micBtn.classList.add('text-error');
                micBtn.classList.remove('text-on-surface-variant');
            } catch (err) {
                alert('Microphone access denied');
            }
        });
        micBtn.addEventListener('pointerup', () => {
            if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        });
        micBtn.addEventListener('pointerleave', () => {
            if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        });
    }

    list.addEventListener('click', (ev) => {
        const target = ev.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'view-image') {
            const src = target.dataset.src;
            if (src) window.open(src, '_blank');
            return;
        }
        if (action === 'show-picker') {
            const picker = target.parentElement.querySelector('[data-picker]');
            if (picker) picker.classList.toggle('hidden');
            return;
        }
        if (action === 'react') {
            const msgId = Number(target.dataset.msgId);
            const emoji = target.dataset.emoji;
            toggleReaction(msgId, emoji);
            const picker = target.closest('[data-picker]');
            if (picker) picker.classList.add('hidden');
            return;
        }
        if (action === 'toggle-reaction') {
            const msgId = Number(target.dataset.msgId);
            const emoji = target.dataset.emoji;
            toggleReaction(msgId, emoji);
            return;
        }
    });

    let ws, reconnectDelay = 1000;
    function connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}/ws`);
        ws.addEventListener('open', () => { reconnectDelay = 1000; });
        ws.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type === 'chat_message') {
                appendMessage(msg);
                if (msg.userId === state.me.userId || !userScrolledUp) {
                    scrollToBottom();
                    userScrolledUp = false;
                } else {
                    showPill();
                }
            } else if (msg.type === 'reaction_added' || msg.type === 'reaction_removed') {
                applyReactionEvent(msg);
            } else if (msg.type === 'chat_typing') {
                typingUsers.set(msg.userId, { displayName: msg.displayName, expiresAt: msg.expiresAt });
                updateTypingUI();
            } else if (msg.type === 'message_read') {
                const el = list.querySelector(`[data-msg-id="${msg.messageId}"]`);
                if (!el) return;
                const mine = el.dataset.author == state.me.userId;
                if (!mine) return;
                let readersEl = el.querySelector('.readers-line');
                if (!readersEl) {
                    readersEl = document.createElement('div');
                    readersEl.className = 'readers-line text-xs text-on-surface-variant mt-1';
                    el.querySelector('.max-w-\\[70\\%\\]')?.appendChild(readersEl);
                }
                const count = (readersEl.dataset.count || 0) + 1;
                readersEl.dataset.count = count;
                readersEl.textContent = `Seen by ${count}`;
            }
        });
        ws.addEventListener('close', () => {
            setTimeout(connectWs, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        });
        ws.addEventListener('error', () => { try { ws.close(); } catch {} });
    }

    function applyReactionEvent(ev) {
        const el = list.querySelector(`[data-msg-id="${ev.messageId}"] .group`);
        if (!el) return;
        let rxs = reactionsMap.get(ev.messageId) || [];
        if (ev.type === 'reaction_added') {
            const existing = rxs.find(r => r.emoji === ev.emoji);
            if (existing) {
                if (!existing.userIds.includes(ev.userId)) existing.userIds.push(ev.userId);
            } else {
                rxs.push({ emoji: ev.emoji, userIds: [ev.userId] });
            }
        } else {
            const existing = rxs.find(r => r.emoji === ev.emoji);
            if (existing) {
                existing.userIds = existing.userIds.filter(id => id !== ev.userId);
                if (existing.userIds.length === 0) rxs = rxs.filter(r => r.emoji !== ev.emoji);
            }
        }
        reactionsMap.set(ev.messageId, rxs);
        const reactionsEl = el.querySelector('[data-action="toggle-reaction"]')?.parentElement;
        if (reactionsEl) {
            reactionsEl.innerHTML = reactionsHtml({ id: ev.messageId, reactions: rxs }).replace(/^<div[^>]*>|<\/div>$/g, '');
        }
    }

    async function toggleReaction(messageId, emoji) {
        const rxs = reactionsMap.get(messageId) || [];
        const existing = rxs.find(r => r.emoji === emoji && r.userIds.includes(state.me.userId));
        if (existing) {
            await fetch(`/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
                method: 'DELETE', credentials: 'same-origin',
            });
        } else {
            await fetch(`/api/messages/${messageId}/reactions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ emoji }),
            });
        }
    }

    loadHistory().then(connectWs);
    input.focus();

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                const msgId = Number(entry.target.dataset.msgId);
                const author = Number(entry.target.dataset.author);
                if (msgId && author !== state.me.userId && !readQueue.includes(msgId)) {
                    readQueue.push(msgId);
                }
            }
        }
    }, { root: list, threshold: 0.5 });

    readTimer = setInterval(flushReads, 2000);
})();
