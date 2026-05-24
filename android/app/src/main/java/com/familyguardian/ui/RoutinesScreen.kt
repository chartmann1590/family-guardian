package com.familyguardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import com.familyguardian.data.CreateRoutineRequest
import com.familyguardian.data.Place
import com.familyguardian.data.PlacesRepo
import com.familyguardian.data.Prefs
import com.familyguardian.data.Routine
import com.familyguardian.data.RoutinePrefs
import com.familyguardian.data.RoutinesRepo
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun RoutinesScreen(onBack: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val prefs = remember { Prefs(context) }
    val routinesRepo = remember { RoutinesRepo(prefs) }
    val placesRepo = remember { PlacesRepo(prefs) }
    val scope = rememberCoroutineScope()

    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var routines by remember { mutableStateOf<List<Routine>>(emptyList()) }
    var places by remember { mutableStateOf<List<Place>>(emptyList()) }
    var prefsState by remember { mutableStateOf(RoutinePrefs(routinesEnabled = true)) }
    var quietStartText by remember { mutableStateOf("") }
    var quietEndText by remember { mutableStateOf("") }
    var showAddForm by remember { mutableStateOf(false) }

    suspend fun reload() {
        val snap = prefs.snapshot()
        val myUserId = snap.userId?.toInt() ?: return
        val myCircleId = snap.circleId ?: return
        val routinesResp = routinesRepo.listForMember(myUserId)
        val placesResp = placesRepo.list(myCircleId)
        val p = routinesRepo.getPrefs()
        routines = routinesResp.routines
        places = placesResp
        prefsState = p
        quietStartText = p.quietStart?.let { fmtMinute(it) } ?: ""
        quietEndText = p.quietEnd?.let { fmtMinute(it) } ?: ""
    }

    LaunchedEffect(Unit) {
        try { reload() } catch (t: Throwable) { error = t.message ?: t::class.simpleName }
        loaded = true
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Smart routines") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
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

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { Spacer(Modifier.height(4.dp)) }

            if (error != null) {
                item {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.errorContainer,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            error ?: "",
                            modifier = Modifier.padding(12.dp),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }

            item {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Routine alerts", fontWeight = FontWeight.SemiBold)
                                Text(
                                    "Notify your circle when you break your usual pattern.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(
                                checked = prefsState.routinesEnabled,
                                onCheckedChange = { next ->
                                    val updated = prefsState.copy(routinesEnabled = next)
                                    prefsState = updated
                                    scope.launch { savePrefs(routinesRepo, updated) { error = it } }
                                },
                            )
                        }
                        if (prefsState.routinesEnabled) {
                            Spacer(Modifier.height(8.dp))
                            Text("Quiet hours (no alerts)", style = MaterialTheme.typography.bodySmall)
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                OutlinedTextField(
                                    value = quietStartText,
                                    onValueChange = { quietStartText = it },
                                    label = { Text("From HH:MM") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f),
                                )
                                OutlinedTextField(
                                    value = quietEndText,
                                    onValueChange = { quietEndText = it },
                                    label = { Text("To HH:MM") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            OutlinedButton(
                                onClick = {
                                    val qs = parseMinute(quietStartText)
                                    val qe = parseMinute(quietEndText)
                                    val updated = prefsState.copy(quietStart = qs, quietEnd = qe)
                                    prefsState = updated
                                    scope.launch { savePrefs(routinesRepo, updated) { error = it } }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text("Save quiet hours")
                            }
                        }
                    }
                }
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Your routines",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(
                        onClick = { showAddForm = !showAddForm },
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text(if (showAddForm) "Cancel" else "+ Add")
                    }
                }
            }

            if (showAddForm) {
                item {
                    AddRoutineCard(
                        places = places,
                        saving = saving,
                        onSave = { req ->
                            scope.launch {
                                saving = true
                                try {
                                    routinesRepo.create(Json.encodeToString(req))
                                    showAddForm = false
                                    reload()
                                    error = null
                                } catch (t: Throwable) {
                                    error = t.message ?: t::class.simpleName
                                } finally {
                                    saving = false
                                }
                            }
                        },
                    )
                }
            }

            if (routines.isEmpty()) {
                item {
                    Text(
                        "No routines yet. Your patterns will appear here after about a week of visits to your places.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                }
            } else {
                items(routines.size) { idx ->
                    val r = routines[idx]
                    RoutineCard(
                        routine = r,
                        onToggleActive = { next ->
                            scope.launch {
                                try {
                                    routinesRepo.update(r.id, """{"active":$next}""")
                                    reload()
                                } catch (t: Throwable) {
                                    error = t.message ?: t::class.simpleName
                                }
                            }
                        },
                        onDelete = {
                            scope.launch {
                                try {
                                    routinesRepo.delete(r.id)
                                    reload()
                                } catch (t: Throwable) {
                                    error = t.message ?: t::class.simpleName
                                }
                            }
                        },
                    )
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

private suspend fun savePrefs(
    repo: RoutinesRepo,
    next: RoutinePrefs,
    onError: (String) -> Unit,
) {
    try {
        val qs = next.quietStart?.toString() ?: "null"
        val qe = next.quietEnd?.toString() ?: "null"
        repo.setPrefs("""{"routinesEnabled":${next.routinesEnabled},"quietStart":$qs,"quietEnd":$qe}""")
    } catch (t: Throwable) {
        onError(t.message ?: t::class.simpleName ?: "save failed")
    }
}

@Composable
private fun RoutineCard(
    routine: Routine,
    onToggleActive: (Boolean) -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "${routine.placeName} · ${if (routine.kind == "arrival") "arrives" else "leaves"}",
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "${dayOfWeekShort(routine.dayOfWeek)} · usually ${fmtMinute(routine.expectedMinute)} ± ${routine.toleranceMinutes} min",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val tag = if (routine.source == "manual") "manual" else "auto · ${(routine.confidence * 100).toInt()}%"
                Text(
                    tag,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = routine.active, onCheckedChange = onToggleActive)
            IconButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, contentDescription = "Delete")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun AddRoutineCard(
    places: List<Place>,
    saving: Boolean,
    onSave: (CreateRoutineRequest) -> Unit,
) {
    var selectedPlace by remember { mutableStateOf<Place?>(null) }
    var placeMenuOpen by remember { mutableStateOf(false) }
    var kind by remember { mutableStateOf("arrival") }
    val selectedDays = remember { mutableStateOf(setOf<Int>()) }
    var timeText by remember { mutableStateOf("") }
    var tolerance by remember { mutableStateOf(15f) }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ExposedDropdownMenuBox(
                expanded = placeMenuOpen,
                onExpandedChange = { placeMenuOpen = !placeMenuOpen },
            ) {
                OutlinedTextField(
                    value = selectedPlace?.name ?: "Pick a place",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Place") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = placeMenuOpen) },
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                )
                ExposedDropdownMenu(
                    expanded = placeMenuOpen,
                    onDismissRequest = { placeMenuOpen = false },
                ) {
                    if (places.isEmpty()) {
                        DropdownMenuItem(
                            text = { Text("No places — create one first") },
                            onClick = { placeMenuOpen = false },
                        )
                    }
                    for (p in places) {
                        DropdownMenuItem(
                            text = { Text(p.name) },
                            onClick = {
                                selectedPlace = p
                                placeMenuOpen = false
                            },
                        )
                    }
                }
            }

            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = kind == "arrival",
                    onClick = { kind = "arrival" },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                ) { Text("Arrival") }
                SegmentedButton(
                    selected = kind == "departure",
                    onClick = { kind = "departure" },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                ) { Text("Departure") }
            }

            Text("Days", style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (dow in 0..6) {
                    val on = selectedDays.value.contains(dow)
                    FilterChip(
                        selected = on,
                        onClick = {
                            selectedDays.value = if (on) selectedDays.value - dow else selectedDays.value + dow
                        },
                        label = { Text(dayOfWeekShort(dow)) },
                    )
                }
            }

            OutlinedTextField(
                value = timeText,
                onValueChange = { timeText = it },
                label = { Text("Expected time (HH:MM, 24h)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Text("Tolerance: ${tolerance.toInt()} min")
            Slider(
                value = tolerance,
                onValueChange = { tolerance = it },
                valueRange = 5f..120f,
            )

            Button(
                onClick = {
                    val p = selectedPlace ?: return@Button
                    val minute = parseMinute(timeText) ?: return@Button
                    val days = selectedDays.value.toList().sorted()
                    if (days.isEmpty()) return@Button
                    onSave(
                        CreateRoutineRequest(
                            placeId = p.id.toInt(),
                            kind = kind,
                            daysOfWeek = days,
                            expectedMinute = minute,
                            toleranceMinutes = tolerance.toInt(),
                        )
                    )
                },
                enabled = !saving && selectedPlace != null && parseMinute(timeText) != null && selectedDays.value.isNotEmpty(),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text(if (saving) "Saving..." else "Create routine")
            }
        }
    }
}

private fun fmtMinute(m: Int): String {
    val h = m / 60
    val mm = m % 60
    return "%02d:%02d".format(h, mm)
}

private fun parseMinute(s: String): Int? {
    val parts = s.trim().split(":")
    if (parts.size != 2) return null
    val h = parts[0].toIntOrNull() ?: return null
    val m = parts[1].toIntOrNull() ?: return null
    if (h !in 0..23 || m !in 0..59) return null
    return h * 60 + m
}

private fun dayOfWeekShort(dow: Int): String = when (dow) {
    0 -> "Sun"; 1 -> "Mon"; 2 -> "Tue"; 3 -> "Wed"
    4 -> "Thu"; 5 -> "Fri"; 6 -> "Sat"; else -> "?"
}
