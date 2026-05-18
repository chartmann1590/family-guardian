package com.familyguardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.familyguardian.data.Place
import com.familyguardian.data.PlaceBody
import com.familyguardian.data.PlacesRepo
import com.familyguardian.data.Prefs
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlacesScreen(onBack: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val prefs = remember { Prefs(context) }
    val repo = remember { PlacesRepo(prefs) }
    val scope = rememberCoroutineScope()

    val circleId by prefs.circleId.collectAsStateWithLifecycle(initialValue = null)
    var places by remember { mutableStateOf<List<Place>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    var editing by remember { mutableStateOf<Place?>(null) }
    var addingNew by remember { mutableStateOf(false) }

    LaunchedEffect(circleId) {
        val cid = circleId ?: return@LaunchedEffect
        loading = true
        error = null
        try {
            places = repo.list(cid).sortedBy { it.name.lowercase() }
        } catch (t: Throwable) {
            error = t.message ?: "Failed to load places"
        } finally {
            loading = false
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Safety Places", fontWeight = FontWeight.SemiBold) },
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
        floatingActionButton = {
            FloatingActionButton(
                onClick = { addingNew = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(Icons.Filled.Add, contentDescription = "Add place")
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when {
                loading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                error != null -> Text(
                    text = error!!,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                )
                places.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("No safety places yet.", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Tap the + button to add Home, School, or any other place you'd like to be alerted about.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(places, key = { it.id }) { p ->
                        PlaceCard(
                            place = p,
                            onEdit = { editing = p },
                            onDelete = {
                                scope.launch {
                                    try {
                                        repo.delete(p.id)
                                        places = places.filterNot { it.id == p.id }
                                    } catch (t: Throwable) {
                                        error = t.message
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    if (addingNew) {
        PlaceFormDialog(
            initial = null,
            onCancel = { addingNew = false },
            onSave = { body ->
                val cid = circleId ?: return@PlaceFormDialog
                scope.launch {
                    try {
                        val saved = repo.create(cid, body)
                        places = (places + saved).sortedBy { it.name.lowercase() }
                        addingNew = false
                    } catch (t: Throwable) {
                        error = t.message
                    }
                }
            },
        )
    }

    editing?.let { p ->
        PlaceFormDialog(
            initial = p,
            onCancel = { editing = null },
            onSave = { body ->
                scope.launch {
                    try {
                        val updated = repo.update(p.id, body)
                        places = places.map { if (it.id == p.id) updated else it }.sortedBy { it.name.lowercase() }
                        editing = null
                    } catch (t: Throwable) {
                        error = t.message
                    }
                }
            },
        )
    }
}

@Composable
private fun PlaceCard(place: Place, onEdit: () -> Unit, onDelete: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.size(40.dp),
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                        Icon(
                            Icons.Filled.LocationOn,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                Column(modifier = Modifier.padding(start = 12.dp).fillMaxWidth(0.7f)) {
                    Text(place.name, style = MaterialTheme.typography.headlineSmall)
                    Text(
                        place.address ?: "${"%.4f".format(place.lat)}, ${"%.4f".format(place.lng)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${place.radiusM.toInt()} m radius",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                    Row {
                        IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, contentDescription = "Edit") }
                        IconButton(onClick = onDelete) {
                            Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Arrival alerts", modifier = Modifier.fillMaxWidth(0.5f), style = MaterialTheme.typography.bodyMedium)
                Text(
                    if (place.alertsOnEnter) "On" else "Off",
                    color = if (place.alertsOnEnter) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Departure alerts", modifier = Modifier.fillMaxWidth(0.5f), style = MaterialTheme.typography.bodyMedium)
                Text(
                    if (place.alertsOnExit) "On" else "Off",
                    color = if (place.alertsOnExit) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

@Composable
private fun PlaceFormDialog(initial: Place?, onCancel: () -> Unit, onSave: (PlaceBody) -> Unit) {
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var address by remember { mutableStateOf(initial?.address ?: "") }
    var lat by remember { mutableStateOf(initial?.lat?.toString() ?: "") }
    var lng by remember { mutableStateOf(initial?.lng?.toString() ?: "") }
    var radius by remember { mutableStateOf((initial?.radiusM ?: 150.0).toString()) }
    var alertEnter by remember { mutableStateOf(initial?.alertsOnEnter ?: true) }
    var alertExit by remember { mutableStateOf(initial?.alertsOnExit ?: true) }
    var validationError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            Button(
                onClick = {
                    val latD = lat.toDoubleOrNull()
                    val lngD = lng.toDoubleOrNull()
                    val radD = radius.toDoubleOrNull()
                    if (name.isBlank() || latD == null || lngD == null || radD == null || radD <= 0) {
                        validationError = "Name, lat, lng, and a positive radius are required."
                        return@Button
                    }
                    onSave(
                        PlaceBody(
                            name = name.trim(),
                            address = address.trim().takeIf { it.isNotEmpty() },
                            lat = latD,
                            lng = lngD,
                            radiusM = radD,
                            alertsOnEnter = alertEnter,
                            alertsOnExit = alertExit,
                        ),
                    )
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
        title = { Text(if (initial == null) "New safety place" else "Edit place") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(address, { address = it }, label = { Text("Address (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = lat,
                        onValueChange = { lat = it },
                        label = { Text("Latitude") },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(0.5f),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = lng,
                        onValueChange = { lng = it },
                        label = { Text("Longitude") },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                }
                OutlinedTextField(
                    value = radius,
                    onValueChange = { radius = it },
                    label = { Text("Radius (m)") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Arrival alerts", modifier = Modifier.fillMaxWidth(0.65f))
                    Switch(checked = alertEnter, onCheckedChange = { alertEnter = it })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Departure alerts", modifier = Modifier.fillMaxWidth(0.65f))
                    Switch(checked = alertExit, onCheckedChange = { alertExit = it })
                }
                validationError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
    )
}
