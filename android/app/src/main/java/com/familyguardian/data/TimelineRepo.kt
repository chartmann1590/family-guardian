package com.familyguardian.data

class TimelineRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun fetch(
        circleId: Long,
        userId: Long,
        days: Int = 7,
        limit: Int = 100,
        before: Long? = null,
    ): TimelineResponse {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: return TimelineResponse(emptyList())
        val token = snap.token ?: return TimelineResponse(emptyList())
        var path = "/api/circles/$circleId/members/$userId/timeline?days=$days&limit=$limit"
        if (before != null) path += "&before=$before"
        val url = ApiClient.endpoint(server, path)
        return try {
            api.getTimeline(url, "Bearer $token")
        } catch (_: Exception) {
            TimelineResponse(emptyList())
        }
    }
}
