package com.familyguardian.data

class CrashRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    suspend fun report(
        peakAccelMps2: Double,
        sustainedMs: Int,
        peakAxisX: Double? = null,
        peakAxisY: Double? = null,
        peakAxisZ: Double? = null,
        speedMps: Double? = null,
        lat: Double? = null,
        lng: Double? = null,
        accuracyM: Double? = null,
        activity: String? = null,
        platform: String,
        note: String? = null,
    ): CrashReportResponse {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(server, "/api/crash-events")
        return api.reportCrash(
            url,
            "Bearer $token",
            CrashReportBody(
                peakAccelMps2 = peakAccelMps2,
                sustainedMs = sustainedMs,
                peakAxisX = peakAxisX,
                peakAxisY = peakAxisY,
                peakAxisZ = peakAxisZ,
                speedMps = speedMps,
                lat = lat,
                lng = lng,
                accuracyM = accuracyM,
                activity = activity,
                platform = platform,
                note = note,
            ),
        )
    }

    suspend fun dismiss(crashEventId: Long) {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        val url = ApiClient.endpoint(server, "/api/crash-events/$crashEventId/dismiss")
        api.dismissCrash(url, "Bearer $token")
    }

    suspend fun activateCrashSos(
        crashEventId: Long,
        lat: Double? = null,
        lng: Double? = null,
        accuracyM: Double? = null,
    ): SosEvent {
        val repo = SosRepo(prefs)
        return repo.activate(lat, lng, accuracyM, source = "crash", crashEventId = crashEventId)
    }
}
