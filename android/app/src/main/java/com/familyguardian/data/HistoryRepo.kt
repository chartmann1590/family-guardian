package com.familyguardian.data

class HistoryRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun fetch(
        circleId: Long,
        userId: Long,
        from: Long,
        to: Long = System.currentTimeMillis(),
        limit: Int = 5000,
    ): List<LocationPoint> {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(
            server,
            "/api/circles/$circleId/members/$userId/history?from=$from&to=$to&limit=$limit",
        )
        val response = api.getHistory(url, "Bearer $token")
        return response.points
    }
}
