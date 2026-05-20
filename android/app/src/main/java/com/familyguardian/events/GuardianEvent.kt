package com.familyguardian.events

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("type")
sealed interface GuardianEvent {

    @Serializable
    @SerialName("ready")
    data class Ready(val circleId: Long) : GuardianEvent

    @Serializable
    @SerialName("location_update")
    data class LocationUpdate(
        val userId: Long,
        val displayName: String? = null,
        val lat: Double,
        val lng: Double,
        val accuracyM: Double? = null,
        val speedMps: Double? = null,
        val batteryPct: Int? = null,
        val bearing: Double? = null,
        val altitudeM: Double? = null,
        val activity: String? = null,
        val activityConfidence: Int? = null,
        val recordedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("geofence_enter")
    data class GeofenceEnter(
        val userId: Long,
        val displayName: String? = null,
        val placeId: Long,
        val placeName: String,
        val distanceM: Double,
        val recordedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("geofence_exit")
    data class GeofenceExit(
        val userId: Long,
        val displayName: String? = null,
        val placeId: Long,
        val placeName: String,
        val distanceM: Double,
        val recordedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("sos_active")
    data class SosActive(
        val id: Long,
        val userId: Long,
        val displayName: String? = null,
        val startedAt: Long,
        val lat: Double? = null,
        val lng: Double? = null,
        val note: String? = null,
    ) : GuardianEvent

    @Serializable
    @SerialName("sos_resolved")
    data class SosResolved(
        val id: Long,
        val userId: Long,
        val displayName: String? = null,
        val resolvedAt: Long? = null,
        val resolvedBy: Long? = null,
    ) : GuardianEvent

    @Serializable
    @SerialName("chat_message")
    data class ChatMessage(
        val id: Long,
        val userId: Long,
        val displayName: String? = null,
        val body: String,
        val createdAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("check_in")
    data class CheckIn(
        val id: Long,
        val userId: Long,
        val displayName: String? = null,
        val status: String,
        val lat: Double? = null,
        val lng: Double? = null,
        val note: String? = null,
        val createdAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("speeding_alert")
    data class SpeedingAlert(
        val userId: Long,
        val displayName: String? = null,
        val speedMps: Double,
        val thresholdMps: Double,
        val recordedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("low_battery_alert")
    data class LowBatteryAlert(
        val userId: Long,
        val displayName: String? = null,
        val batteryPct: Int,
        val thresholdPct: Int,
        val recordedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("offline_alert")
    data class OfflineAlert(
        val userId: Long,
        val displayName: String? = null,
        val minutesOffline: Int,
        val thresholdMinutes: Int,
        val recordedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("visit_end")
    data class VisitEnd(
        val userId: Long,
        val displayName: String? = null,
        val visitId: Long,
        val placeId: Long? = null,
        val label: String? = null,
        val lat: Double,
        val lng: Double,
        val startedAt: Long,
        val endedAt: Long,
        val durationMs: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("trip_end")
    data class TripEnd(
        val userId: Long,
        val displayName: String? = null,
        val tripId: Long,
        val mode: String,
        val distanceM: Double,
        val maxSpeedMps: Double? = null,
        val avgSpeedMps: Double? = null,
        val startedAt: Long,
        val endedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("pause_changed")
    data class PauseChanged(
        val userId: Long,
        val pausedUntil: Long? = null,
        val reason: String? = null,
    ) : GuardianEvent

    @Serializable
    @SerialName("error")
    data class Error(val error: String) : GuardianEvent
}
