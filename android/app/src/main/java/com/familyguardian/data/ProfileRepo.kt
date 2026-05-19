package com.familyguardian.data

import android.content.Context
import android.net.Uri
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import java.io.IOException

/**
 * Upload + cache plumbing for `users/me/photo`. The Coil [imageLoader]
 * factory returns a singleton that injects the current bearer token on every
 * image request so authenticated GET /api/users/:id/photo works transparently
 * from any `AsyncImage`.
 */
class ProfileRepo(private val prefs: Prefs) {

    suspend fun uploadPhoto(ctx: Context, uri: Uri, mimeType: String): String =
        withContext(Dispatchers.IO) {
            val snap = prefs.snapshot()
            val server = snap.serverUrl ?: error("server_not_configured")
            val token = snap.token ?: error("not_signed_in")

            val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IOException("Could not read image")

            val fileBody = bytes.toRequestBody(mimeType.toMediaType())
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("photo", "upload", fileBody)
                .build()

            val request = Request.Builder()
                .url(ApiClient.endpoint(server, "/api/users/me/photo"))
                .header("Authorization", "Bearer $token")
                .post(body)
                .build()

            okHttp.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) throw IOException("upload_failed: HTTP ${resp.code}")
                // Return the photoUrl from the response body. Caller can suffix
                // ?t=now to cache-bust their own AsyncImage references.
                resp.body?.string()
                    ?.let { Regex("\"photoUrl\":\"([^\"]+)\"").find(it)?.groupValues?.getOrNull(1) }
                    ?: "/api/users/${snap.userId}/photo"
            }
        }

    suspend fun deletePhoto(): Unit = withContext(Dispatchers.IO) {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: return@withContext
        val token = snap.token ?: return@withContext
        val request = Request.Builder()
            .url(ApiClient.endpoint(server, "/api/users/me/photo"))
            .header("Authorization", "Bearer $token")
            .delete()
            .build()
        okHttp.newCall(request).execute().close()
    }

    companion object {
        private val okHttp by lazy { OkHttpClient() }

        /**
         * Singleton Coil ImageLoader that adds the bearer token to every
         * request. The token is read fresh from [Prefs] per request so a
         * re-login picks up automatically.
         */
        @Volatile private var loader: ImageLoader? = null

        fun imageLoader(ctx: Context, prefs: Prefs): ImageLoader {
            loader?.let { return it }
            synchronized(this) {
                loader?.let { return it }
                val authClient = OkHttpClient.Builder()
                    .addInterceptor { chain ->
                        val token = runCatching { prefs.snapshotBlocking().token }.getOrNull()
                        val req = if (token != null) {
                            chain.request().newBuilder()
                                .header("Authorization", "Bearer $token")
                                .build()
                        } else chain.request()
                        chain.proceed(req)
                    }
                    .build()
                val l = ImageLoader.Builder(ctx)
                    .okHttpClient(authClient)
                    .memoryCache { MemoryCache.Builder(ctx).maxSizePercent(0.1).build() }
                    .diskCache { DiskCache.Builder().directory(ctx.cacheDir.resolve("photos")).maxSizeBytes(8L * 1024 * 1024).build() }
                    .respectCacheHeaders(false) // ignore short max-age — we cache-bust via URL
                    .diskCachePolicy(CachePolicy.ENABLED)
                    .build()
                loader = l
                return l
            }
        }
    }
}

private fun ByteArray.toRequestBody(mediaType: okhttp3.MediaType): RequestBody =
    RequestBody.create(mediaType, this)
