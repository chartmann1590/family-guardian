package com.familyguardian.data

class HealthRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun fetch(circleId: Int): List<MemberHealth> {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: return emptyList()
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/health")
        return try {
            api.getHealth(url, "Bearer ${snap.token}").members
        } catch (_: Exception) {
            emptyList()
        }
    }
}
