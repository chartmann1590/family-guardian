package com.familyguardian.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class DigestRepo(private val prefs: Prefs) {

    private suspend fun bearer(): Pair<String, String>? {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: return null
        val token = s.token ?: return null
        return server to "Bearer $token"
    }

    suspend fun getCurrent(circleId: Long): DigestData? {
        val (server, auth) = bearer() ?: return null
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/digest")
        return ApiClient.api.getCurrentDigest(url, auth).digest
    }

    suspend fun getPrefs(): DigestPrefsResponse? {
        val (server, auth) = bearer() ?: return null
        val url = ApiClient.endpoint(server, "/api/users/me/digest-prefs")
        return try { ApiClient.api.getDigestPrefs(url, auth) } catch (_: Exception) { null }
    }

    suspend fun setEnabled(enabled: Boolean): DigestPrefsResponse? {
        val (server, auth) = bearer() ?: return null
        val url = ApiClient.endpoint(server, "/api/users/me/digest-prefs")
        val body = """{"enabled":$enabled}"""
            .toRequestBody("application/json".toMediaType())
        return try { ApiClient.api.setDigestPrefs(url, auth, body) } catch (_: Exception) { null }
    }
}
