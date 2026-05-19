package com.familyguardian.data

class CheckinRepo(private val prefs: Prefs) {

    suspend fun send(
        status: String,
        lat: Double? = null,
        lng: Double? = null,
    ): CheckinResponse {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/checkins")
        return ApiClient.api.sendCheckin(
            url = url,
            auth = "Bearer $token",
            body = CheckinBody(status = status, lat = lat, lng = lng),
        )
    }
}
