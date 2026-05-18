package com.familyguardian.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Sos
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.familyguardian.data.AuthRepo
import com.familyguardian.data.Prefs
import com.familyguardian.data.SosRepo
import com.familyguardian.location.LocationService
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView

@Composable
fun MapScreen(onLoggedOut: () -> Unit, onOpenPlaces: () -> Unit) {
    val context = LocalContext.current
    val appCtx = context.applicationContext
    val prefs = remember { Prefs(appCtx) }
    val repo = remember { AuthRepo(prefs) }
    val sosRepo = remember { SosRepo(prefs) }
    val scope = rememberCoroutineScope()

    val displayName by prefs.displayName.collectAsStateWithLifecycle(initialValue = null)
    var serviceStarted by remember { mutableStateOf(false) }
    var permissionDenied by remember { mutableStateOf(false) }
    var sosConfirming by remember { mutableStateOf(false) }
    var sosInFlight by remember { mutableStateOf(false) }
    var sosMessage by remember { mutableStateOf<String?>(null) }

    val fineLocPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val hasFine = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true
        val hasCoarse = granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (hasFine || hasCoarse) {
            permissionDenied = false
            LocationService.start(appCtx)
            serviceStarted = true
        } else {
            permissionDenied = true
        }
    }

    val notifPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* outcome doesn't gate the flow; service uses a low-importance channel */ }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                appCtx, Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
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

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(modifier = Modifier.fillMaxSize()) {

            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    MapView(ctx).apply {
                        setTileSource(TileSourceFactory.MAPNIK)
                        setMultiTouchControls(true)
                        controller.setZoom(13.0)
                        controller.setCenter(GeoPoint(37.7749, -122.4194))
                    }
                },
            )

            // Top bar
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
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
                            TextButton(onClick = onOpenPlaces) {
                                Icon(Icons.Filled.Place, contentDescription = "Safety places")
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

            // Bottom status / SOS
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
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
                            Text(
                                if (serviceStarted) "Sharing location with your circle" else "Starting…",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.secondary,
                            )
                            Text(
                                "Your last fix is sent every ~30 seconds to your self-hosted server.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                Button(
                    onClick = { if (!sosInFlight) sosConfirming = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .size(width = 280.dp, height = 64.dp),
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
                        if (sosInFlight) "  Sending…" else "  SOS",
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                    )
                }

                sosMessage?.let { msg ->
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

/**
 * Try to get a single high-accuracy fix on demand for SOS. Returns null if the
 * caller doesn't have location permission or no fix is available — the server
 * will fall back to the user's last reported location in that case.
 */
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
