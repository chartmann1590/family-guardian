package com.familyguardian.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Sos
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.familyguardian.data.ApiClient
import com.familyguardian.data.AuthRepo
import com.familyguardian.data.CheckinRepo
import com.familyguardian.data.CircleMember
import com.familyguardian.data.PauseRepo
import com.familyguardian.data.PauseState
import com.familyguardian.data.Prefs
import com.familyguardian.data.SosEvent
import com.familyguardian.data.SosRepo
import com.familyguardian.events.EventBus
import com.familyguardian.events.EventStreamClient
import com.familyguardian.events.GuardianEvent
import com.familyguardian.location.LocationService
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import kotlin.coroutines.resume

private fun initials(name: String?): String {
    return (name ?: "?")
        .trim()
        .split(Regex("\\s+"))
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .take(2)
        .joinToString("")
        .ifEmpty { "?" }
}

private fun memberActive(recordedAt: Long?): Boolean {
    return recordedAt != null && (System.currentTimeMillis() - recordedAt) < 5 * 60_000L
}

private fun minutesUntilTonight(): Int {
    val now = java.util.Calendar.getInstance()
    val target = java.util.Calendar.getInstance().apply {
        set(java.util.Calendar.HOUR_OF_DAY, 20)
        set(java.util.Calendar.MINUTE, 0)
        set(java.util.Calendar.SECOND, 0)
        set(java.util.Calendar.MILLISECOND, 0)
        if (timeInMillis <= now.timeInMillis) add(java.util.Calendar.DAY_OF_MONTH, 1)
    }
    val mins = ((target.timeInMillis - now.timeInMillis) / 60_000L).toInt()
    return mins.coerceIn(1, 1440)
}

private fun formatPauseUntil(ms: Long?): String {
    if (ms == null) return ""
    val cal = java.util.Calendar.getInstance().apply { timeInMillis = ms }
    val now = java.util.Calendar.getInstance()
    val sameDay = cal.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR) &&
        cal.get(java.util.Calendar.DAY_OF_YEAR) == now.get(java.util.Calendar.DAY_OF_YEAR)
    val fmt = if (sameDay) java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault())
              else java.text.SimpleDateFormat("MMM d, h:mm a", java.util.Locale.getDefault())
    return fmt.format(cal.time)
}

private fun relativeTimeString(ms: Long): String {
    val diff = System.currentTimeMillis() - ms
    return when {
        diff < 60_000L -> "just now"
        diff < 3_600_000L -> "${diff / 60_000L}m ago"
        diff < 86_400_000L -> "${diff / 3_600_000L}h ago"
        else -> "${diff / 86_400_000L}d ago"
    }
}

private class InitialsMarker(
    mapView: MapView,
    private val label: String,
    active: Boolean,
) : Marker(mapView) {
    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.FILL
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = if (active) Color.parseColor("#006c49") else Color.parseColor("#76777d")
        style = Paint.Style.STROKE
        strokeWidth = 6f
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#0b1c30")
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textSize = 32f
        textAlign = Paint.Align.CENTER
    }

    init { setAnchor(ANCHOR_CENTER, ANCHOR_CENTER) }

    override fun draw(canvas: Canvas, mapView: MapView, shadow: Boolean) {
        val point = mapView.projection.toPixels(position, null)
        val cx = point.x.toFloat()
        val cy = point.y.toFloat()
        val radius = 24f
        canvas.drawCircle(cx, cy, radius, bgPaint)
        canvas.drawCircle(cx, cy, radius, borderPaint)
        val textY = cy - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText(label, cx, textY, textPaint)
    }
}

