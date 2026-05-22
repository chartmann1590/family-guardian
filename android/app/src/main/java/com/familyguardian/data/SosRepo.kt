package com.familyguardian.data

class SosRepo(private val prefs: Prefs) {

    suspend fun activate(
        lat: Double? = null,
        lng: Double? = null,
        accuracyM: Double? = null,
        note: String? = null,
        source: String? = null,
        crashEventId: Long? = null,
    ): SosEvent {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/sos/activate")
        return ApiClient.api.activateSos(
            url = url,
            auth = "Bearer $token",
            body = SosActivateBody(lat = lat, lng = lng, accuracyM = accuracyM, note = note, source = source, crashEventId = crashEventId),
        )
    }

    suspend fun resolve(sosId: Long): SosEvent {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/sos/$sosId/resolve")
        return ApiClient.api.resolveSos(url, "Bearer $token")
    }

    suspend fun listActive(circleId: Long): List<SosEvent> {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/sos")
        return ApiClient.api.listActiveSos(url, "Bearer $token").events
    }
}
