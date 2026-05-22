package com.familyguardian.data

class TripsRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun listForMember(
        circleId: Long,
        userId: Long,
        from: Long,
        to: Long = System.currentTimeMillis(),
        limit: Int = 200,
    ): List<Trip> {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(
            server,
            "/api/circles/$circleId/members/$userId/trips?from=$from&to=$to&limit=$limit",
        )
        return api.getTrips(url, "Bearer $token").trips
    }

    suspend fun drivingScore(userId: Long, days: Int = 7): DrivingScore {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(server, "/api/users/$userId/driving-score?days=$days")
        return api.getDrivingScore(url, "Bearer $token")
    }
}
