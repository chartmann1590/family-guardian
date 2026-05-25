package com.familyguardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.material.icons.filled.Person
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.familyguardian.data.EmergencyContactsRepo
import com.familyguardian.data.EmergencyContact
import com.familyguardian.data.PendingInvite
import com.familyguardian.data.Prefs
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmergencyContactsScreen(onBack: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val prefs = remember { Prefs(context) }
    val repo = remember { EmergencyContactsRepo(prefs) }
    val scope = rememberCoroutineScope()

    var contacts by remember { mutableStateOf<List<EmergencyContact>>(emptyList()) }
    var invites by remember { mutableStateOf<List<PendingInvite>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showInviteDialog by remember { mutableStateOf(false) }

    suspend fun refresh() {
        try {
            contacts = repo.list().contacts
            invites = repo.pendingInvites().invites
            error = null
        } catch (t: Throwable) {
            error = t.message ?: "Failed to load"
        }
    }

    LaunchedEffect(Unit) {
        loading = true
        refresh()
        loading = false
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Emergency Contacts", fontWeight = FontWeight.SemiBold) },
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
                onClick = { showInviteDialog = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(Icons.Filled.Add, contentDescription = "Invite contact")
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
                contacts.isEmpty() && invites.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("No emergency contacts yet.", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Tap + to invite someone you trust. They'll be notified if you trigger SOS.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (invites.isNotEmpty()) {
                        item {
                            Text(
                                "Pending Invitations",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(bottom = 4.dp),
                            )
                        }
                        items(invites, key = { it.id }) { invite ->
                            PendingInviteCard(
                                invite = invite,
                                onAccept = {
                                    scope.launch {
                                        try {
                                            repo.respond(invite.id, "accept")
                                            refresh()
                                        } catch (t: Throwable) {
                                            error = t.message
                                        }
                                    }
                                },
                                onDecline = {
                                    scope.launch {
                                        try {
                                            repo.respond(invite.id, "revoke")
                                            refresh()
                                        } catch (t: Throwable) {
                                            error = t.message
                                        }
                                    }
                                },
                            )
                        }
                    }
                    if (contacts.isNotEmpty()) {
                        item {
                            Text(
                                "Your Contacts",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(top = if (invites.isNotEmpty()) 8.dp else 0.dp, bottom = 4.dp),
                            )
                        }
                        items(contacts, key = { it.id }) { contact ->
                            ContactCard(
                                contact = contact,
                                onRevoke = {
                                    scope.launch {
                                        try {
                                            repo.revoke(contact.id)
                                            refresh()
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
    }

    if (showInviteDialog) {
        var email by remember { mutableStateOf("") }
        var inviting by remember { mutableStateOf(false) }
        var inviteError by remember { mutableStateOf<String?>(null) }

        AlertDialog(
            onDismissRequest = { if (!inviting) showInviteDialog = false },
            title = { Text("Invite Emergency Contact") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Enter the email of someone who already has a Family Guardian account.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedTextField(
                        value = email,
                        onValueChange = {
                            email = it
                            inviteError = null
                        },
                        label = { Text("Email") },
                        singleLine = true,
                        isError = inviteError != null,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    inviteError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            inviting = true
                            try {
                                repo.invite(email.trim())
                                showInviteDialog = false
                                refresh()
                            } catch (t: Throwable) {
                                inviteError = t.message ?: "Invite failed"
                            } finally {
                                inviting = false
                            }
                        }
                    },
                    enabled = email.isNotBlank() && !inviting,
                ) { Text(if (inviting) "Inviting..." else "Invite") }
            },
            dismissButton = {
                TextButton(onClick = { if (!inviting) showInviteDialog = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun PendingInviteCard(
    invite: PendingInvite,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.size(40.dp),
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                        Icon(
                            Icons.Filled.Person,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                Column(modifier = Modifier.padding(start = 12.dp)) {
                    Text(invite.fromDisplayName, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "wants you as an emergency contact",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onDecline) { Text("Decline") }
                Button(onClick = onAccept) { Text("Accept") }
            }
        }
    }
}

@Composable
private fun ContactCard(
    contact: EmergencyContact,
    onRevoke: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                    Icon(
                        Icons.Filled.Person,
                        contentDescription = null,
                        tint = if (contact.status == "accepted") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                    )
                }
            }
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(contact.contactDisplayName, style = MaterialTheme.typography.titleMedium)
                Text(
                    when (contact.status) {
                        "pending" -> "Invitation pending"
                        "accepted" -> "Active"
                        else -> contact.status.replaceFirstChar { it.uppercase() }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (contact.status == "accepted") MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onRevoke) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = "Remove",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
