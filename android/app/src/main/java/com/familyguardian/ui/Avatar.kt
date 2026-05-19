package com.familyguardian.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.familyguardian.data.ApiClient
import com.familyguardian.data.Prefs
import com.familyguardian.data.ProfileRepo

private fun initials(name: String?): String =
    (name ?: "?").trim()
        .split(Regex("\\s+"))
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .take(2)
        .joinToString("")
        .ifEmpty { "?" }

/**
 * Circular avatar that shows initials by default and overlays the user's
 * photo if [photoPath] is non-null. The photo is loaded through the shared
 * auth-injecting Coil loader so the bearer token is attached automatically.
 *
 * [photoPath] is the server-relative path (e.g. `/api/users/42/photo`) — the
 * server URL from [Prefs] is prepended internally.
 */
@Composable
fun Avatar(
    displayName: String?,
    photoPath: String?,
    size: Dp = 40.dp,
    modifier: Modifier = Modifier,
) {
    val ctx = LocalContext.current
    val prefs = remember { Prefs(ctx.applicationContext) }
    val absoluteUrl = remember(photoPath) {
        if (photoPath.isNullOrBlank()) null
        else {
            val server = runCatching { prefs.snapshotBlocking().serverUrl }.getOrNull()
            if (server.isNullOrBlank()) null else ApiClient.endpoint(server, photoPath)
        }
    }
    Surface(
        modifier = modifier.size(size),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
            // Initials always rendered behind the image so a network failure
            // (or no photo) leaves a sensible fallback.
            Text(
                initials(displayName),
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (absoluteUrl != null) {
                AsyncImage(
                    model = ImageRequest.Builder(ctx)
                        .data(absoluteUrl)
                        .crossfade(true)
                        .build(),
                    imageLoader = ProfileRepo.imageLoader(ctx.applicationContext, prefs),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().clip(CircleShape),
                )
            }
        }
    }
}
