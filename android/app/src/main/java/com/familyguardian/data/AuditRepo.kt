package com.familyguardian.data

class AuditRepo(private val prefs: Prefs) {

    suspend fun getViewLog(days: Int = 7): List<ViewLogEntry> {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/users/me/view-log?days=$days")
        return ApiClient.api.getViewLog(url, "Bearer $token").views
    }
}
