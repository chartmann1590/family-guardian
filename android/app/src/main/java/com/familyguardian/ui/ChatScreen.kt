package com.familyguardian.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.familyguardian.data.ChatMessage
import com.familyguardian.data.ChatRepo
import com.familyguardian.data.Prefs
import com.familyguardian.data.ProfileRepo
import com.familyguardian.data.Reaction
import com.familyguardian.events.Alerts
import com.familyguardian.events.EventBus
import com.familyguardian.events.GuardianEvent
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val appCtx = context.applicationContext
    val prefs = remember { Prefs(appCtx) }
    val repo = remember { ChatRepo(prefs) }
    val scope = rememberCoroutineScope()

    val circleId by prefs.circleId.collectAsStateWithLifecycle(initialValue = null)
    val selfUserId by prefs.userId.collectAsStateWithLifecycle(initialValue = null)

    val messages = remember { mutableStateListOf<ChatMessage>() }
    val seen = remember { mutableSetOf<Long>() }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var input by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }

    val listState = rememberLazyListState()

    fun appendIfNew(msg: ChatMessage) {
        if (seen.add(msg.id)) {
            // Keep ASC order by createdAt.
            val idx = messages.indexOfLast { it.createdAt <= msg.createdAt }
            messages.add(idx + 1, msg)
        }
    }

    val EMOJIS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")
    var reactionPickerMsg by remember { mutableStateOf<ChatMessage?>(null) }
    val typingUsers = remember { mutableStateOf(mutableMapOf<Long, Pair<String, Long>>()) }

    // Load history once we know the circleId.
    LaunchedEffect(circleId) {
        val cid = circleId ?: return@LaunchedEffect
        loading = true
        error = null
        try {
            for (m in repo.list(cid)) appendIfNew(m)
        } catch (t: Throwable) {
            error = t.message ?: "Failed to load messages."
        } finally {
            loading = false
            if (messages.isNotEmpty()) listState.scrollToItem(messages.lastIndex)
        }
    }

    // Live WS feed.
    LaunchedEffect(circleId) {
        EventBus.events.collect { ev ->
            if (ev is GuardianEvent.ChatMessage) {
                appendIfNew(
                    ChatMessage(
                        id = ev.id,
                        circleId = circleId ?: -1L,
                        userId = ev.userId,
                        displayName = ev.displayName,
                        body = ev.body,
                        createdAt = ev.createdAt,
                        attachmentKind = ev.attachmentKind,
                        attachmentUrl = ev.attachmentUrl,
                        attachmentMime = ev.attachmentMime,
                        attachmentDurationMs = ev.attachmentDurationMs,
                    ),
                )
                if (ev.userId != selfUserId) {
                    Alerts.cancelChat(appCtx, ev.userId)
                }
                if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
            } else if (ev is GuardianEvent.ReactionAdded || ev is GuardianEvent.ReactionRemoved) {
                val msgId = if (ev is GuardianEvent.ReactionAdded) ev.messageId else (ev as GuardianEvent.ReactionRemoved).messageId
                val emoji = if (ev is GuardianEvent.ReactionAdded) ev.emoji else (ev as GuardianEvent.ReactionRemoved).emoji
                val uid = if (ev is GuardianEvent.ReactionAdded) ev.userId else (ev as GuardianEvent.ReactionRemoved).userId
                val isAdd = ev is GuardianEvent.ReactionAdded
                val idx = messages.indexOfFirst { it.id == msgId }
                if (idx >= 0) {
                    val msg = messages[idx]
                    val rxs = msg.reactions.toMutableList()
                    val existing = rxs.find { it.emoji == emoji }
                    if (isAdd) {
                        if (existing != null) {
                            if (uid !in existing.userIds) rxs[rxs.indexOf(existing)] = existing.copy(userIds = existing.userIds + uid)
                        } else {
                            rxs.add(Reaction(emoji, listOf(uid)))
                        }
                    } else {
                        if (existing != null) {
                            val updated = existing.userIds.filter { it != uid }
                            if (updated.isEmpty()) rxs.remove(existing)
                            else rxs[rxs.indexOf(existing)] = existing.copy(userIds = updated)
                        }
                    }
                    messages[idx] = msg.copy(reactions = rxs)
                }
            } else if (ev is GuardianEvent.ChatTyping) {
                typingUsers.value = mutableMapOf<Long, Pair<String, Long>>().apply {
                    putAll(typingUsers.value)
                    put(ev.userId, Pair(ev.displayName, ev.expiresAt))
                }
            } else if (ev is GuardianEvent.MessageRead) {
                val idx = messages.indexOfFirst { it.id == ev.messageId }
                if (idx >= 0 && messages[idx].userId == selfUserId) {
                    val readers = messages[idx].readers?.toMutableList() ?: mutableListOf()
                    if (readers.none { it.userId == ev.userId }) {
                        readers.add(com.familyguardian.data.MessageReader(ev.userId, ev.readAt))
                        messages[idx] = messages[idx].copy(readers = readers)
                    }
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            val now = System.currentTimeMillis()
            val filtered = typingUsers.value.filter { it.value.second > now }
            if (filtered.size != typingUsers.value.size) {
                typingUsers.value = filtered.toMutableMap()
            }
        }
    }

    reactionPickerMsg?.let { msg ->
        ModalBottomSheet(
            onDismissRequest = { reactionPickerMsg = null },
            sheetState = rememberModalBottomSheetState(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                for (emoji in EMOJIS) {
                    TextButton(onClick = {
                        val existing = msg.reactions.find { it.emoji == emoji && selfUserId in it.userIds }
                        scope.launch {
                            try {
                                if (existing != null) repo.unreact(msg.id, emoji)
                                else repo.react(msg.id, emoji)
                            } catch (_: Throwable) {}
                        }
                        reactionPickerMsg = null
                    }) {
                        Text(emoji, style = MaterialTheme.typography.headlineMedium)
                    }
                }
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Forum, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
                        Spacer(Modifier.size(8.dp))
                        Text("Family Chat", fontWeight = FontWeight.SemiBold)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.primary,
                ),
            )
        },
        bottomBar = {
            Column {
                val activeTyping = typingUsers.value.filter { it.value.second > System.currentTimeMillis() && it.key != selfUserId }
                if (activeTyping.isNotEmpty()) {
                    Text(
                        activeTyping.values.joinToString(", ") { it.first } + " typing…",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Composer(
                    value = input,
                    onChange = { input = it },
                    onSend = {
                    val cid = circleId ?: return@Composer
                    val text = input.trim()
                    if (text.isEmpty() || sending) return@Composer
                    sending = true
                    error = null // clear stale errors before retry
                    val sentText = text
                    input = ""
                    scope.launch {
                        try {
                            val saved = repo.send(cid, sentText)
                            appendIfNew(saved)
                            if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
                        } catch (t: Throwable) {
                            error = t.message ?: "Send failed"
                            input = sentText // restore
                        } finally {
                            sending = false
                        }
                    }
                },
                sending = sending,
                )
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when {
                loading && messages.isEmpty() -> Text(
                    "Loading…",
                    modifier = Modifier.align(Alignment.Center),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                messages.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("No messages yet.", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Be the first to say hi to your family circle.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    itemsWithDayHeaders(
                        messages = messages,
                        selfUserId = selfUserId,
                        onLongPress = { reactionPickerMsg = it },
                        onReactionClick = { msg, emoji ->
                            val existing = msg.reactions.find { it.emoji == emoji && selfUserId in it.userIds }
                            scope.launch {
                                try {
                                    if (existing != null) repo.unreact(msg.id, emoji)
                                    else repo.react(msg.id, emoji)
                                } catch (_: Throwable) {}
                            }
                        },
                    )
                }
            }
            error?.let { msg ->
                Surface(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(
                        msg,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun Composer(value: String, onChange: (String) -> Unit, onSend: () -> Unit, sending: Boolean) {
    val context = LocalContext.current
    val prefs = remember { Prefs(context.applicationContext) }
    val repo = remember { ChatRepo(prefs) }
    val scope = rememberCoroutineScope()
    var recording by remember { mutableStateOf(false) }
    var mediaRecorder by remember { mutableStateOf<android.media.MediaRecorder?>(null) }

    val imagePickerLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        contract = androidx.activity.result.contract.ActivityResultContracts.GetContent(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val inputStream = context.contentResolver.openInputStream(uri) ?: return@launch
                val tmpFile = File(context.cacheDir, "upload_img_${System.currentTimeMillis()}.jpg")
                tmpFile.outputStream().use { out -> inputStream.copyTo(out) }
                val cid = prefs.snapshot().circleId ?: return@launch
                repo.sendAttachment(cid, tmpFile, "image")
                tmpFile.delete()
            } catch (_: Throwable) {}
        }
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            IconButton(
                onClick = { imagePickerLauncher.launch("image/*") },
                modifier = Modifier.size(40.dp),
            ) {
                Icon(Icons.Filled.Image, contentDescription = "Attach image", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(
                onClick = {
                    if (recording) return@IconButton
                    try {
                        val mr = android.media.MediaRecorder(context)
                        val tmpFile = File(context.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
                        mr.setAudioSource(android.media.MediaRecorder.AudioSource.MIC)
                        mr.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4)
                        mr.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC)
                        mr.setOutputFile(tmpFile.absolutePath)
                        mr.prepare()
                        mr.start()
                        mediaRecorder = mr
                        recording = true
                        scope.launch {
                            kotlinx.coroutines.delay(60_000)
                            if (recording) {
                                mediaRecorder?.apply { stop(); release() }
                                mediaRecorder = null
                                recording = false
                                val cid = prefs.snapshot().circleId ?: return@launch
                                try { repo.sendAttachment(cid, tmpFile, "audio") } catch (_: Throwable) {}
                                tmpFile.delete()
                            }
                        }
                    } catch (_: Throwable) { recording = false }
                },
                modifier = Modifier.size(40.dp),
            ) {
                Icon(
                    Icons.Filled.Mic,
                    contentDescription = if (recording) "Recording..." else "Voice note",
                    tint = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedTextField(
                value = value,
                onValueChange = onChange,
                placeholder = { Text("Message your family…") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(24.dp),
                singleLine = false,
                maxLines = 5,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                ),
            )
            Surface(
                modifier = Modifier.size(48.dp),
                color = MaterialTheme.colorScheme.primary,
                shape = CircleShape,
                onClick = onSend,
                enabled = value.isNotBlank() && !sending,
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                    Icon(
                        Icons.Filled.Send,
                        contentDescription = "Send",
                        tint = MaterialTheme.colorScheme.onPrimary,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageBubble(
    message: ChatMessage,
    mine: Boolean,
    showHeader: Boolean,
    onLongPress: () -> Unit = {},
    onReactionClick: (emoji: String) -> Unit = {},
    selfUserId: Long? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        if (!mine) {
            ChatAvatar(message.displayName, message.userId, visible = showHeader)
            Spacer(Modifier.size(8.dp))
        }
        Column(modifier = Modifier.widthIn(max = 280.dp)) {
            if (showHeader) {
                val header = (message.displayName ?: "Member") + " · " + timeFormat.format(Date(message.createdAt))
                Text(
                    header,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = if (mine) 0.dp else 4.dp, bottom = 2.dp),
                )
            }
            Surface(
                shape = if (mine)
                    RoundedCornerShape(topStart = 16.dp, topEnd = 4.dp, bottomEnd = 16.dp, bottomStart = 16.dp)
                else
                    RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 16.dp),
                color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                shadowElevation = 1.dp,
                modifier = Modifier.combinedClickable(
                    onClick = {},
                    onLongClick = onLongPress,
                ),
            ) {
                Column {
                    if (message.attachmentKind == "image" && message.attachmentUrl != null) {
                        val imageContext = LocalContext.current
                        val appContext = imageContext.applicationContext
                        val snap = remember(appContext) {
                            com.familyguardian.data.Prefs(appContext).snapshotBlocking()
                        }
                        val baseUrl = snap.serverUrl?.trimEnd('/') ?: ""
                        val token = snap.token ?: ""
                        AsyncImage(
                            model = coil.request.ImageRequest.Builder(imageContext)
                                .data("$baseUrl${message.attachmentUrl}")
                                .addHeader("Authorization", "Bearer $token")
                                .crossfade(true)
                                .build(),
                            contentDescription = "Photo",
                            modifier = Modifier
                                .widthIn(max = 240.dp)
                                .heightIn(max = 200.dp)
                                .padding(horizontal = 4.dp, vertical = 4.dp),
                            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                        )
                    }
                    if (message.attachmentKind == "audio") {
                        var isPlaying by remember { mutableStateOf(false) }
                        val mediaPlayer = remember { mutableStateOf<android.media.MediaPlayer?>(null) }
                        val context = LocalContext.current
                        DisposableEffect(Unit) {
                            onDispose { mediaPlayer.value?.release() }
                        }
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            IconButton(onClick = {
                                val mp = mediaPlayer.value
                                if (mp != null && isPlaying) {
                                    mp.pause()
                                    isPlaying = false
                                } else if (mp != null) {
                                    mp.start()
                                    isPlaying = true
                                } else {
                                    val snap = com.familyguardian.data.Prefs(context.applicationContext).snapshotBlocking()
                                    val baseUrl = snap.serverUrl?.trimEnd('/') ?: ""
                                    val token = snap.token ?: ""
                                    val newMp = android.media.MediaPlayer()
                                    newMp.setDataSource(
                                        context,
                                        android.net.Uri.parse("$baseUrl${message.attachmentUrl}"),
                                        mapOf("Authorization" to "Bearer $token"),
                                    )
                                    newMp.setOnCompletionListener { isPlaying = false }
                                    newMp.prepare()
                                    newMp.start()
                                    isPlaying = true
                                    mediaPlayer.value = newMp
                                }
                            }) {
                                Text(if (isPlaying) "⏸" else "▶", style = MaterialTheme.typography.titleMedium)
                            }
                            Text(
                                if (isPlaying) "Playing…" else "Voice note",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (!message.body.isNullOrBlank()) {
                        Text(
                            message.body,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
            if (message.reactions.isNotEmpty()) {
                Row(
                    modifier = Modifier.padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    for (rx in message.reactions) {
                        val isMine = selfUserId != null && selfUserId in rx.userIds
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = if (isMine) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                            onClick = { onReactionClick(rx.emoji) },
                        ) {
                            Text(
                                "${rx.emoji} ${rx.userIds.size}",
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                }
            }
        }
        if (mine) {
            Spacer(Modifier.size(8.dp))
            ChatAvatar(message.displayName, message.userId, visible = showHeader)
        }
    }
}

@Composable
private fun ChatAvatar(displayName: String?, userId: Long, visible: Boolean) {
    if (!visible) {
        // Reserve the slot so message bubbles align even when the header
        // (and avatar) is hidden for stacked messages from the same sender.
        Surface(
            modifier = Modifier.size(36.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.background,
        ) {}
        return
    }
    Avatar(
        displayName = displayName,
        photoPath = "/api/users/$userId/photo",
        size = 36.dp,
    )
}

private val dayHeaderFormat = SimpleDateFormat("EEEE, MMM d", Locale.getDefault())
private val timeFormat      = SimpleDateFormat("HH:mm", Locale.getDefault())

private fun dayHeader(ts: Long): String {
    val now = Calendar.getInstance()
    val that = Calendar.getInstance().apply { timeInMillis = ts }
    val sameDay = now.get(Calendar.YEAR) == that.get(Calendar.YEAR) &&
        now.get(Calendar.DAY_OF_YEAR) == that.get(Calendar.DAY_OF_YEAR)
    if (sameDay) return "Today"
    now.add(Calendar.DAY_OF_YEAR, -1)
    val yesterday = now.get(Calendar.YEAR) == that.get(Calendar.YEAR) &&
        now.get(Calendar.DAY_OF_YEAR) == that.get(Calendar.DAY_OF_YEAR)
    if (yesterday) return "Yesterday"
    return dayHeaderFormat.format(Date(ts))
}

private fun androidx.compose.foundation.lazy.LazyListScope.itemsWithDayHeaders(
    messages: List<ChatMessage>,
    selfUserId: Long?,
    onLongPress: (ChatMessage) -> Unit,
    onReactionClick: (ChatMessage, String) -> Unit,
) {
    var lastDay: String? = null
    var lastAuthor: Long? = null
    messages.forEachIndexed { index, m ->
        val day = dayHeader(m.createdAt)
        if (day != lastDay) {
            item("day-$day-$index") {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    androidx.compose.foundation.layout.Box(
                        modifier = Modifier.weight(1f).height(1.dp).background(MaterialTheme.colorScheme.outlineVariant),
                    )
                    Text(
                        "  $day  ",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    androidx.compose.foundation.layout.Box(
                        modifier = Modifier.weight(1f).height(1.dp).background(MaterialTheme.colorScheme.outlineVariant),
                    )
                }
            }
            lastDay = day
            lastAuthor = null
        }
        val showHeader = lastAuthor != m.userId
        lastAuthor = m.userId
        item(m.id) {
            MessageBubble(
                message = m,
                mine = m.userId == selfUserId,
                showHeader = showHeader,
                onLongPress = { onLongPress(m) },
                onReactionClick = { emoji -> onReactionClick(m, emoji) },
                selfUserId = selfUserId,
            )
        }
    }
}
