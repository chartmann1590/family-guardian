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
    @SerialName("error")
    data class Error(val error: String) : GuardianEvent
}
