package com.familyguardian.location

import android.util.Log
import com.familyguardian.data.ApiClient
import com.familyguardian.data.LocationReport
import com.familyguardian.data.Prefs
import kotlinx.coroutines.delay

class LocationReporter(private val prefs: Prefs) {

    suspend fun report(
        lat: Double,
        lng: Double,
        accuracyM: Double?,
        speedMps: Double?,
        batteryPct: Int?,
        recordedAtMs: Long,
        bearing: Double? = null,
        altitudeM: Double? = null,
        activity: String? = null,
        activityConfidence: Int? = null,
    ) {
        val snapshot = prefs.snapshot()
        val serverUrl = snapshot.serverUrl ?: return
        val token = snapshot.token ?: return
        val body = LocationReport(
            lat = lat,
            lng = lng,
            accuracyM = accuracyM,
            speedMps = speedMps,
            batteryPct = batteryPct,
            recordedAt = recordedAtMs,
            bearing = bearing,
            altitudeM = altitudeM,
            activity = activity,
            activityConfidence = activityConfidence,
        )
        // Reporting continues even while paused — privacy is enforced server-side
        // (history writes persist, but the live broadcast is suppressed) so the
        // user's own timeline stays intact when they unpause.
        val url = ApiClient.endpoint(serverUrl, "/api/locations")
        var attempt = 0
        var delayMs = 1_000L
        while (attempt < 3) {
            try {
                ApiClient.api.postLocation(url, "Bearer $token", body)
                return
            } catch (t: Throwable) {
                Log.w("LocationReporter", "report attempt ${attempt + 1} failed: ${t.message}")
                attempt += 1
                if (attempt >= 3) return
                delay(delayMs)
                delayMs *= 2
            }
        }
    }
}
