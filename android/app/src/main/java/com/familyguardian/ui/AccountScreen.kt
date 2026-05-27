package com.familyguardian.ui

import android.app.Activity
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Switch
import androidx.compose.material3.Slider
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.familyguardian.data.AccountRepo
import com.familyguardian.data.ActiveCircleBody
import com.familyguardian.data.AlertPrefs
import com.familyguardian.data.ApiClient
import com.familyguardian.data.AuthRepo
import com.familyguardian.data.CircleInfo
import com.familyguardian.data.CircleMember
import com.familyguardian.data.DigestRepo
import com.familyguardian.data.MembersResponse
import com.familyguardian.data.Prefs
import com.familyguardian.data.TotpDisableBody
import com.familyguardian.data.TotpEnrollConfirmBody
import com.familyguardian.location.LocationService
import kotlinx.coroutines.launch
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    circleId: Long,
    onLoggedOut: () -> Unit,
    onBack: () -> Unit,
    onOpenRoutines: () -> Unit = {},
) {
    val context = LocalContext.current
    val appCtx = context.applicationContext
    val prefs = remember { Prefs(appCtx) }
    val repo = remember { AccountRepo(prefs) }
    val authRepo = remember { AuthRepo(prefs) }
    val scope = rememberCoroutineScope()
    var exporting by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var members by remember { mutableStateOf<List<CircleMember>>(emptyList()) }
    var showPromoteDialog by remember { mutableStateOf(false) }
    var deletePassword by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf(false) }
    var loggingOut by remember { mutableStateOf(false) }
    var signedInAs by remember { mutableStateOf<String?>(null) }
    var readReceiptsEnabled by remember { mutableStateOf(false) }
    var crashDetectionEnabled by remember { mutableStateOf(false) }
    var digestEnabled by remember { mutableStateOf(false) }
    var curfewEnabled by remember { mutableStateOf(false) }
    var lowBatteryAlerts by remember { mutableStateOf(false) }
    var lowBatteryThreshold by remember { mutableStateOf(15f) }
    var totpEnabled by remember { mutableStateOf(false) }
    var showTotpEnrollDialog by remember { mutableStateOf(false) }
    var totpProvisioningUri by remember { mutableStateOf<String?>(null) }
    var totpCode by remember { mutableStateOf("") }
    var totpBackupCodes by remember { mutableStateOf<List<String>?>(null) }
    var showTotpDisableDialog by remember { mutableStateOf(false) }
    var totpDisablePassword by remember { mutableStateOf("") }
    var circles by remember { mutableStateOf<List<CircleInfo>>(emptyList()) }

    LaunchedEffect(Unit) {
        signedInAs = prefs.snapshot().email
        try {
            val s = prefs.snapshot()
            val server = s.serverUrl
            val token = s.token
            if (server != null && token != null) {
                val url = ApiClient.endpoint(server, "/api/users/me")
                val me = ApiClient.api.me(url, "Bearer $token")
                readReceiptsEnabled = me["readReceiptsEnabled"]?.jsonPrimitive?.booleanOrNull == true
                crashDetectionEnabled = me["crashDetectionEnabled"]?.jsonPrimitive?.booleanOrNull == true
            }
        } catch (_: Exception) {}
        try {
            val digestRepo = DigestRepo(prefs)
            val prefs2 = digestRepo.getPrefs()
            if (prefs2 != null) digestEnabled = prefs2.enabled
        } catch (_: Exception) {}
        try {
            val s = prefs.snapshot()
            val server = s.serverUrl; val token = s.token
            if (server != null && token != null) {
                val url = ApiClient.endpoint(server, "/api/users/me/alert-prefs")
                val ap = ApiClient.api.getAlertPrefs(url, "Bearer $token")
                curfewEnabled = ap.curfewEnabled
                lowBatteryAlerts = ap.lowBatteryAlerts
                lowBatteryThreshold = (ap.lowBatteryThresholdPct ?: 15).toFloat()
            }
        } catch (_: Exception) {}
    }

    LaunchedEffect(Unit) {
        try {
            val s = prefs.snapshot()
            val server = s.serverUrl; val token = s.token
            if (server != null && token != null) {
                val url = ApiClient.endpoint(server, "/api/users/me/alert-prefs")
                val ap = ApiClient.api.getAlertPrefs(url, "Bearer $token")
                curfewEnabled = ap.curfewEnabled
                lowBatteryAlerts = ap.lowBatteryAlerts
                lowBatteryThreshold = (ap.lowBatteryThresholdPct ?: 15).toFloat()
            }
        } catch (_: Exception) {}
        try {
            val s = prefs.snapshot()
            val server = s.serverUrl; val token = s.token
            if (server != null && token != null) {
                val url = ApiClient.endpoint(server, "/api/users/me")
                val me = ApiClient.api.me(url, "Bearer $token")
                totpEnabled = me["totpEnabled"]?.jsonPrimitive?.booleanOrNull == true
            }
        } catch (_: Exception) {}
        try {
            val s = prefs.snapshot()
            val server = s.serverUrl; val token = s.token
            if (server != null && token != null) {
                val url = ApiClient.endpoint(server, "/api/users/me/circles")
                circles = ApiClient.api.getCircles(url, "Bearer $token").circles
            }
        } catch (_: Exception) {}
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Account") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { inner ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(inner).padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Spacer(Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Text("Signed in", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            signedInAs ?: "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    loggingOut = true
                                    try {
                                        LocationService.stop(appCtx)
                                        authRepo.logout()
                                        onLoggedOut()
                                    } catch (e: Exception) {
                                        Toast.makeText(context, "Logout failed: ${e.message}", Toast.LENGTH_LONG).show()
                                    } finally {
                                        loggingOut = false
                                    }
                                }
                            },
                            enabled = !loggingOut,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text(if (loggingOut) "Logging out..." else "Log out")
                        }
                    }
                }
            }

            item {
                Text("Read receipts", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "When ON, people who also enable receipts will see when you've read their messages.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            try {
                                val s = prefs.snapshot()
                                val server = s.serverUrl ?: return@launch
                                val token = s.token ?: return@launch
                                val url = ApiClient.endpoint(server, "/api/users/me")
                                val next = !readReceiptsEnabled
                                val body = """{"readReceiptsEnabled":$next}"""
                                    .toRequestBody("application/json".toMediaType())
                                ApiClient.okHttp.newCall(
                                    okhttp3.Request.Builder()
                                        .url(url)
                                        .patch(body)
                                        .header("Authorization", "Bearer $token")
                                        .build()
                                ).execute()
                                readReceiptsEnabled = next
                            } catch (_: Exception) {}
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(if (readReceiptsEnabled) "Read receipts: ON" else "Read receipts: OFF")
                }
            }

            item {
                Text("Crash detection (auto-SOS)", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "When ON, Family Guardian uses your phone's motion sensor to detect possible crashes and alerts your circle if you don't dismiss the countdown.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            try {
                                val s = prefs.snapshot()
                                val server = s.serverUrl ?: return@launch
                                val token = s.token ?: return@launch
                                val url = ApiClient.endpoint(server, "/api/users/me")
                                val next = !crashDetectionEnabled
                                val body = """{"crashDetectionEnabled":$next}"""
                                    .toRequestBody("application/json".toMediaType())
                                ApiClient.okHttp.newCall(
                                    okhttp3.Request.Builder()
                                        .url(url)
                                        .patch(body)
                                        .header("Authorization", "Bearer $token")
                                        .build()
                                ).execute()
                                crashDetectionEnabled = next
                                prefs.setCrashDetectionEnabled(next)
                            } catch (_: Exception) {}
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(if (crashDetectionEnabled) "Crash detection: ON" else "Crash detection: OFF")
                }
            }

            item {
                Text("Smart routines", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Manage learned arrival/departure patterns and deviation alerts.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onOpenRoutines,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text("Open routines")
                }
            }

            item {
                Text("Weekly digest", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Receive a weekly summary of your family's activity including total distance, busiest places, and member stats.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            try {
                                val digestRepo = DigestRepo(prefs)
                                val result = digestRepo.setEnabled(!digestEnabled)
                                if (result != null) digestEnabled = result.enabled
                            } catch (_: Exception) {}
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(if (digestEnabled) "Weekly digest: ON" else "Weekly digest: OFF")
                }
            }

            item {
                Text("Curfew alerts", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Alert your circle if you're not at home during set hours.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Enable", modifier = Modifier.weight(1f))
                    Switch(checked = curfewEnabled, onCheckedChange = { next ->
                        curfewEnabled = next
                        scope.launch {
                            try {
                                val s = prefs.snapshot()
                                val url = ApiClient.endpoint(s.serverUrl!!, "/api/users/me/alert-prefs")
                                ApiClient.api.patchAlertPrefs(url, "Bearer ${s.token!!}", AlertPrefs(curfewEnabled = next))
                            } catch (_: Exception) {}
                        }
                    })
                }
            }

            item {
                Text("Low-battery alerts", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Notify your circle when your battery drops below a threshold.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Enable", modifier = Modifier.weight(1f))
                    Switch(checked = lowBatteryAlerts, onCheckedChange = { next ->
                        lowBatteryAlerts = next
                        scope.launch {
                            try {
                                val s = prefs.snapshot()
                                val url = ApiClient.endpoint(s.serverUrl!!, "/api/users/me/alert-prefs")
                                ApiClient.api.patchAlertPrefs(url, "Bearer ${s.token!!}", AlertPrefs(lowBatteryAlerts = next))
                            } catch (_: Exception) {}
                        }
                    })
                }
                if (lowBatteryAlerts) {
                    Text("Threshold: ${lowBatteryThreshold.toInt()}%")
                    Slider(
                        value = lowBatteryThreshold,
                        onValueChange = { lowBatteryThreshold = it },
                        valueRange = 5f..50f,
                        onValueChangeFinished = {
                            scope.launch {
                                try {
                                    val s = prefs.snapshot()
                                    val url = ApiClient.endpoint(s.serverUrl!!, "/api/users/me/alert-prefs")
                                    ApiClient.api.patchAlertPrefs(url, "Bearer ${s.token!!}", AlertPrefs(lowBatteryThresholdPct = lowBatteryThreshold.toInt()))
                                } catch (_: Exception) {}
                            }
                        },
                    )
                }
            }

            item {
                Text("Emergency contacts", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "People outside your circle who get notified on SOS. They won't see your location.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { /* Navigate to emergency contacts screen */ },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text("Manage emergency contacts")
                }
            }

            item {
                Text("Two-factor authentication", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    if (totpEnabled) "Your account is protected with an authenticator app." else "Add a second factor using an authenticator app (TOTP).",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        if (totpEnabled) {
                            showTotpDisableDialog = true
                        } else {
                            scope.launch {
                                try {
                                    val s = prefs.snapshot()
                                    val url = ApiClient.endpoint(s.serverUrl!!, "/api/users/me/totp/enroll-start")
                                    val resp = ApiClient.api.totpEnrollStart(url, "Bearer ${s.token!!}")
                                    totpProvisioningUri = resp.provisioningUri
                                    showTotpEnrollDialog = true
                                } catch (e: Exception) {
                                    Toast.makeText(context, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(if (totpEnabled) "Disable 2FA" else "Enable 2FA")
                }
            }

            if (circles.size > 1) {
                item {
                    Text("Switch circle", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "You belong to ${circles.size} circles. Switch to change which one is active.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    for (c in circles) {
                        val isCurrent = c.circleId.toLong() == circleId
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    try {
                                        val s = prefs.snapshot()
                                        val url = ApiClient.endpoint(s.serverUrl!!, "/api/users/me/active-circle")
                                        ApiClient.api.setActiveCircle(url, "Bearer ${s.token!!}", ActiveCircleBody(circleId = c.circleId))
                                        Toast.makeText(context, "Switched to ${c.name ?: "Circle"}", Toast.LENGTH_SHORT).show()
                                    } catch (e: Exception) {
                                        Toast.makeText(context, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            enabled = !isCurrent,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text("${c.name ?: "Circle"} (${c.role})${if (isCurrent) " — active" else ""}")
                        }
                    }
                }
            }

            item {
                Text(
                    "Download a JSON file containing all your location history, messages, check-ins, and other data.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            exporting = true
                            try {
                                repo.exportData(context)
                                Toast.makeText(context, "Export saved to Downloads", Toast.LENGTH_LONG).show()
                            } catch (e: Exception) {
                                Toast.makeText(context, "Export failed: ${e.message}", Toast.LENGTH_LONG).show()
                            } finally {
                                exporting = false
                            }
                        }
                    },
                    enabled = !exporting,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(if (exporting) "Exporting..." else "Export my data")
                }
            }

            item {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Text("Delete account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onErrorContainer)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Permanently delete your account and all associated data. This cannot be undone.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.8f),
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(
                            onClick = { showDeleteDialog = true },
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = MaterialTheme.colorScheme.error,
                                contentColor = MaterialTheme.colorScheme.onError,
                            ),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Delete my account")
                        }
                    }
                }
            }
        }
    }

    if (showTotpEnrollDialog) {
        AlertDialog(
            onDismissRequest = { showTotpEnrollDialog = false; totpCode = ""; totpProvisioningUri = null },
            title = { Text("Set up 2FA") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    totpProvisioningUri?.let { uri ->
                        Text("Scan this URI in your authenticator app:", style = MaterialTheme.typography.bodyMedium)
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                        ) {
                            Text(uri, modifier = Modifier.padding(8.dp), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    OutlinedTextField(
                        value = totpCode,
                        onValueChange = { totpCode = it },
                        label = { Text("6-digit code") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    totpBackupCodes?.let { codes ->
                        Text("Backup codes (save these!):", fontWeight = FontWeight.SemiBold)
                        Text(codes.joinToString(", "), style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            try {
                                val s = prefs.snapshot()
                                val url = ApiClient.endpoint(s.serverUrl!!, "/api/users/me/totp/enroll-confirm")
                                val resp = ApiClient.api.totpEnrollConfirm(url, "Bearer ${s.token!!}", TotpEnrollConfirmBody(code = totpCode))
                                totpBackupCodes = resp.backupCodes
                                totpEnabled = true
                                if (totpBackupCodes != null) {
                                    Toast.makeText(context, "2FA enabled! Save your backup codes.", Toast.LENGTH_LONG).show()
                                }
                            } catch (e: Exception) {
                                Toast.makeText(context, "Invalid code: ${e.message}", Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    enabled = totpCode.length == 6,
                ) { Text("Confirm") }
            },
            dismissButton = {
                TextButton(onClick = { showTotpEnrollDialog = false; totpCode = ""; totpProvisioningUri = null }) {
                    Text("Cancel")
                }
            },
        )
    }

    if (showTotpDisableDialog) {
        AlertDialog(
            onDismissRequest = { showTotpDisableDialog = false; totpDisablePassword = "" },
            title = { Text("Disable 2FA") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Enter your password to disable two-factor authentication.")
                    OutlinedTextField(
                        value = totpDisablePassword,
                        onValueChange = { totpDisablePassword = it },
                        label = { Text("Password") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            try {
                                val s = prefs.snapshot()
                                val url = ApiClient.endpoint(s.serverUrl!!, "/api/users/me/totp/disable")
                                ApiClient.api.totpDisable(url, "Bearer ${s.token!!}", TotpDisableBody(password = totpDisablePassword))
                                totpEnabled = false
                                showTotpDisableDialog = false
                                Toast.makeText(context, "2FA disabled", Toast.LENGTH_SHORT).show()
                            } catch (e: Exception) {
                                Toast.makeText(context, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    enabled = totpDisablePassword.isNotBlank(),
                ) { Text("Disable", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showTotpDisableDialog = false; totpDisablePassword = "" }) {
                    Text("Cancel")
                }
            },
        )
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false; deletePassword = "" },
            title = { Text("Confirm deletion") },
            text = {
                Column {
                    Text("Enter your password to confirm.")
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = deletePassword,
                        onValueChange = { deletePassword = it },
                        label = { Text("Password") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            deleting = true
                            try {
                                repo.deleteAccount(deletePassword)
                                prefs.clearSession()
                                showDeleteDialog = false
                                onLoggedOut()
                            } catch (e: AccountRepo.AdminHandoffRequired) {
                                showDeleteDialog = false
                                showPromoteDialog = true
                            } catch (e: AccountRepo.WrongPassword) {
                                Toast.makeText(context, "Wrong password", Toast.LENGTH_SHORT).show()
                            } catch (e: Exception) {
                                Toast.makeText(context, "Failed: ${e.message}", Toast.LENGTH_LONG).show()
                            } finally {
                                deleting = false
                            }
                        }
                    },
                    enabled = !deleting && deletePassword.isNotBlank(),
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false; deletePassword = "" }) {
                    Text("Cancel")
                }
            },
        )
    }

    if (showPromoteDialog) {
        val others = members.filter { it.userId != prefs.snapshotBlocking().userId }
        AlertDialog(
            onDismissRequest = { showPromoteDialog = false },
            title = { Text("Admin handoff required") },
            text = {
                if (others.isEmpty()) {
                    Text("You are the sole admin and the only member. You can delete your account, but the circle will be removed.")
                } else {
                    Column {
                        Text("Promote another member to admin, then retry deletion.")
                        Spacer(Modifier.height(12.dp))
                        for (m in others) {
                            OutlinedButton(
                                onClick = {
                                    scope.launch {
                                        try {
                                            repo.promoteAdmin(circleId, m.userId)
                                            Toast.makeText(context, "${m.displayName} is now an admin.", Toast.LENGTH_SHORT).show()
                                            showPromoteDialog = false
                                        } catch (e: Exception) {
                                            Toast.makeText(context, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text("Promote ${m.displayName}")
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showPromoteDialog = false }) {
                    Text("OK")
                }
            },
        )
    }
}
