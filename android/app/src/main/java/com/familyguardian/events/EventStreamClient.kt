package com.familyguardian.events

import android.util.Log
import com.familyguardian.data.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * Maintains a single WebSocket connection to /ws?token=... and exposes a hot
 * Flow of decoded [GuardianEvent]s. Reconnects with exponential backoff on
 * disconnect. The caller drives the lifecycle by calling [start] and [stop].
 *
 * The client reads serverUrl + token from [Prefs] each time it (re)connects,
 * so logging in or rotating the token on disk transparently picks up.
 */
class EventStreamClient(
    private val prefs: Prefs,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob()),
) {
    private val json = Json { ignoreUnknownKeys = true; classDiscriminator = "type" }
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // streaming
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private val _events = MutableSharedFlow<GuardianEvent>(replay = 0, extraBufferCapacity = 64)
    val events: SharedFlow<GuardianEvent> = _events.asSharedFlow()

    private val mutex = Mutex()
    private var loopJob: Job? = null
    private var socket: WebSocket? = null

    fun start() {
        scope.launch {
            mutex.withLock {
                if (loopJob?.isActive == true) return@withLock
                loopJob = scope.launch { runReconnectLoop() }
            }
        }
    }

    fun stop() {
        scope.launch {
            mutex.withLock {
                socket?.close(1000, "client_stop")
                socket = null
                loopJob?.cancel()
                loopJob = null
            }
        }
    }

    private suspend fun runReconnectLoop() {
        var backoffMs = 1_000L
        while (true) {
            val snap = prefs.snapshot()
            val server = snap.serverUrl
            val token = snap.token
            if (server.isNullOrBlank() || token.isNullOrBlank()) {
                // Nothing to connect to; wait and retry rather than spin.
                delay(5_000L)
                continue
            }
            val wsUrl = server.trim().trimEnd('/')
                .replaceFirst("http://", "ws://")
                .replaceFirst("https://", "wss://") + "/ws?token=$token"
            Log.i("EventStream", "Connecting $wsUrl")
            val opened = connectOnce(wsUrl)
            if (opened) backoffMs = 1_000L
            // After the socket closes, wait before reconnecting.
            delay(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
        }
    }

    /** Returns after the socket is closed. Returns true if the connection was opened at all. */
    private suspend fun connectOnce(url: String): Boolean {
        val request = Request.Builder().url(url).build()
        val gate = kotlinx.coroutines.CompletableDeferred<Boolean>()
        var openedFlag = false
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                openedFlag = true
                Log.i("EventStream", "WS open")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val event = json.decodeFromString(GuardianEvent.serializer(), text)
                    _events.tryEmit(event)
                } catch (t: Throwable) {
                    Log.w("EventStream", "Decode failed: ${t.message} text=$text")
                }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.i("EventStream", "WS closing $code $reason")
                webSocket.close(code, reason)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i("EventStream", "WS closed $code $reason")
                if (!gate.isCompleted) gate.complete(openedFlag)
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w("EventStream", "WS failure: ${t.message}")
                if (!gate.isCompleted) gate.complete(openedFlag)
            }
        })
        socket = ws
        return try {
            gate.await()
        } finally {
            socket = null
        }
    }

    /** Stops the loop and releases OkHttp resources. Does NOT cancel the supplied scope. */
    fun shutdown() {
        stop()
        client.dispatcher.executorService.shutdown()
    }
}
