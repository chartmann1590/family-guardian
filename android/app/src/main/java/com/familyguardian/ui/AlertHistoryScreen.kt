package com.familyguardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import com.familyguardian.data.AlertEvent
import com.familyguardian.data.AlertsRepo
import com.familyguardian.data.Prefs
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlertHistoryScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { Prefs(context.applicationContext) }
    val repo = remember { AlertsRepo(prefs) }
    var alerts by remember { mutableStateOf<List<AlertEvent>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val cid = prefs.snapshot().circleId ?: return@LaunchedEffect
            alerts = repo.list(cid)
        } catch (t: Throwable) {
            error = t.message ?: "Failed to load alerts"
        } finally {
            loading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Alert History") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
        ) {
            if (loading) {
                Text("Loading...", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (error != null) {
                Text(error ?: "Unknown error", color = MaterialTheme.colorScheme.error)
            } else if (alerts.isEmpty()) {
                Text("No alerts yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(alerts) { alert ->
                        AlertCard(alert)
                    }
                }
            }
        }
    }
}

@Composable
private fun AlertCard(alert: AlertEvent) {
    val (icon, label, color) = when (alert.type) {
        "speeding" -> Triple("directions_car", "Speeding", MaterialTheme.colorScheme.error)
        "low_battery" -> Triple("battery_alert", "Low Battery", MaterialTheme.colorScheme.tertiary)
        "offline" -> Triple("wifi_off", "Offline", MaterialTheme.colorScheme.onSurfaceVariant)
        else -> Triple("notifications", alert.type, MaterialTheme.colorScheme.primary)
    }
    val df = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier.padding(12.dp).fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                        color = color,
                    )
                    Spacer(modifier = Modifier.size(4.dp))
                    Text(
                        alert.displayName ?: "Unknown",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Text(
                    df.format(Date(alert.createdAt)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (alert.value != null) {
                    Text(
                        when (alert.type) {
                            "speeding" -> formatSpeed(alert.value)
                            "low_battery" -> "${alert.value.toInt()}%"
                            "offline" -> "${alert.value.toInt()} min"
                            else -> alert.value.toString()
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = color,
                    )
                }
            }
        }
    }
}
