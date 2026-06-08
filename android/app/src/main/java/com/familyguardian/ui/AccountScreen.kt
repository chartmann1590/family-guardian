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

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.familyguardian.BuildConfig
import com.familyguardian.data.BugReport
import com.familyguardian.data.BugReportRepo
import com.familyguardian.data.CreateIssueRequest
import com.familyguardian.data.DiagnosticsHelper
import com.familyguardian.data.GithubClient
import com.familyguardian.data.GithubComment
import com.familyguardian.data.PostCommentRequest
import com.familyguardian.data.UploadAssetRequest



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

    val bugReportRepo = remember { BugReportRepo(appCtx) }
    val localBugReports by bugReportRepo.bugReports.collectAsStateWithLifecycle(initialValue = emptyList())
    var showReportDialog by remember { mutableStateOf(false) }
    var selectedIssueForDetail by remember { mutableStateOf<BugReport?>(null) }


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
            val currentList = bugReportRepo.getBugReportsList()
            if (currentList.isNotEmpty()) {
                val updatedList = currentList.map { report ->
                    try {
                        val authHeader = "Bearer ${BuildConfig.GITHUB_API_TOKEN}"
                        val latest = GithubClient.api.getIssue(
                            auth = authHeader,
                            owner = BuildConfig.GITHUB_REPO_OWNER,
                            repo = BuildConfig.GITHUB_REPO_NAME,
                            number = report.number
                        )
                        report.copy(status = latest.state)
                    } catch (e: Exception) {
                        report
                    }
                }
                bugReportRepo.updateBugReports(updatedList)
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
                Text("Support & Feedback", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Submit feedback or report bugs. You can also view and participate in discussion threads for your submitted reports.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))

                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        OutlinedButton(
                            onClick = { showReportDialog = true },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Icon(Icons.Default.BugReport, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Report a Problem")
                        }

                        if (localBugReports.isNotEmpty()) {
                            Spacer(Modifier.height(16.dp))
                            Text(
                                "Your Submitted Reports",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(Modifier.height(8.dp))
                            localBugReports.forEach { report ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { selectedIssueForDetail = report }
                                        .padding(vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            report.title,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium,
                                            maxLines = 1,
                                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                                        )
                                        Text(
                                            "Issue #${report.number} • ${report.createdAt.take(10)}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                                        )
                                    }
                                    Spacer(Modifier.width(8.dp))
                                    val isOpen = report.status.lowercase() == "open"
                                    val badgeColor = if (isOpen) androidx.compose.ui.graphics.Color(0xFF2E7D32) else androidx.compose.ui.graphics.Color(0xFFC62828)
                                    val badgeText = if (isOpen) "Open" else "Closed"
                                    Surface(
                                        color = badgeColor.copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(8.dp),
                                        modifier = Modifier.border(1.dp, badgeColor.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                                    ) {
                                        Text(
                                            text = badgeText,
                                            color = badgeColor,
                                            style = MaterialTheme.typography.bodySmall,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }
                            }
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

    if (showReportDialog) {
        var title by remember { mutableStateOf("") }
        var description by remember { mutableStateOf("") }
        var name by remember { mutableStateOf("") }
        var email by remember { mutableStateOf("") }
        var includeDiagnostics by remember { mutableStateOf(true) }
        var screenshotUri by remember { mutableStateOf<Uri?>(null) }
        var submitting by remember { mutableStateOf(false) }

        val photoPickerLauncher = rememberLauncherForActivityResult(
            contract = ActivityResultContracts.PickVisualMedia()
        ) { uri ->
            screenshotUri = uri
        }

        AlertDialog(
            onDismissRequest = { if (!submitting) showReportDialog = false },
            title = { Text("Report a Problem") },
            text = {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(max = 450.dp)
                ) {
                    item {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.errorContainer,
                            modifier = Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.error, RoundedCornerShape(12.dp))
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(
                                    "Warning: Public Forum",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onErrorContainer
                                )
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    "Anything you submit here, including descriptions, screenshots, and system info, will be publicly visible on the GitHub repository issue tracker.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onErrorContainer
                                )
                            }
                        }
                    }

                    item {
                        OutlinedTextField(
                            value = title,
                            onValueChange = { title = it },
                            label = { Text("Title / Subject") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !submitting
                        )
                    }

                    item {
                        OutlinedTextField(
                            value = description,
                            onValueChange = { description = it },
                            label = { Text("Description") },
                            minLines = 3,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !submitting
                        )
                    }

                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.clickable(enabled = !submitting) { includeDiagnostics = !includeDiagnostics }
                        ) {
                            Checkbox(
                                checked = includeDiagnostics,
                                onCheckedChange = { includeDiagnostics = it },
                                enabled = !submitting
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("Include phone system info and models", style = MaterialTheme.typography.bodyMedium)
                        }
                    }

                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    photoPickerLauncher.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                    )
                                },
                                enabled = !submitting,
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(Icons.Default.AddPhotoAlternate, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("Attach Screenshot")
                            }

                            screenshotUri?.let { uri ->
                                Box(
                                    modifier = Modifier
                                        .size(64.dp)
                                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                                ) {
                                    AsyncImage(
                                        model = uri,
                                        contentDescription = "Screenshot Preview",
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = androidx.compose.ui.layout.ContentScale.Crop
                                    )
                                    Surface(
                                        color = androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.6f),
                                        shape = CircleShape,
                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .padding(4.dp)
                                            .size(16.dp)
                                            .clickable { screenshotUri = null }
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Close,
                                            contentDescription = "Remove",
                                            tint = androidx.compose.ui.graphics.Color.White,
                                            modifier = Modifier.size(10.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    item {
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it },
                            label = { Text("Your Name (Optional)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !submitting
                        )
                    }

                    item {
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("Your Email (Optional)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !submitting
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            submitting = true
                            try {
                                val authHeader = "Bearer ${BuildConfig.GITHUB_API_TOKEN}"
                                val owner = BuildConfig.GITHUB_REPO_OWNER
                                val repoName = BuildConfig.GITHUB_REPO_NAME

                                var finalDescription = description
                                if (name.isNotBlank() || email.isNotBlank()) {
                                    finalDescription += "\n\n---\n**Reporter Info:**"
                                    if (name.isNotBlank()) finalDescription += "\n- **Name:** $name"
                                    if (email.isNotBlank()) finalDescription += "\n- **Email:** $email"
                                }

                                // Handle screenshot upload
                                screenshotUri?.let { uri ->
                                    val base64Content = DiagnosticsHelper.uriToBase64(appCtx, uri)
                                    if (base64Content != null) {
                                        val filename = "screenshot_${System.currentTimeMillis()}.png"
                                        val uploadResp = GithubClient.api.uploadAsset(
                                            auth = authHeader,
                                            owner = owner,
                                            repo = repoName,
                                            filename = filename,
                                            body = UploadAssetRequest(
                                                message = "Upload screenshot feedback asset",
                                                content = base64Content
                                            )
                                        )
                                        finalDescription += "\n\n![Screenshot](${uploadResp.content.download_url})"
                                    }
                                }

                                // Handle diagnostics check
                                if (includeDiagnostics) {
                                    val sysInfo = DiagnosticsHelper.collectSystemInfo(appCtx)
                                    val serverUrlVal = prefs.snapshot().serverUrl
                                    val models = DiagnosticsHelper.detectOllamaModels(serverUrlVal)

                                    val modelsMarkdown = if (models.isEmpty()) {
                                        "*No models detected.*"
                                    } else {
                                        models.joinToString("\n") { (name, onDevice) ->
                                            "- `$name` (${if (onDevice) "On-Device" else "Remote"})"
                                        }
                                    }

                                    finalDescription += "\n\n---\n$sysInfo\n\n### Running Models\n$modelsMarkdown"
                                }

                                val issueResp = GithubClient.api.createIssue(
                                    auth = authHeader,
                                    owner = owner,
                                    repo = repoName,
                                    body = CreateIssueRequest(
                                        title = title,
                                        body = finalDescription
                                    )
                                )

                                val savedReport = BugReport(
                                    number = issueResp.number,
                                    title = issueResp.title,
                                    status = issueResp.state,
                                    createdAt = issueResp.created_at,
                                    htmlUrl = issueResp.html_url
                                )
                                bugReportRepo.saveBugReport(savedReport)

                                Toast.makeText(context, "Problem reported successfully", Toast.LENGTH_SHORT).show()
                                showReportDialog = false
                            } catch (e: Exception) {
                                Toast.makeText(context, "Failed to report issue: ${e.message}", Toast.LENGTH_LONG).show()
                            } finally {
                                submitting = false
                            }
                        }
                    },
                    enabled = title.isNotBlank() && description.isNotBlank() && !submitting
                ) {
                    if (submitting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Submit")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { showReportDialog = false }, enabled = !submitting) {
                    Text("Cancel")
                }
            }
        )
    }

    if (selectedIssueForDetail != null) {
        val currentIssue = selectedIssueForDetail!!
        var comments by remember { mutableStateOf<List<GithubComment>>(emptyList()) }
        var issueDetailBody by remember { mutableStateOf("") }
        var loadingDetail by remember { mutableStateOf(false) }
        var replyText by remember { mutableStateOf("") }
        var replyScreenshotUri by remember { mutableStateOf<Uri?>(null) }
        var postingReply by remember { mutableStateOf(false) }

        val replyPhotoPickerLauncher = rememberLauncherForActivityResult(
            contract = ActivityResultContracts.PickVisualMedia()
        ) { uri ->
            replyScreenshotUri = uri
        }

        LaunchedEffect(currentIssue) {
            loadingDetail = true
            try {
                val authHeader = "Bearer ${BuildConfig.GITHUB_API_TOKEN}"
                val owner = BuildConfig.GITHUB_REPO_OWNER
                val repoName = BuildConfig.GITHUB_REPO_NAME

                val fullIssue = GithubClient.api.getIssue(authHeader, owner, repoName, currentIssue.number)
                issueDetailBody = fullIssue.body ?: ""

                if (fullIssue.state != currentIssue.status) {
                    bugReportRepo.saveBugReport(currentIssue.copy(status = fullIssue.state))
                }

                comments = GithubClient.api.getComments(authHeader, owner, repoName, currentIssue.number)
            } catch (e: Exception) {
                Toast.makeText(context, "Failed to load thread: ${e.message}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingDetail = false
            }
        }

        AlertDialog(
            onDismissRequest = { if (!postingReply) selectedIssueForDetail = null },
            title = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(currentIssue.title, style = MaterialTheme.typography.titleLarge)
                        Text("Issue #${currentIssue.number}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                    }
                    IconButton(onClick = { selectedIssueForDetail = null }, enabled = !postingReply) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }
            },
            text = {
                Column(modifier = Modifier.fillMaxWidth().fillMaxHeight(0.85f)) {
                    if (loadingDetail) {
                        Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            contentPadding = PaddingValues(vertical = 8.dp)
                        ) {
                            item {
                                Card(
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp)),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                                ) {
                                    Column(modifier = Modifier.padding(12.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text("Original Report", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                                            Spacer(Modifier.weight(1f))
                                            Text(currentIssue.createdAt.take(10), style = MaterialTheme.typography.bodySmall)
                                        }
                                        Spacer(Modifier.height(8.dp))
                                        Text(issueDetailBody, style = MaterialTheme.typography.bodyMedium)
                                    }
                                }
                            }

                            items(comments) { comment ->
                                val isUserReply = comment.body.startsWith("**[User Reply from App]**")
                                val cardColor = if (isUserReply) {
                                    MaterialTheme.colorScheme.primaryContainer
                                } else {
                                    MaterialTheme.colorScheme.surfaceVariant
                                }
                                val textColor = if (isUserReply) {
                                    MaterialTheme.colorScheme.onPrimaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                }

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = if (isUserReply) Arrangement.End else Arrangement.Start
                                ) {
                                    Card(
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.fillMaxWidth(0.9f),
                                        colors = CardDefaults.cardColors(containerColor = cardColor)
                                    ) {
                                        Column(modifier = Modifier.padding(12.dp)) {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    if (isUserReply) "You (App)" else (comment.user.login),
                                                    fontWeight = FontWeight.Bold,
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    color = textColor
                                                )
                                                Spacer(Modifier.weight(1f))
                                                Text(
                                                    comment.created_at.take(10),
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = textColor.copy(alpha = 0.7f)
                                                )
                                            }
                                            Spacer(Modifier.height(6.dp))
                                            val cleanBody = if (isUserReply) {
                                                comment.body.removePrefix("**[User Reply from App]**").trim()
                                            } else {
                                                comment.body
                                            }
                                            Text(cleanBody, style = MaterialTheme.typography.bodyMedium, color = textColor)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(8.dp))

                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (replyScreenshotUri != null) {
                            Box(
                                modifier = Modifier
                                    .size(64.dp)
                                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                            ) {
                                AsyncImage(
                                    model = replyScreenshotUri,
                                    contentDescription = "Reply Attachment Preview",
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = androidx.compose.ui.layout.ContentScale.Crop
                                )
                                Surface(
                                    color = androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.6f),
                                    shape = CircleShape,
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(4.dp)
                                        .size(16.dp)
                                        .clickable { replyScreenshotUri = null }
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = "Remove",
                                        tint = androidx.compose.ui.graphics.Color.White,
                                        modifier = Modifier.size(10.dp)
                                    )
                                }
                            }
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            IconButton(
                                onClick = {
                                    replyPhotoPickerLauncher.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                    )
                                },
                                enabled = !postingReply
                            ) {
                                Icon(Icons.Default.AddPhotoAlternate, contentDescription = "Add Photo")
                            }

                            OutlinedTextField(
                                value = replyText,
                                onValueChange = { replyText = it },
                                placeholder = { Text("Type a reply...") },
                                modifier = Modifier.weight(1f),
                                singleLine = false,
                                maxLines = 3,
                                enabled = !postingReply
                            )

                            IconButton(
                                onClick = {
                                    scope.launch {
                                        postingReply = true
                                        try {
                                            val authHeader = "Bearer ${BuildConfig.GITHUB_API_TOKEN}"
                                            val owner = BuildConfig.GITHUB_REPO_OWNER
                                            val repoName = BuildConfig.GITHUB_REPO_NAME

                                            var finalCommentBody = "**[User Reply from App]**\n\n$replyText"

                                            replyScreenshotUri?.let { uri ->
                                                val base64Content = DiagnosticsHelper.uriToBase64(appCtx, uri)
                                                if (base64Content != null) {
                                                    val filename = "screenshot_${System.currentTimeMillis()}.png"
                                                    val uploadResp = GithubClient.api.uploadAsset(
                                                        auth = authHeader,
                                                        owner = owner,
                                                        repo = repoName,
                                                        filename = filename,
                                                        body = UploadAssetRequest(
                                                            message = "Upload screenshot comment asset",
                                                            content = base64Content
                                                        )
                                                    )
                                                    finalCommentBody += "\n\n![Screenshot](${uploadResp.content.download_url})"
                                                }
                                            }

                                            GithubClient.api.postComment(
                                                auth = authHeader,
                                                owner = owner,
                                                repo = repoName,
                                                number = currentIssue.number,
                                                body = PostCommentRequest(body = finalCommentBody)
                                            )

                                            replyText = ""
                                            replyScreenshotUri = null

                                            comments = GithubClient.api.getComments(authHeader, owner, repoName, currentIssue.number)
                                            Toast.makeText(context, "Reply posted", Toast.LENGTH_SHORT).show()
                                        } catch (e: Exception) {
                                            Toast.makeText(context, "Failed to post reply: ${e.message}", Toast.LENGTH_LONG).show()
                                        } finally {
                                            postingReply = false
                                        }
                                    }
                                },
                                enabled = (replyText.isNotBlank() || replyScreenshotUri != null) && !postingReply
                            ) {
                                if (postingReply) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                } else {
                                    Icon(Icons.Default.Send, contentDescription = "Send")
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(currentIssue.htmlUrl))
                            context.startActivity(intent)
                        } catch (_: Exception) {}
                    }
                ) {
                    Icon(Icons.Default.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("View on GitHub")
                }
            },
            dismissButton = {
                TextButton(onClick = { selectedIssueForDetail = null }, enabled = !postingReply) {
                    Text("Close")
                }
            }
        )
    }
}

