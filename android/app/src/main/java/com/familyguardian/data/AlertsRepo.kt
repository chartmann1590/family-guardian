package com.familyguardian.data

class AlertsRepo(private val prefs: Prefs) {

    suspend fun list(circleId: Long, since: Long = 0, limit: Int = 100): List<AlertEvent> {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: error("not signed in")
        val token = snap.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/alerts?since=$since&limit=$limit")
        return ApiClient.api.getAlerts(url, "Bearer $token").alerts
    }
}
