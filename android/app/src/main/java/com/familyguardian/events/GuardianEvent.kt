package com.familyguardian.events

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonObject

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
        val notifyUserIds: List<Long> = emptyList(),
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
        val notifyUserIds: List<Long> = emptyList(),
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
        val source: String? = null,
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
        val body: String? = null,
        val createdAt: Long,
        val attachmentKind: String? = null,
        val attachmentUrl: String? = null,
        val attachmentMime: String? = null,
        val attachmentDurationMs: Long? = null,
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
        val photoUrl: String? = null,
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
    @SerialName("reaction_added")
    data class ReactionAdded(
        val messageId: Long,
        val userId: Long,
        val emoji: String,
    ) : GuardianEvent

    @Serializable
    @SerialName("reaction_removed")
    data class ReactionRemoved(
        val messageId: Long,
        val userId: Long,
        val emoji: String,
    ) : GuardianEvent

    @Serializable
    @SerialName("chat_typing")
    data class ChatTyping(
        val circleId: Long,
        val userId: Long,
        val displayName: String,
        val expiresAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("message_read")
    data class MessageRead(
        val messageId: Long,
        val userId: Long,
        val readAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("error")
    data class Error(val error: String) : GuardianEvent

    @Serializable
    @SerialName("driving_score_updated")
    data class DrivingScoreUpdated(val userId: Long) : GuardianEvent

    @Serializable
    @SerialName("crash_pending")
    data class CrashPending(
        val userId: Long,
        val displayName: String? = null,
        val crashEventId: Long,
        val detectedAt: Long,
    ) : GuardianEvent

    @Serializable
    @SerialName("routine_deviation")
    data class RoutineDeviation(
        val userId: Long,
        val displayName: String,
        val routineId: Long,
        val placeId: Long,
        val placeName: String,
        val kind: String,
        val expectedMinute: Int,
        val actualMinute: Int? = null,
    ) : GuardianEvent

    @Serializable
    @SerialName("digest_ready")
    data class DigestReady(val circleId: Int) : GuardianEvent

    @Serializable
    @SerialName("eta_updated")
    data class EtaUpdated(
        val userId: Long,
        val displayName: String? = null,
        val placeId: Long,
        val placeName: String,
        val etaMinutes: Int,
    ) : GuardianEvent

    @Serializable
    @SerialName("arrived_safely")
    data class ArrivedSafely(
        val userId: Long,
        val displayName: String? = null,
        val placeId: Long,
        val placeName: String,
    ) : GuardianEvent

    @Serializable
    @SerialName("break_suggested")
    data class BreakSuggested(
        val userId: Long,
        val displayName: String? = null,
        val drivingMinutes: Int,
    ) : GuardianEvent
}
