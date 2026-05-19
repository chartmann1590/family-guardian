package com.familyguardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.DirectionsWalk
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.familyguardian.data.Prefs
import com.familyguardian.data.Trip
import com.familyguardian.data.TripsRepo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripsScreen(circleId: Long, userId: Long, displayName: String, onBack: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val prefs = remember { Prefs(context) }
    val repo = remember { TripsRepo(prefs) }
    var trips by remember { mutableStateOf<List<Trip>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(circleId, userId) {
        loading = true
        error = null
        try {
            val sevenDaysAgo = System.currentTimeMillis() - 7L * 24 * 3600_000
            trips = repo.listForMember(circleId, userId, from = sevenDaysAgo)
        } catch (t: Throwable) {
            error = t.message ?: t::class.simpleName
        } finally {
            loading = false
        }
    }

    val df = remember { SimpleDateFormat("EEE MMM d, h:mm a", Locale.getDefault()) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("$displayName's trips") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                error != null -> Text(
                    "Couldn't load trips: $error",
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.error,
                )
                trips.isEmpty() -> Text(
                    "No trips in the last 7 days.",
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(trips) { t ->
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(12.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    if (t.mode == "driving") Icons.Filled.DirectionsCar else Icons.Filled.DirectionsWalk,
                                    contentDescription = null,
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        t.endLabel ?: t.startLabel ?: t.mode.replaceFirstChar { it.uppercase() },
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        df.format(Date(t.startedAt)),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    val parts = buildList {
                                        add(formatDistance(t.distanceM))
                                        add(formatDuration(t.durationMs))
                                        t.maxSpeedMps?.let { add("max " + formatSpeed(it)) }
                                    }
                                    Text(
                                        parts.joinToString(" • "),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
