package com.familyguardian.data

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class SignupRequest(
    val email: String,
    val password: String,
    val displayName: String,
    val inviteCode: String,
)

@Serializable
data class LoginResponse(
    val token: String,
    val userId: Long,
    val circleId: Long? = null,
    val displayName: String,
)

@Serializable
data class LocationReport(
    val lat: Double,
    val lng: Double,
    val accuracyM: Double? = null,
    val speedMps: Double? = null,
    val batteryPct: Int? = null,
    val recordedAt: Long? = null,
    val bearing: Double? = null,
    val altitudeM: Double? = null,
    val activity: String? = null,
    val activityConfidence: Int? = null,
)

@Serializable
data class OkResponse(val ok: Boolean = true)

@Serializable
data class ApiError(val error: String)

@Serializable
data class CircleMember(
    val userId: Long,
    val displayName: String,
    val email: String? = null,
    val role: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Double? = null,
    val speedMps: Double? = null,
    val batteryPct: Int? = null,
    val bearing: Double? = null,
    val altitudeM: Double? = null,
    val activity: String? = null,
    val activityConfidence: Int? = null,
    val recordedAt: Long? = null,
    val photoUrl: String? = null,
    val address: String? = null,
)

@Serializable
data class MembersResponse(val members: List<CircleMember>)

@Serializable
data class Place(
    val id: Long,
    val circleId: Long,
    val name: String,
    val address: String? = null,
    val lat: Double,
    val lng: Double,
    val radiusM: Double,
    val alertsOnEnter: Boolean = true,
    val alertsOnExit: Boolean = true,
)

@Serializable
data class PlacesResponse(val places: List<Place>)

@Serializable
data class PlaceBody(
    val name: String,
    val address: String? = null,
    val lat: Double,
    val lng: Double,
    val radiusM: Double,
    val alertsOnEnter: Boolean = true,
    val alertsOnExit: Boolean = true,
)

@Serializable
data class SosActivateBody(
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Double? = null,
    val note: String? = null,
)

@Serializable
data class SosEvent(
    val id: Long,
    val circleId: Long,
    val userId: Long,
    val displayName: String? = null,
    val startedAt: Long,
    val resolvedAt: Long? = null,
    val resolvedBy: Long? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Double? = null,
    val note: String? = null,
    val status: String,
)

@Serializable
data class SosListResponse(val events: List<SosEvent>)

@Serializable
data class ChatMessage(
    val id: Long,
    val circleId: Long,
    val userId: Long,
    val displayName: String? = null,
    val body: String,
    val createdAt: Long,
)

@Serializable
data class MessagesResponse(val messages: List<ChatMessage>)

@Serializable
data class SendMessageBody(val body: String)

@Serializable
data class LocationPoint(
    val id: Long,
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
)

@Serializable
data class HistoryResponse(val points: List<LocationPoint>)

@Serializable
data class Visit(
    val id: Long,
    val userId: Long,
    val circleId: Long,
    val placeId: Long? = null,
    val placeName: String? = null,
    val lat: Double,
    val lng: Double,
    val label: String? = null,
    val startedAt: Long,
    val endedAt: Long? = null,
    val durationMs: Long? = null,
    val pointCount: Int,
)

@Serializable
data class VisitsResponse(val visits: List<Visit>)

@Serializable
data class Trip(
    val id: Long,
    val userId: Long,
    val circleId: Long,
    val startedAt: Long,
    val endedAt: Long? = null,
    val durationMs: Long? = null,
    val mode: String,
    val distanceM: Double,
    val maxSpeedMps: Double? = null,
    val avgSpeedMps: Double? = null,
    val startLat: Double? = null,
    val startLng: Double? = null,
    val endLat: Double? = null,
    val endLng: Double? = null,
    val startLabel: String? = null,
    val endLabel: String? = null,
)

@Serializable
data class TripsResponse(val trips: List<Trip>)

@Serializable
data class AlertPrefs(
    val userId: Long? = null,
    val speedingEnabled: Boolean = true,
    val speedingThresholdMps: Double = 31.3,
    val lowBatteryEnabled: Boolean = true,
    val lowBatteryThreshold: Int = 15,
    val offlineEnabled: Boolean = true,
    val offlineMinutes: Int = 30,
)

@Serializable
data class AlertEvent(
    val id: Long,
    val userId: Long,
    val displayName: String? = null,
    val circleId: Long,
    val type: String,
    val value: Double? = null,
    val createdAt: Long,
)

@Serializable
data class AlertsResponse(val alerts: List<AlertEvent>)

@Serializable
data class CheckinBody(
    val status: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val note: String? = null,
)

@Serializable
data class CheckinResponse(
    val id: Long,
    val userId: Long,
    val circleId: Long,
    val displayName: String? = null,
    val status: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val note: String? = null,
    val createdAt: Long,
)