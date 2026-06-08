package com.familyguardian.data

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.Locale
import java.util.concurrent.TimeUnit

@Serializable
data class OllamaResponse(val models: List<OllamaModel> = emptyList())

@Serializable
data class OllamaModel(val name: String)

object DiagnosticsHelper {

    private val json = Json { ignoreUnknownKeys = true }

    fun collectSystemInfo(context: Context): String {
        val brand = Build.BRAND
        val model = Build.MODEL
        val manufacturer = Build.MANUFACTURER
        val androidVersion = Build.VERSION.RELEASE
        val apiLevel = Build.VERSION.SDK_INT

        val pm = context.packageManager
        var appVersionName = "Unknown"
        var appVersionCode = -1L
        try {
            val pInfo = pm.getPackageInfo(context.packageName, 0)
            appVersionName = pInfo.versionName ?: "Unknown"
            appVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
        } catch (_: Exception) {}

        val locale = Locale.getDefault().toString()

        // Storage
        val filesDir = context.filesDir
        val freeBytes = filesDir.usableSpace
        val totalBytes = filesDir.totalSpace
        val storageStr = "${formatBytes(freeBytes)} free / ${formatBytes(totalBytes)} total"

        // Memory
        var ramStr = "Unknown"
        try {
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            activityManager.getMemoryInfo(memInfo)
            ramStr = "${formatBytes(memInfo.availMem)} free / ${formatBytes(memInfo.totalMem)} total"
        } catch (_: Exception) {}

        return """
            ### Diagnostics Information
            - **Device Brand:** $brand
            - **Device Model:** $model
            - **Device Manufacturer:** $manufacturer
            - **Android Version:** $androidVersion (API $apiLevel)
            - **App Version:** $appVersionName ($appVersionCode)
            - **System Locale:** $locale
            - **Disk Storage:** $storageStr
            - **System Memory:** $ramStr
        """.trimIndent()
    }

    fun uriToBase64(context: Context, uri: android.net.Uri): String? {
        return try {
            context.contentResolver.openInputStream(uri)?.use { inputStream ->
                val bytes = inputStream.readBytes()
                android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun formatBytes(bytes: Long): String {
        val mb = bytes / (1024 * 1024)
        return if (mb >= 1024) {
            val gb = mb.toDouble() / 1024.0
            String.format(Locale.US, "%.2f GB", gb)
        } else {
            "$mb MB"
        }
    }

    suspend fun detectOllamaModels(serverUrl: String?): List<Pair<String, Boolean>> = withContext(Dispatchers.IO) {
        val modelsList = mutableListOf<Pair<String, Boolean>>() // Pair(name, isOnDevice)
        val client = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .build()

        // 1. Check local emulator loopback (10.0.2.2)
        try {
            val request = Request.Builder().url("http://10.0.2.2:11434/api/tags").build()
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string()
                    if (body != null) {
                        val parsed = json.decodeFromString<OllamaResponse>(body)
                        parsed.models.forEach { modelsList.add(it.name to true) }
                    }
                }
            }
        } catch (_: Exception) {}

        // 2. Check localhost (if running on-device or with forwarded ports)
        try {
            val request = Request.Builder().url("http://localhost:11434/api/tags").build()
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string()
                    if (body != null) {
                        val parsed = json.decodeFromString<OllamaResponse>(body)
                        parsed.models.forEach { model ->
                            if (modelsList.none { it.first == model.name }) {
                                modelsList.add(model.name to true)
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        // 3. Check custom server host if remote
        if (!serverUrl.isNullOrBlank()) {
            try {
                val uri = java.net.URI(serverUrl)
                val host = uri.host
                if (host != null && host != "127.0.0.1" && host != "localhost" && host != "10.0.2.2") {
                    val remoteUrl = "http://$host:11434/api/tags"
                    val request = Request.Builder().url(remoteUrl).build()
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            val body = response.body?.string()
                            if (body != null) {
                                val parsed = json.decodeFromString<OllamaResponse>(body)
                                parsed.models.forEach { model ->
                                    if (modelsList.none { it.first == model.name }) {
                                        modelsList.add(model.name to false)
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (_: Exception) {}
        }

        modelsList
    }
}
