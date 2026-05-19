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
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
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
import com.familyguardian.data.HistoryRepo
import com.familyguardian.data.LocationPoint
import com.familyguardian.data.Prefs
import kotlinx.coroutines.launch
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Polyline
import java.text.SimpleDateFormat
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
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemberDetailScreen(
    member: MemberInfo,
    circleId: Long,
    onBack: () -> Unit,
) {
    val context = LocalContext.current.applicationContext
    val prefs = remember { Prefs(context) }
    val repo = remember { HistoryRepo(prefs) }
    val scope = rememberCoroutineScope()

    var points by remember { mutableStateOf<List<LocationPoint>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedRange by remember { mutableStateOf("24h") }

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
                points = repo.fetch(
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

    LaunchedEffect(selectedRange) { loadHistory(selectedRange) }

    val initials = remember(member.displayName) {
        member.displayName.split(Regex("\\s+"))
            .mapNotNull { it.firstOrNull()?.uppercase() }
            .take(2).joinToString("").ifEmpty { "?" }
    }

    val isActive = member.recordedAt != null &&
        (System.currentTimeMillis() - member.recordedAt) < 5 * 60_000

    val relativeTime = remember(member.recordedAt) {
        if (member.recordedAt == null) "—"
        else {
            val diff = System.currentTimeMillis() - member.recordedAt
            when {
                diff < 60_000 -> "Just now"
                diff < 3_600_000 -> "${diff / 60_000}m ago"
                diff < 86_400_000 -> "${diff / 3_600_000}h ago"
                else -> "${diff / 86_400_000}d ago"
            }
        }
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
            // Member info row
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
                            if (member.lat != null)
                                "${String.format("%.4f", member.lat)}, ${String.format("%.4f", member.lng)}"
                            else "No location yet",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            // Device health chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                DeviceStat(
                    icon = { Icon(Icons.Filled.BatteryFull, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    label = member.batteryPct?.let { "$it%" } ?: "—",
                )
                DeviceStat(
                    icon = { Icon(Icons.Filled.Speed, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    label = member.speedMps?.let { "${String.format("%.1f", it * 3.6)} km/h" } ?: "—",
                )
                DeviceStat(
                    icon = { Icon(Icons.Filled.Schedule, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    label = relativeTime,
                )
            }

            // Time range selector
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
                        onClick = { selectedRange = range },
                        label = { Text(label) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.secondary,
                            selectedLabelColor = MaterialTheme.colorScheme.onSecondary,
                        ),
                    )
                }
            }

            // Status line
            Text(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                text = if (loading) "Loading…" else if (error != null) error!! else "${points.size} data points",
                style = MaterialTheme.typography.labelMedium,
                color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // Map
            AndroidView(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                factory = { ctx ->
                    MapView(ctx).apply {
                        setTileSource(TileSourceFactory.MAPNIK)
                        setMultiTouchControls(true)
                        controller.setZoom(13.0)
                        controller.setCenter(GeoPoint(37.7749, -122.4194))
                    }
                },
                update = { mapView ->
                    mapView.overlays.clear()
                    val geoPoints = points.map { GeoPoint(it.lat, it.lng) }

                    if (geoPoints.size >= 2) {
                        val line = Polyline(mapView).apply {
                            setPoints(geoPoints)
                            outlinePaint.color = 0xFF006C49.toInt()
                            outlinePaint.strokeWidth = 4f
                            outlinePaint.isAntiAlias = true
                        }
                        mapView.overlays.add(line)
                    }

                    // Center on member's last known location or path bounds
                    if (member.lat != null && member.lng != null) {
                        val center = GeoPoint(member.lat, member.lng)
                        if (geoPoints.isEmpty()) {
                            mapView.controller.setCenter(center)
                            mapView.controller.setZoom(14)
                        } else {
                            val allPoints = geoPoints + center
                            val bounds = org.osmdroid.util.BoundingBox.fromGeoPoints(allPoints)
                            mapView.zoomToBoundingBox(bounds, true, 60)
                        }
                    } else if (geoPoints.isNotEmpty()) {
                        val bounds = org.osmdroid.util.BoundingBox.fromGeoPoints(geoPoints)
                        mapView.zoomToBoundingBox(bounds, true, 60)
                    }

                    mapView.invalidate()
                },
            )
        }
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
