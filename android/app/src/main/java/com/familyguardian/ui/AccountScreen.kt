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
import com.familyguardian.data.ApiClient
import com.familyguardian.data.AuthRepo
import com.familyguardian.data.CircleMember
import com.familyguardian.data.MembersResponse
import com.familyguardian.data.Prefs
import com.familyguardian.location.LocationService
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    circleId: Long,
    onLoggedOut: () -> Unit,
    onBack: () -> Unit,
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

    LaunchedEffect(Unit) {
        signedInAs = prefs.snapshot().email
    }

    LaunchedEffect(Unit) {
        try {
            val s = prefs.snapshot()
            val server = s.serverUrl ?: return@LaunchedEffect
            val token = s.token ?: return@LaunchedEffect
            val url = ApiClient.endpoint(server, "/api/circles/$circleId/members")
            members = ApiClient.api.listMembers(url, "Bearer $token").members
        } catch (_: Exception) { }
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
                Text("Export your data", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
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
