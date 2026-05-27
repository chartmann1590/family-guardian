package com.familyguardian.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.DirectionsWalk
import androidx.compose.material.icons.filled.TipsAndUpdates
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.familyguardian.data.DrivingScore
import com.familyguardian.data.Prefs
import com.familyguardian.data.Trip
import com.familyguardian.data.TripsRepo
import com.familyguardian.events.EventBus
import com.familyguardian.events.GuardianEvent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    var score by remember { mutableStateOf<DrivingScore?>(null) }
    var scoreDays by remember { mutableStateOf(7) }

    suspend fun loadScore(days: Int) {
        scoreDays = days
        try { score = repo.drivingScore(userId, days) } catch (_: Exception) {}
    }

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
        loadScore(7)
    }

    LaunchedEffect(Unit) {
        EventBus.events.collect { ev ->
            if (ev is GuardianEvent.DrivingScoreUpdated && ev.userId == userId) {
                try { score = repo.drivingScore(userId, scoreDays) } catch (_: Exception) {}
            }
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
                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item {
                        DrivingScoreCard(score = score, selectedDays = scoreDays) { days ->
                            scoreDays = days
                        }
                    }
                    if (trips.isEmpty()) {
                        item {
                            Text(
                                "No trips in the last 7 days.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
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
                        t.coachingJson?.let { json ->
                            CoachingCard(coachingJson = json)
                        }
                    }
                }
            }
        }
    }
}

private val coachingJsonParser = Json { ignoreUnknownKeys = true }

@Composable
private fun CoachingCard(coachingJson: String) {
    val data = remember(coachingJson) {
        try {
            coachingJsonParser.parseToJsonElement(coachingJson).jsonObject
        } catch (_: Exception) { null }
    }
    if (data == null) return

    val level = data["level"]?.jsonPrimitive?.content ?: return
    val tips = data["tips"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
    val strengths = data["strengths"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()

    val borderColor = when (level) {
        "green" -> Color(0xFF2E7D32)
        "yellow" -> Color(0xFFF57F17)
        "red" -> Color(0xFFC62828)
        else -> Color.Gray
    }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth().background(borderColor, RoundedCornerShape(12.dp)).padding(1.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(
                    Icons.Filled.TipsAndUpdates,
                    contentDescription = null,
                    tint = borderColor,
                    modifier = Modifier.size(18.dp),
                )
                Text("Trip coaching", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
            if (tips.isNotEmpty()) {
                Text("Tips:", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (tip in tips) {
                    Text("• $tip", style = MaterialTheme.typography.bodySmall)
                }
            }
            if (strengths.isNotEmpty()) {
                Text("Strengths:", style = MaterialTheme.typography.labelMedium, color = Color(0xFF2E7D32))
                for (s in strengths) {
                    Text("• $s", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun DrivingScoreCard(score: DrivingScore?, selectedDays: Int, onDaysChanged: (Int) -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
        tonalElevation = 2.dp,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Driving Safety", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (d in listOf(7, 30, 90)) {
                        val selected = d == selectedDays
                        Surface(
                            shape = RoundedCornerShape(50),
                            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                            modifier = Modifier.clickable { onDaysChanged(d) },
                        ) {
                            Text(
                                "${d}d",
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 12.sp,
                            )
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            if (score == null || score.score == null) {
                Text("Not enough driving data.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                val scoreColor = when {
                    score.score >= 80 -> Color(0xFF2E7D32)
                    score.score >= 60 -> Color(0xFFF57F17)
                    else -> Color(0xFFC62828)
                }
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "${Math.round(score.score)}",
                        fontSize = 48.sp,
                        fontWeight = FontWeight.Black,
                        color = scoreColor,
                    )
                    Text(
                        "/ 100",
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Hard brakes", style = MaterialTheme.typography.bodySmall)
                    Text(
                        "${score.hardBrakeCount} (${String.format("%.1f", score.hardBrakePer100Km)} / 100km)",
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Speeding", style = MaterialTheme.typography.bodySmall)
                    Text(
                        "${String.format("%.1f", score.speedingMinutes)} min",
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Night driving", style = MaterialTheme.typography.bodySmall)
                    Text(
                        "${(score.nightDrivingPct * 100).toInt()}%",
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