@Composable
fun MapScreen(
    onLoggedOut: () -> Unit,
    onOpenPlaces: () -> Unit,
    onOpenChat: () -> Unit,
    onOpenMember: (Long, String) -> Unit,
    onOpenAlertSettings: (() -> Unit)? = null,
    onOpenAlertHistory: (() -> Unit)? = null,
    onOpenAbout: () -> Unit = {},
) {
    val context = LocalContext.current
    val appCtx = context.applicationContext
    val prefs = remember { Prefs(appCtx) }
    val repo = remember { AuthRepo(prefs) }
    val sosRepo = remember { SosRepo(prefs) }
    val checkinRepo = remember { CheckinRepo(prefs) }
    val pauseRepo = remember { PauseRepo(prefs) }
    val scope = rememberCoroutineScope()

    val displayName by prefs.displayName.collectAsStateWithLifecycle(initialValue = null)
    var serviceStarted by remember { mutableStateOf(false) }
    var permissionDenied by remember { mutableStateOf(false) }
    var sosConfirming by remember { mutableStateOf(false) }
    var sosInFlight by remember { mutableStateOf(false) }
    var sosMessage by remember { mutableStateOf<String?>(null) }
    var checkinDialogOpen by remember { mutableStateOf(false) }
    var checkinInFlight by remember { mutableStateOf(false) }
    var checkinMessage by remember { mutableStateOf<String?>(null) }
    var showMembers by remember { mutableStateOf(false) }
    var members by remember { mutableStateOf<List<CircleMember>>(emptyList()) }
    var membersLoading by remember { mutableStateOf(false) }
    var membersError by remember { mutableStateOf<String?>(null) }
    var activeSosList by remember { mutableStateOf<List<SosEvent>>(emptyList()) }
    var resolveInFlight by remember { mutableStateOf(false) }
    var pauseDialogOpen by remember { mutableStateOf(false) }
    var pauseInFlight by remember { mutableStateOf(false) }
    var pauseState by remember { mutableStateOf(PauseState()) }
    var pauseMessage by remember { mutableStateOf<String?>(null) }
    val wsState by EventBus.wsState.collectAsStateWithLifecycle(
        initialValue = EventStreamClient.ConnectionState.DISCONNECTED
    )

    val mapViewState = remember { mutableStateOf<MapView?>(null) }

    var bgLocRequested by remember { mutableStateOf(false) }

    val bgLocPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    val fineLocPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val hasFine = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true
        val hasCoarse = granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (hasFine || hasCoarse) {
            permissionDenied = false
            LocationService.start(appCtx)
            serviceStarted = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !bgLocRequested) {
                val hasBg = ContextCompat.checkSelfPermission(
                    appCtx, Manifest.permission.ACCESS_BACKGROUND_LOCATION,
                ) == PackageManager.PERMISSION_GRANTED
                if (!hasBg) {
                    bgLocRequested = true
                    bgLocPermission.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }
            }
        } else {
            permissionDenied = true
        }
    }

    val notifPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    val activityRecognitionPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                appCtx, Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val granted = ContextCompat.checkSelfPermission(
                appCtx, Manifest.permission.ACTIVITY_RECOGNITION,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) activityRecognitionPermission.launch(Manifest.permission.ACTIVITY_RECOGNITION)
        }
        val hasFine = ContextCompat.checkSelfPermission(
            appCtx, Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            appCtx, Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (hasFine || hasCoarse) {
            LocationService.start(appCtx)
            serviceStarted = true
        } else {
            fineLocPermission.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
            )
        }
    }

    suspend fun fetchMembers() {
        val snap = prefs.snapshot()
        val cid = snap.circleId ?: return
        val token = snap.token ?: return
        val server = snap.serverUrl ?: return
        try {
            val url = ApiClient.endpoint(server, "/api/circles/$cid/members")
            val resp = ApiClient.api.listMembers(url, "Bearer $token")
            members = resp.members
            membersError = null
        } catch (t: Throwable) {
            membersError = t.message ?: "Couldn't reach your server."
        }
    }

    fun syncMarkers(membersList: List<CircleMember>) {
        val mv = mapViewState.value ?: return
        val toRemove = mv.overlays.filterIsInstance<InitialsMarker>().toMutableList()
        for (m in membersList) {
            if (m.lat == null || m.lng == null) continue
            val point = GeoPoint(m.lat, m.lng)
            val existing = toRemove.find { it.id == m.userId.toString() }
            if (existing != null) {
                existing.position = point
                toRemove.remove(existing)
            } else {
                val marker = InitialsMarker(
                    mv,
                    initials(m.displayName),
                    memberActive(m.recordedAt),
                )
                marker.id = m.userId.toString()
                marker.position = point
                marker.title = m.displayName
                marker.setOnMarkerClickListener { _, _ ->
                    onOpenMember(m.userId, m.displayName)
                    true
                }
                mv.overlays.add(marker)
            }
        }
        for (old in toRemove) mv.overlays.remove(old)
        mv.invalidate()
    }

    fun centerOnMembers(membersList: List<CircleMember>) {
        val mv = mapViewState.value ?: return
        val points = membersList.mapNotNull { m ->
            if (m.lat != null && m.lng != null) GeoPoint(m.lat, m.lng) else null
        }
        if (points.isEmpty()) return
        if (points.size == 1) {
            mv.controller.setCenter(points[0])
            mv.controller.setZoom(14.0)
        } else {
            val minLat = points.minOf { it.latitude }
            val maxLat = points.maxOf { it.latitude }
            val minLon = points.minOf { it.longitude }
            val maxLon = points.maxOf { it.longitude }
            val center = GeoPoint((minLat + maxLat) / 2, (minLon + maxLon) / 2)
            val latSpan = maxLat - minLat
            val lonSpan = maxLon - minLon
            val maxSpan = maxOf(latSpan, lonSpan, 0.005)
            val zoom = (16.0 - (maxSpan / 0.005)).coerceIn(5.0, 16.0)
            mv.controller.setCenter(center)
            mv.controller.setZoom(zoom)
        }
    }

    LaunchedEffect(Unit) {
        membersLoading = true
        fetchMembers()
        membersLoading = false
        try {
            val snap = prefs.snapshot()
            val cid = snap.circleId
            if (cid != null) activeSosList = sosRepo.listActive(cid)
        } catch (_: Throwable) { }
        try {
            pauseState = pauseRepo.current()
        } catch (_: Throwable) { }
    }

    LaunchedEffect(members) {
        syncMarkers(members)
        if (members.any { it.lat != null }) {
            centerOnMembers(members)
        }
    }

    DisposableEffect(Unit) {
        val job = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
            EventBus.events.collect { event ->
                if (event is GuardianEvent.LocationUpdate) {
                    members = members.map { m ->
                        if (m.userId == event.userId) {
                            m.copy(
                                lat = event.lat,
                                lng = event.lng,
                                batteryPct = event.batteryPct,
                                speedMps = event.speedMps,
                                bearing = event.bearing ?: m.bearing,
                                altitudeM = event.altitudeM ?: m.altitudeM,
                                activity = event.activity ?: m.activity,
                                activityConfidence = event.activityConfidence ?: m.activityConfidence,
                                recordedAt = event.recordedAt,
                                displayName = event.displayName ?: m.displayName,
                            )
                        } else m
                    }
                } else if (event is GuardianEvent.SosActive) {
                    activeSosList = activeSosList
                        .filter { it.userId != event.userId }
                        .plus(SosEvent(
                            id = event.id, circleId = 0, userId = event.userId,
                            displayName = event.displayName, startedAt = event.startedAt,
                            lat = event.lat, lng = event.lng, note = event.note,
                            status = "active",
                        ))
                } else if (event is GuardianEvent.SosResolved) {
                    activeSosList = activeSosList.filter { it.id != event.id }
                } else if (event is GuardianEvent.PauseChanged) {
                    val meId = prefs.snapshotBlocking().userId
                    if (event.userId == meId) {
                        pauseState = PauseState(pausedUntil = event.pausedUntil, reason = event.reason)
                    }
                    members = members.map { m ->
                        if (m.userId == event.userId) {
                            m.copy(
                                paused = event.pausedUntil != null,
                                pausedUntil = event.pausedUntil,
                                pauseReason = event.reason,
                            )
                        } else m
                    }
                }
            }
        }
        onDispose { job.cancel() }
    }

    if (checkinDialogOpen) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { checkinDialogOpen = false },
            title = { Text("Check in", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((status, label, _) in listOf(
                        Triple("safe_home", "I'm safe at home", "home"),
                        Triple("out_safe", "Out & safe", "thumb_up"),
                        Triple("heading_home", "Heading home", "directions_walk"),
                    )) {
                        Button(
                            onClick = {
                                checkinDialogOpen = false
                                checkinInFlight = true
                                checkinMessage = null
                                scope.launch {
                                    try {
                                        val fix = oneShotFix(appCtx)
                                        checkinRepo.send(status, lat = fix?.first, lng = fix?.second)
                                        checkinMessage = "Check-in sent!"
                                    } catch (t: Throwable) {
                                        checkinMessage = "Check-in failed: ${t.message ?: t::class.simpleName}"
                                    } finally {
                                        checkinInFlight = false
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        ) { Text(label) }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { checkinDialogOpen = false }) { Text("Cancel") }
            },
        )
    }

    if (pauseDialogOpen) {
        val isPaused = (pauseState.pausedUntil ?: 0L) > System.currentTimeMillis()
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { pauseDialogOpen = false },
            title = { Text(if (isPaused) "Sharing is paused" else "Pause sharing", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (isPaused) {
                        Text(
                            "Your last-known location is frozen on the circle's map until ${formatPauseUntil(pauseState.pausedUntil)}. Resume now to share live again.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else {
                        Text(
                            "Freeze your last-known location on the map. Your circle will see a pause badge instead of your live position.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        val opts = listOf(
                            "15 min" to 15,
                            "1 hour" to 60,
                            "4 hours" to 240,
                            "Until 8 PM" to minutesUntilTonight(),
                        )
                        for ((label, minutes) in opts) {
                            Button(
                                onClick = {
                                    pauseDialogOpen = false
                                    pauseInFlight = true
                                    pauseMessage = null
                                    scope.launch {
                                        try {
                                            pauseState = pauseRepo.pause(minutes)
                                            pauseMessage = "Paused until ${formatPauseUntil(pauseState.pausedUntil)}"
                                        } catch (t: Throwable) {
                                            pauseMessage = "Pause failed: ${t.message ?: t::class.simpleName}"
                                        } finally {
                                            pauseInFlight = false
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                enabled = !pauseInFlight,
                            ) { Text(label) }
                        }
                    }
                }
            },
            confirmButton = {
                if (isPaused) {
                    Button(
                        onClick = {
                            pauseDialogOpen = false
                            pauseInFlight = true
                            pauseMessage = null
                            scope.launch {
                                try {
                                    pauseState = pauseRepo.unpause()
                                    pauseMessage = "Sharing resumed."
                                } catch (t: Throwable) {
                                    pauseMessage = "Resume failed: ${t.message ?: t::class.simpleName}"
                                } finally {
                                    pauseInFlight = false
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ),
                        enabled = !pauseInFlight,
                    ) { Text("Resume now") }
                }
            },
            dismissButton = {
                TextButton(onClick = { pauseDialogOpen = false }) { Text("Cancel") }
            },
        )
    }

    if (sosConfirming) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { sosConfirming = false },
            title = { Text("Activate SOS?", fontWeight = FontWeight.Bold) },
            text = {
                Text("This broadcasts your current location to everyone in your circle and marks an active SOS on every dashboard.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        sosConfirming = false
                        sosInFlight = true
                        sosMessage = null
                        scope.launch {
                            try {
                                val fix = oneShotFix(appCtx)
                                val ev = sosRepo.activate(
                                    lat = fix?.first,
                                    lng = fix?.second,
                                    accuracyM = fix?.third,
                                )
                                sosMessage = "SOS active (id ${ev.id}). Your circle has been alerted."
                            } catch (t: Throwable) {
                                sosMessage = "SOS failed: ${t.message ?: t::class.simpleName}"
                            } finally {
                                sosInFlight = false
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) { Text("Activate SOS") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { sosConfirming = false }) { Text("Cancel") }
            },
        )
    }

    if (showMembers) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showMembers = false },
            title = { Text("Circle Members", fontWeight = FontWeight.Bold) },
            text = {
                if (membersLoading) {
                    Text("Loading...")
                } else if (members.isEmpty()) {
                    Text("No members found.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        for (m in members) {
                            Surface(
                                onClick = {
                                    showMembers = false
                                    onOpenMember(m.userId, m.displayName)
                                },
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    Avatar(
                                        displayName = m.displayName,
                                        photoPath = m.photoUrl,
                                        size = 40.dp,
                                    )
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(m.displayName, style = MaterialTheme.typography.bodyLarge)
                                        if (m.paused) {
                                            Text(
                                                "⏸ Paused${m.pausedUntil?.let { " until " + formatPauseUntil(it) } ?: ""}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.error,
                                            )
                                        } else if (m.lat != null && m.lng != null) {
                                            Text(
                                                "%.4f, %.4f".format(m.lat, m.lng),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        val secondary = buildList {
                                            activityLabel(m.activity)?.let { add(it) }
                                            if (m.speedMps != null && (m.speedMps ?: 0.0) > 0.3) add(formatSpeed(m.speedMps))
                                            m.batteryPct?.let { add("$it%") }
                                        }.joinToString(" • ")
                                        if (secondary.isNotBlank()) {
                                            Text(
                                                secondary,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showMembers = false }) { Text("Close") }
            },
        )
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(modifier = Modifier.fillMaxSize()) {

            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    MapView(ctx).apply {
                        setTileSource(TileSourceFactory.MAPNIK)
                        setMultiTouchControls(true)
                        controller.setZoom(3.0)
                        mapViewState.value = this
                    }
                },
            )

            Surface(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f),
                shadowElevation = 6.dp,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.padding(end = 8.dp)) {
                        Text(
                            "Family Guardian",
                            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            displayName?.let { "Signed in as $it" } ?: "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                        Row {
                            IconButton(onClick = onOpenAbout, modifier = Modifier.size(40.dp)) {
                                Icon(Icons.Filled.Info, contentDescription = "About", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            val isPausedNow = (pauseState.pausedUntil ?: 0L) > System.currentTimeMillis()
                            IconButton(
                                onClick = { pauseDialogOpen = true },
                                modifier = Modifier.size(40.dp),
                            ) {
                                Icon(
                                    if (isPausedNow) Icons.Filled.PauseCircle else Icons.Filled.Pause,
                                    contentDescription = if (isPausedNow) "Sharing paused" else "Pause sharing",
                                    tint = if (isPausedNow) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            TextButton(onClick = {
                                showMembers = true
                                scope.launch {
                                    membersLoading = true
                                    fetchMembers()
                                    membersLoading = false
                                }
                            }) {
                                Icon(Icons.Filled.People, contentDescription = "Members")
                            }
                            TextButton(onClick = onOpenChat) {
                                Icon(Icons.Filled.Forum, contentDescription = "Chat")
                            }
                            TextButton(onClick = onOpenPlaces) {
                                Icon(Icons.Filled.Place, contentDescription = "Safety places")
                            }
                            if (onOpenAlertSettings != null) {
                                TextButton(onClick = onOpenAlertSettings) {
                                    Icon(Icons.Filled.Notifications, contentDescription = "Alert settings")
                                }
                            }
                            if (onOpenAlertHistory != null) {
                                TextButton(onClick = onOpenAlertHistory) {
                                    Icon(Icons.Filled.History, contentDescription = "Alert history")
                                }
                            }
                            TextButton(onClick = {
                                scope.launch {
                                    LocationService.stop(appCtx)
                                    repo.logout()
                                    onLoggedOut()
                                }
                            }) {
                                Icon(Icons.Filled.Logout, contentDescription = "Log out")
                            }
                        }
                    }
                }
            }

            Column(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                membersError?.let { msg ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                        ),
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp).fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    "Can't reach server",
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.labelLarge,
                                )
                                Text(
                                    msg,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            TextButton(onClick = {
                                scope.launch {
                                    membersLoading = true
                                    fetchMembers()
                                    membersLoading = false
                                }
                            }) { Text("Retry") }
                        }
                    }
                }

                if (permissionDenied) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.error.copy(alpha = 0.1f)),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                "Location permission denied.",
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.labelLarge,
                            )
                            Text(
                                "Family Guardian needs location access to share your position with your circle.",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            TextButton(onClick = {
                                fineLocPermission.launch(
                                    arrayOf(
                                        Manifest.permission.ACCESS_FINE_LOCATION,
                                        Manifest.permission.ACCESS_COARSE_LOCATION,
                                    ),
                                )
                            }) { Text("Grant permission") }
                        }
                    }
                } else {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                        ),
                        shape = RoundedCornerShape(20.dp),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    if (serviceStarted) "Sharing location with your circle" else "Starting...",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.secondary,
                                )
                                Spacer(modifier = Modifier.size(8.dp))
                                when (wsState) {
                                    EventStreamClient.ConnectionState.CONNECTED -> {
                                        Text(
                                            "Live",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.secondary,
                                        )
                                    }
                                    EventStreamClient.ConnectionState.CONNECTING -> {
                                        Text(
                                            "Connecting...",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.tertiary,
                                        )
                                    }
                                    EventStreamClient.ConnectionState.DISCONNECTED -> {
                                        Text(
                                            "Disconnected",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.error,
                                        )
                                    }
                                }
                            }
                            Text(
                                "Your last fix is sent every ~30 seconds to your self-hosted server.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                if (activeSosList.isNotEmpty()) {
                    val first = activeSosList.first()
                    val isMine = first.userId == prefs.snapshotBlocking().userId
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                        ),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                if (isMine) "Your SOS is active" else "${first.displayName ?: "Member"} has active SOS",
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                            )
                            Text(
                                "Started ${relativeTimeString(first.startedAt)}" +
                                    if (activeSosList.size > 1) " · ${activeSosList.size - 1} more active" else "",
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                style = MaterialTheme.typography.bodySmall,
                            )
                            if (isMine) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Button(
                                    onClick = {
                                        scope.launch {
                                            resolveInFlight = true
                                            try {
                                                sosRepo.resolve(first.id)
                                                activeSosList = activeSosList.filter { it.id != first.id }
                                            } catch (t: Throwable) { }
                                            resolveInFlight = false
                                        }
                                    },
                                    enabled = !resolveInFlight,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = MaterialTheme.colorScheme.error,
                                        contentColor = MaterialTheme.colorScheme.onError,
                                    ),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(if (resolveInFlight) "Resolving..." else "Resolve SOS")
                                }
                            }
                        }
                    }
                }

                Button(
                    onClick = { if (!checkinInFlight) checkinDialogOpen = true },
                    modifier = Modifier.fillMaxWidth().size(width = 280.dp, height = 48.dp),
                    shape = RoundedCornerShape(24.dp),
                    contentPadding = PaddingValues(horizontal = 24.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    ),
                    enabled = !checkinInFlight,
                ) {
                    Text(
                        if (checkinInFlight) "Sending..." else "Check in",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }

                Button(
                    onClick = { if (!sosInFlight) sosConfirming = true },
                    modifier = Modifier.fillMaxWidth().size(width = 280.dp, height = 64.dp),
                    shape = RoundedCornerShape(32.dp),
                    contentPadding = PaddingValues(horizontal = 24.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                    enabled = !sosInFlight,
                ) {
                    Icon(Icons.Filled.Sos, contentDescription = null)
                    Text(
                        if (sosInFlight) "  Sending..." else "  SOS",
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                    )
                }

                checkinMessage?.let { msg ->
                    Text(
                        text = msg,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }

                sosMessage?.let { msg ->
                    Text(
                        text = msg,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }

                pauseMessage?.let { msg ->
                    Text(
                        text = msg,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@SuppressWarnings("MissingPermission")
private suspend fun oneShotFix(context: Context): Triple<Double, Double, Double?>? {
    val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
        context, Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED || androidx.core.content.ContextCompat.checkSelfPermission(
        context, Manifest.permission.ACCESS_COARSE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED
    if (!hasPermission) return null

    val client = LocationServices.getFusedLocationProviderClient(context)
    val request = CurrentLocationRequest.Builder()
        .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
        .setMaxUpdateAgeMillis(60_000L)
        .build()
    return try {
        suspendCancellableCoroutine { cont ->
            try {
                client.getCurrentLocation(request, null)
                    .addOnSuccessListener { loc ->
                        if (loc != null) {
                            cont.resume(
                                Triple(
                                    loc.latitude,
                                    loc.longitude,
                                    if (loc.hasAccuracy()) loc.accuracy.toDouble() else null,
                                ),
                            )
                        } else cont.resume(null)
                    }
                    .addOnFailureListener { cont.resume(null) }
                    .addOnCanceledListener { cont.resume(null) }
            } catch (sec: SecurityException) {
                cont.resume(null)
            }
        }
    } catch (t: Throwable) { null }
}
