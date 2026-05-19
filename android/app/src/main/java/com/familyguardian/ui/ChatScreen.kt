package com.familyguardian.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
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
import com.familyguardian.data.ChatMessage
import com.familyguardian.data.ChatRepo
import com.familyguardian.data.Prefs
import com.familyguardian.events.Alerts
import com.familyguardian.events.EventBus
import com.familyguardian.events.GuardianEvent
import kotlinx.coroutines.launch
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
                    ),
                )
                if (ev.userId != selfUserId) {
                    // We're on-screen — clear any system notification for this sender.
                    Alerts.cancelChat(appCtx, ev.userId)
                }
                if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
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
                    itemsWithDayHeaders(messages, selfUserId)
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
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
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

@Composable
private fun MessageBubble(message: ChatMessage, mine: Boolean, showHeader: Boolean) {
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
            ) {
                Text(
                    message.body,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
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
            MessageBubble(message = m, mine = m.userId == selfUserId, showHeader = showHeader)
        }
    }
}
