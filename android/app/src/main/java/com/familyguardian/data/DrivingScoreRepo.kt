package com.familyguardian.data

class DrivingScoreRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun fetch(userId: Long, days: Int = 7): DrivingScore? {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: return null
        val token = snap.token ?: return null
        val url = ApiClient.endpoint(server, "/api/users/$userId/driving-score?days=$days")
        return try {
            api.getDrivingScore(url, "Bearer $token")
        } catch (_: Exception) {
            null
        }
    }
}
