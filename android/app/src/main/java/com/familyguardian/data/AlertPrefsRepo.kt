package com.familyguardian.data

class AlertPrefsRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun get(): AlertPrefs {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(server, "/api/users/me/alert-prefs")
        return api.getAlertPrefs(url, "Bearer $token")
    }

    suspend fun update(patch: AlertPrefs): AlertPrefs {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(server, "/api/users/me/alert-prefs")
        return api.patchAlertPrefs(url, "Bearer $token", patch)
    }
}
