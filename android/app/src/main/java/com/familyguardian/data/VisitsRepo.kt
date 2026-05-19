package com.familyguardian.data

class VisitsRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun listForMember(
        circleId: Long,
        userId: Long,
        from: Long,
        to: Long = System.currentTimeMillis(),
        limit: Int = 200,
    ): List<Visit> {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(
            server,
            "/api/circles/$circleId/members/$userId/visits?from=$from&to=$to&limit=$limit",
        )
        return api.getVisits(url, "Bearer $token").visits
    }
}
