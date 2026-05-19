package com.familyguardian.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.familyguardian.data.ApiClient
import com.familyguardian.data.Prefs
import com.familyguardian.data.ProfileRepo
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Two-step wizard shown once after a fresh sign-up via invite code: confirm
 * display name and optionally pick a profile photo. Skip lands on the map
 * with whatever defaults the user chose during sign-up.
 */
@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val appCtx = context.applicationContext
    val prefs = remember { Prefs(appCtx) }
    val profileRepo = remember { ProfileRepo(prefs) }
    val scope = rememberCoroutineScope()

    var name by remember { mutableStateOf("") }
    var localPhotoUri by remember { mutableStateOf<Uri?>(null) }
    var photoCacheBuster by remember { mutableStateOf(0L) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Pre-fill from the signup so the user isn't typing it twice.
    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (name.isBlank()) name = prefs.snapshot().displayName ?: ""
    }

    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri: Uri? -> if (uri != null) localPhotoUri = uri }

    fun finish() {
        if (saving) return
        val trimmed = name.trim()
        if (trimmed.isEmpty()) {
            error = "Display name can't be empty."
            return
        }
        saving = true
        error = null
        scope.launch {
            try {
                val snap = prefs.snapshot()
                val server = snap.serverUrl ?: error("no_server")
                val token = snap.token ?: error("not_signed_in")
                // PATCH display name (does nothing if unchanged).
                patchDisplayName(server, token, trimmed)
                prefs.setDisplayName(trimmed)
                // Optional photo upload.
                val uri = localPhotoUri
                if (uri != null) {
                    val mime = appCtx.contentResolver.getType(uri) ?: "image/jpeg"
                    profileRepo.uploadPhoto(appCtx, uri, mime)
                    photoCacheBuster = System.currentTimeMillis()
                }
                prefs.setOnboarded(true)
                onDone()
            } catch (t: Throwable) {
                error = t.message ?: "Couldn't save profile."
            } finally {
                saving = false
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Box(modifier = Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 440.dp)
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "Welcome to Family Guardian",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Text(
                        "Make yourself recognizable on the map.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        // Photo picker — circle that either shows the chosen local
                        // image preview or an "add photo" placeholder.
                        Surface(
                            modifier = Modifier
                                .size(112.dp)
                                .clip(CircleShape),
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            onClick = { photoPicker.launch("image/*") },
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                val uri = localPhotoUri
                                if (uri != null) {
                                    AsyncImage(
                                        model = ImageRequest.Builder(appCtx).data(uri).build(),
                                        imageLoader = ProfileRepo.imageLoader(appCtx, prefs),
                                        contentDescription = null,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.fillMaxSize().clip(CircleShape),
                                    )
                                } else {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Icon(
                                            Icons.Filled.AddAPhoto,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.size(32.dp),
                                        )
                                        Text(
                                            "Add photo",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                        }
                        Text(
                            "Optional — JPG, PNG, or WebP, max 2 MB.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )

                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it; error = null },
                            label = { Text("Display name") },
                            leadingIcon = { Icon(Icons.Filled.Badge, contentDescription = null) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                            ),
                        )

                        if (error != null) {
                            Text(
                                text = error!!,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }

                        Button(
                            onClick = ::finish,
                            enabled = !saving,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(28.dp),
                            contentPadding = PaddingValues(vertical = 14.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary,
                            ),
                        ) {
                            if (saving) {
                                CircularProgressIndicator(
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    strokeWidth = 2.dp,
                                    modifier = Modifier.size(20.dp),
                                )
                            } else {
                                Text(
                                    "Continue",
                                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                                )
                                Icon(
                                    Icons.Filled.ArrowForward,
                                    contentDescription = null,
                                    modifier = Modifier.padding(start = 8.dp),
                                )
                            }
                        }

                        TextButton(
                            onClick = {
                                scope.launch {
                                    prefs.setOnboarded(true)
                                    onDone()
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !saving,
                        ) { Text("Skip for now") }
                    }
                }
            }
        }
    }
}

/** Bare OkHttp PATCH — saves pulling another retrofit method into the API. */
private suspend fun patchDisplayName(server: String, token: String, displayName: String) {
    val client = OkHttpClient()
    val body = "{\"displayName\":${jsonString(displayName)}}".toRequestBody("application/json".toMediaType())
    val req = Request.Builder()
        .url(ApiClient.endpoint(server, "/api/users/me"))
        .header("Authorization", "Bearer $token")
        .patch(body)
        .build()
    client.newCall(req).execute().use { resp ->
        if (!resp.isSuccessful) error("update_failed: HTTP ${resp.code}")
    }
}

private fun jsonString(s: String): String {
    val sb = StringBuilder("\"")
    for (c in s) {
        when (c) {
            '\\' -> sb.append("\\\\")
            '"' -> sb.append("\\\"")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (c.code < 0x20) sb.append("\\u%04x".format(c.code)) else sb.append(c)
        }
    }
    return sb.append('"').toString()
}
