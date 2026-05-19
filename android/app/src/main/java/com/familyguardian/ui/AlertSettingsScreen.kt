package com.familyguardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import com.familyguardian.data.AlertPrefs
import com.familyguardian.data.AlertPrefsRepo
import com.familyguardian.data.Prefs
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlertSettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val prefs = remember { Prefs(context) }
    val repo = remember { AlertPrefsRepo(prefs) }
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var current by remember { mutableStateOf(AlertPrefs()) }

    LaunchedEffect(Unit) {
        try {
            current = repo.get()
        } catch (t: Throwable) {
            error = t.message ?: t::class.simpleName
        } finally {
            loaded = true
        }
    }

    fun save(updated: AlertPrefs) {
        current = updated
        scope.launch {
            saving = true
            try {
                current = repo.update(updated)
                error = null
            } catch (t: Throwable) {
                error = t.message ?: t::class.simpleName
            } finally {
                saving = false
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Alert settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        if (!loaded) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { CircularProgressIndicator() }
            return@Scaffold
        }
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (error != null) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Couldn't save: $error",
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
            }

            ToggleRow(
                title = "Speeding alert",
                subtitle = "Threshold: ${formatSpeed(current.speedingThresholdMps)}",
                checked = current.speedingEnabled,
                onCheckedChange = { save(current.copy(speedingEnabled = it)) },
            )
            if (current.speedingEnabled) {
                // Slider range: 10 - 50 m/s (≈ 22 - 112 mph)
                Slider(
                    value = current.speedingThresholdMps.toFloat(),
                    onValueChange = { current = current.copy(speedingThresholdMps = it.toDouble()) },
                    onValueChangeFinished = { save(current) },
                    valueRange = 10f..50f,
                )
            }

            ToggleRow(
                title = "Low battery alert",
                subtitle = "Notify when battery ≤ ${current.lowBatteryThreshold}%",
                checked = current.lowBatteryEnabled,
                onCheckedChange = { save(current.copy(lowBatteryEnabled = it)) },
            )
            if (current.lowBatteryEnabled) {
                Slider(
                    value = current.lowBatteryThreshold.toFloat(),
                    onValueChange = { current = current.copy(lowBatteryThreshold = it.toInt()) },
                    onValueChangeFinished = { save(current) },
                    valueRange = 5f..50f,
                    steps = 8,
                )
            }

            ToggleRow(
                title = "Offline alert",
                subtitle = "Notify after ${current.offlineMinutes} min without an update",
                checked = current.offlineEnabled,
                onCheckedChange = { save(current.copy(offlineEnabled = it)) },
            )
            if (current.offlineEnabled) {
                Slider(
                    value = current.offlineMinutes.toFloat(),
                    onValueChange = { current = current.copy(offlineMinutes = it.toInt()) },
                    onValueChangeFinished = { save(current) },
                    valueRange = 5f..240f,
                )
            }

            if (saving) {
                Text(
                    "Saving…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = checked, onCheckedChange = onCheckedChange)
        }
    }
}
