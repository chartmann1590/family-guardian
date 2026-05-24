package com.familyguardian.ui

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.familyguardian.data.ApiClient
import com.familyguardian.data.DrivingScore
import com.familyguardian.data.DrivingScoreRepo
import com.familyguardian.data.HistoryRepo
import com.familyguardian.data.LocationPoint
import com.familyguardian.data.Prefs
import com.familyguardian.data.TimelineItem
import com.familyguardian.data.TimelineRepo
import kotlinx.coroutines.launch
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

data class MemberInfo(
    val userId: Long,
    val displayName: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val batteryPct: Int? = null,
    val speedMps: Double? = null,
    val recordedAt: Long? = null,
    val address: String? = null,
)

private val TabTimeline = 0
private val TabMap = 1
private val TabDriving = 2

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemberDetailScreen(
    member: MemberInfo,
    circleId: Long,
    onBack: () -> Unit,
    onOpenVisits: (() -> Unit)? = null,
    onOpenTrips: (() -> Unit)? = null,
) {
    val context = LocalContext.current.applicationContext
    val prefs = remember { Prefs(context) }
    val historyRepo = remember { HistoryRepo(prefs) }
    val timelineRepo = remember { TimelineRepo(prefs) }
    val drivingScoreRepo = remember { DrivingScoreRepo(prefs) }
    val scope = rememberCoroutineScope()

    var selectedTab by remember { mutableStateOf(TabTimeline) }
    var points by remember { mutableStateOf<List<LocationPoint>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedRange by remember { mutableStateOf("24h") }
    var liveMember by remember { mutableStateOf(member) }

    var timelineItems by remember { mutableStateOf<List<TimelineItem>>(emptyList()) }
    var timelineLoading by remember { mutableStateOf(false) }

    var drivingScore by remember { mutableStateOf<DrivingScore?>(null) }
    var drivingDays by remember { mutableStateOf(7) }
    var drivingLoading by remember { mutableStateOf(false) }

    val ranges = listOf("1h", "24h", "7d", "30d")

    fun rangeToMs(range: String): Long {
        val now = System.currentTimeMillis()
        return when (range) {
            "1h" -> now - TimeUnit.HOURS.toMillis(1)
            "24h" -> now - TimeUnit.DAYS.toMillis(1)
            "7d" -> now - TimeUnit.DAYS.toMillis(7)
            "30d" -> now - TimeUnit.DAYS.toMillis(30)
            else -> now - TimeUnit.DAYS.toMillis(1)
        }
    }

    fun loadHistory(range: String) {
        scope.launch {
            loading = true
            error = null
            try {
                points = historyRepo.fetch(
                    circleId = circleId,
                    userId = member.userId,
                    from = rangeToMs(range),
                )
            } catch (t: Throwable) {
                error = t.message ?: "Failed to load history"
            } finally {
                loading = false
            }
        }
    }

    fun loadTimeline() {
        scope.launch {
            timelineLoading = true
            try {
                val resp = timelineRepo.fetch(circleId = circleId, userId = member.userId)
                timelineItems = resp.items
            } catch (_: Throwable) {
            } finally {
                timelineLoading = false
            }
        }
    }

    fun loadDrivingScore(days: Int) {
        scope.launch {
            drivingLoading = true
            try {
                drivingScore = drivingScoreRepo.fetch(userId = member.userId, days = days)
            } catch (_: Throwable) {
            } finally {
                drivingLoading = false
            }
        }
    }

    LaunchedEffect(selectedRange) { loadHistory(selectedRange) }

    LaunchedEffect(selectedTab) {
        when (selectedTab) {
            TabTimeline -> if (timelineItems.isEmpty()) loadTimeline()
            TabDriving -> loadDrivingScore(drivingDays)
        }
    }

    LaunchedEffect(drivingDays) {
        if (selectedTab == TabDriving) loadDrivingScore(drivingDays)
    }

    LaunchedEffect(Unit) {
        try {
            val snap = prefs.snapshot()
            val server = snap.serverUrl ?: return@LaunchedEffect
            val token = snap.token ?: return@LaunchedEffect
            val url = ApiClient.endpoint(server, "/api/circles/$circleId/members")
            val resp = ApiClient.api.listMembers(url, "Bearer $token")
            val found = resp.members.find { it.userId == member.userId }
            if (found != null) {
                liveMember = member.copy(
                    lat = found.lat,
                    lng = found.lng,
                    batteryPct = found.batteryPct,
                    speedMps = found.speedMps,
                    recordedAt = found.recordedAt,
                    address = found.address,
                )
            }
        } catch (_: Throwable) { }
    }

    val initials = remember(member.displayName) {
        member.displayName.split(Regex("\\s+"))
            .mapNotNull { it.firstOrNull()?.uppercase() }
            .take(2).joinToString("").ifEmpty { "?" }
    }

    val recordedAt = liveMember.recordedAt
    val relativeTime = remember(recordedAt) {
        if (recordedAt == null) "—"
        else {
            val diff = System.currentTimeMillis() - recordedAt
            when {
                diff < 60_000 -> "Just now"
                diff < 3_600_000 -> "${diff / 60_000}m ago"
                diff < 86_400_000 -> "${diff / 3_600_000}h ago"
                else -> "${diff / 86_400_000}d ago"
            }
        }
    }

    val mapRef = remember { mutableStateOf<MapView?>(null) }

    DisposableEffect(mapRef.value) {
        onDispose { mapRef.value?.onPause() }
    }

    val mapView = mapRef.value
    val memberLat = liveMember.lat
    val memberLng = liveMember.lng

    LaunchedEffect(points, mapView, memberLat, memberLng) {
        val mv = mapView ?: return@LaunchedEffect
        mv.overlays.clear()
        val geoPoints = points.map { GeoPoint(it.lat, it.lng) }

        if (geoPoints.size >= 2) {
            val line = Polyline(mv).apply {
                setPoints(geoPoints)
                outlinePaint.color = 0xFF006C49.toInt()
                outlinePaint.strokeWidth = 4f
                outlinePaint.isAntiAlias = true
            }
            mv.overlays.add(line)
        }

        if (memberLat != null && memberLng != null) {
            val memberMarker = Marker(mv).apply {
                position = GeoPoint(memberLat, memberLng)
                title = member.displayName
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
            }
            mv.overlays.add(memberMarker)
        }

        if (geoPoints.size >= 1) {
            val startMarker = Marker(mv).apply {
                position = geoPoints.first()
                title = "Start"
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
            }
            mv.overlays.add(startMarker)
        }
        if (geoPoints.size >= 2) {
            val endMarker = Marker(mv).apply {
                position = geoPoints.last()
                title = "End"
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
            }
            mv.overlays.add(endMarker)
        }

        val allGeo = if (memberLat != null && memberLng != null) {
            geoPoints + GeoPoint(memberLat, memberLng)
        } else {
            geoPoints
        }

        if (allGeo.isEmpty()) return@LaunchedEffect

        if (allGeo.size == 1) {
            mv.controller.setCenter(allGeo.first())
            mv.controller.setZoom(15.0)
        } else {
            val minLat = allGeo.minOf { it.latitude }
            val maxLat = allGeo.maxOf { it.latitude }
            val minLon = allGeo.minOf { it.longitude }
            val maxLon = allGeo.maxOf { it.longitude }
            val center = GeoPoint((minLat + maxLat) / 2, (minLon + maxLon) / 2)
            val latSpan = maxLat - minLat
            val lonSpan = maxLon - minLon
            val maxSpan = maxOf(latSpan, lonSpan, 0.001)
            val zoom = when {
                maxSpan < 0.001 -> 17.0
                maxSpan < 0.005 -> 16.0
                maxSpan < 0.01 -> 15.0
                maxSpan < 0.03 -> 14.0
                maxSpan < 0.05 -> 13.0
                maxSpan < 0.1 -> 12.0
                maxSpan < 0.5 -> 10.0
                else -> 8.0
            }
            mv.controller.setCenter(center)
            mv.controller.setZoom(zoom)
        }

        mv.invalidate()
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text(member.displayName, fontWeight = FontWeight.SemiBold) },
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
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 2.dp,
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        modifier = Modifier.size(56.dp),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                            Text(
                                initials,
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                    Spacer(Modifier.width(16.dp))
                    Column {
                        Text(
                            member.displayName,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            liveMember.address
                                ?: if (liveMember.lat != null)
                                    "${String.format("%.4f", liveMember.lat)}, ${String.format("%.4f", liveMember.lng)}"
                                else "No location yet",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                DeviceStat(
                    icon = { Icon(Icons.Filled.BatteryFull, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    label = liveMember.batteryPct?.let { "$it%" } ?: "—",
                )
                DeviceStat(
                    icon = { Icon(Icons.Filled.Speed, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    label = formatSpeed(liveMember.speedMps),
                )
                DeviceStat(
                    icon = { Icon(Icons.Filled.Schedule, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    label = relativeTime,
                )
            }

            if (onOpenVisits != null || onOpenTrips != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (onOpenVisits != null) {
                        androidx.compose.material3.OutlinedButton(
                            onClick = onOpenVisits,
                            modifier = Modifier.weight(1f),
                        ) { Text("Visits") }
                    }
                    if (onOpenTrips != null) {
                        androidx.compose.material3.OutlinedButton(
                            onClick = onOpenTrips,
                            modifier = Modifier.weight(1f),
                        ) { Text("Trips") }
                    }
                }
            }

            val tabs = listOf("Timeline", "Map", "Driving Safety")
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) },
                    )
                }
            }

            when (selectedTab) {
                TabTimeline -> TimelineTab(
                    items = timelineItems,
                    loading = timelineLoading,
                )
                TabMap -> MapTab(
                    ranges = ranges,
                    selectedRange = selectedRange,
                    onRangeSelected = { selectedRange = it },
                    points = points,
                    loading = loading,
                    error = error,
                    mapRef = mapRef,
                )
                TabDriving -> DrivingSafetyTab(
                    score = drivingScore,
                    days = drivingDays,
                    onDaysChanged = { drivingDays = it },
                    loading = drivingLoading,
                )
            }
        }
    }
}

@Composable
private fun TimelineTab(
    items: List<TimelineItem>,
    loading: Boolean,
) {
    if (loading) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text("Loading…", style = MaterialTheme.typography.bodyMedium)
        }
        return
    }

    if (items.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text("No timeline events", style = MaterialTheme.typography.bodyMedium)
        }
        return
    }

    val dayFormat = remember { SimpleDateFormat("EEEE, MMM d", Locale.getDefault()) }
    val timeFormat = remember { SimpleDateFormat("h:mm a", Locale.getDefault()) }

    val grouped = remember(items) {
        val map = linkedMapOf<String, MutableList<TimelineItem>>()
        for (item in items) {
            val day = dayFormat.format(Date(item.at))
            map.getOrPut(day) { mutableListOf() }.add(item)
        }
        map
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        grouped.forEach { (day, dayItems) ->
            item(key = "header_$day") {
                Text(
                    text = day,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            items(dayItems, key = { "tl_${it.at}_${it.kind}" }) { item ->
                TimelineItemRow(item, timeFormat)
            }
        }
    }
}

@Composable
private fun TimelineItemRow(item: TimelineItem, timeFormat: SimpleDateFormat) {
    val (icon, label, detail) = when (item.kind) {
        "visit_started" -> Triple(
            Icons.Filled.MyLocation,
            "Arrived at ${item.payload.placeName ?: "unknown place"}",
            item.payload.placeName ?: "",
        )
        "visit_ended" -> Triple(
            Icons.Filled.MyLocation,
            "Left ${item.payload.placeName ?: "unknown place"}",
            item.payload.placeName ?: "",
        )
        "trip_started" -> Triple(
            Icons.Filled.Speed,
            "Trip started",
            item.payload.mode ?: "",
        )
        "trip_ended" -> Triple(
            Icons.Filled.Speed,
            "Trip ended",
            buildString {
                val d = item.payload.distanceM
                if (d != null) append(String.format("%.1f km", d / 1000.0))
            },
        )
        "check_in" -> Triple(
            Icons.Filled.Schedule,
            "Check-in${item.payload.status?.let { ": $it" } ?: ""}",
            "",
        )
        "routine_deviation" -> Triple(
            Icons.Filled.Schedule,
            "Routine deviation",
            buildString {
                val exp = item.payload.expectedMinute
                val act = item.payload.actualMinute
                if (exp != null && act != null) {
                    val diff = act - exp
                    append("${Math.abs(diff)} min ${if (diff > 0) "late" else "early"}")
                }
            },
        )
        "alert" -> Triple(
            Icons.Filled.BatteryFull,
            "Alert${item.payload.alertKind?.let { ": $it" } ?: ""}",
            buildString {
                val v = item.payload.value
                if (v != null) append(String.format("%.1f", v))
            },
        )
        else -> Triple(Icons.Filled.MyLocation, item.kind, "")
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(40.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    icon,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            if (detail.isNotEmpty()) {
                Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Text(
            timeFormat.format(Date(item.at)),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MapTab(
    ranges: List<String>,
    selectedRange: String,
    onRangeSelected: (String) -> Unit,
    points: List<LocationPoint>,
    loading: Boolean,
    error: String?,
    mapRef: androidx.compose.runtime.MutableState<MapView?>,
) {
    Column(modifier = Modifier.fillMaxSize()) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(ranges) { range ->
            val label = when (range) {
                "1h" -> "1 Hour"
                "24h" -> "24 Hours"
                "7d" -> "7 Days"
                "30d" -> "30 Days"
                else -> range
            }
            FilterChip(
                selected = range == selectedRange,
                onClick = { onRangeSelected(range) },
                label = { Text(label) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.secondary,
                    selectedLabelColor = MaterialTheme.colorScheme.onSecondary,
                ),
            )
        }
    }

    Text(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        text = if (loading) "Loading…" else if (error != null) error!! else "${points.size} data points",
        style = MaterialTheme.typography.labelMedium,
        color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
    )

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .weight(1f)
            .clipToBounds(),
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                MapView(ctx).apply {
                    setTileSource(TileSourceFactory.MAPNIK)
                    setMultiTouchControls(true)
                    setMinZoomLevel(4.0)
                    setMaxZoomLevel(19.0)
                    controller.setZoom(12.0)
                    controller.setCenter(GeoPoint(37.7749, -122.4194))
                    onResume()
                    mapRef.value = this
                }
            },
        )
    }
    }
}

@Composable
private fun DrivingSafetyTab(
    score: DrivingScore?,
    days: Int,
    onDaysChanged: (Int) -> Unit,
    loading: Boolean,
) {
    if (loading) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text("Loading…", style = MaterialTheme.typography.bodyMedium)
        }
        return
    }

    if (score == null) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text("No driving data available", style = MaterialTheme.typography.bodyMedium)
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                listOf(7, 30, 90).forEach { d ->
                    val label = if (d == 7) "7d" else if (d == 30) "30d" else "90d"
                    FilterChip(
                        selected = days == d,
                        onClick = { onDaysChanged(d) },
                        label = { Text(label) },
                        modifier = Modifier.padding(horizontal = 4.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.secondary,
                            selectedLabelColor = MaterialTheme.colorScheme.onSecondary,
                        ),
                    )
                }
            }
        }

        item {
            val raw = score.score ?: 0.0
            val displayScore = raw.toInt()
            val scoreColor = when {
                raw >= 80 -> Color(0xFF4CAF50)
                raw >= 60 -> Color(0xFFFF9800)
                else -> Color(0xFFF44336)
            }
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 2.dp,
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        "Driving Score",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "$displayScore",
                        style = MaterialTheme.typography.displayLarge,
                        fontWeight = FontWeight.Bold,
                        color = scoreColor,
                    )
                    Spacer(Modifier.height(4.dp))
                    val rating = when {
                        raw >= 80 -> "Excellent"
                        raw >= 60 -> "Good"
                        else -> "Needs Improvement"
                    }
                    Text(
                        rating,
                        style = MaterialTheme.typography.bodyMedium,
                        color = scoreColor,
                    )
                }
            }
        }

        item {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "Details",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    DrivingStatRow("Trips", "${score.tripCount}")
                    DrivingStatRow("Distance", String.format("%.1f km", score.distanceM / 1000.0))
                    DrivingStatRow("Hard Brakes", "${score.hardBrakeCount}")
                    if (score.hardBrakeCount > 0) {
                        DrivingStatRow("Brakes / 100 km", String.format("%.1f", score.hardBrakePer100Km))
                    }
                    DrivingStatRow("Speeding time", String.format("%.0f min", score.speedingMinutes))
                    DrivingStatRow("Night driving", String.format("%.0f%%", score.nightDrivingPct))
                }
            }
        }
    }
}

@Composable
private fun DrivingStatRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun DeviceStat(
    icon: @Composable () -> Unit,
    label: String,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            icon()
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
