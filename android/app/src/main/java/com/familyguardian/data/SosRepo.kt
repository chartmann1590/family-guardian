package com.familyguardian.data

class SosRepo(private val prefs: Prefs) {

    suspend fun activate(
        lat: Double? = null,
        lng: Double? = null,
        accuracyM: Double? = null,
        note: String? = null,
    ): SosEvent {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/sos/activate")
        return ApiClient.api.activateSos(
            url = url,
            auth = "Bearer $token",
            body = SosActivateBody(lat = lat, lng = lng, accuracyM = accuracyM, note = note),
        )
    }
}
