package com.familyguardian.data

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class SignupRequest(
    val email: String,
    val password: String,
    val displayName: String,
    val inviteCode: String? = null,
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
    val paused: Boolean = false,
    val pausedUntil: Long? = null,
    val pauseReason: String? = null,
)

@Serializable
data class PauseBody(
    val durationMinutes: Int,
    val reason: String? = null,
)

@Serializable
data class PauseState(
    val pausedUntil: Long? = null,
    val reason: String? = null,
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
    val source: String? = null,
    val crashEventId: Long? = null,
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
data class Reaction(
    val emoji: String,
    val userIds: List<Long> = emptyList(),
)

@Serializable
data class MessageReader(val userId: Long, val readAt: Long)

@Serializable
data class ChatMessage(
    val id: Long,
    val circleId: Long,
    val userId: Long,
    val displayName: String? = null,
    val body: String? = null,
    val createdAt: Long,
    val reactions: List<Reaction> = emptyList(),
    val attachmentKind: String? = null,
    val attachmentUrl: String? = null,
    val attachmentMime: String? = null,
    val attachmentBytes: Long? = null,
    val attachmentDurationMs: Long? = null,
    val readers: List<MessageReader>? = null,
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
    val photoUrl: String? = null,
)

@Serializable
data class ViewLogEntry(
    val resource: String,
    val viewedAt: Long,
    val viewerId: Long,
    val viewerName: String,
    val viewerPhotoUrl: String? = null,
)

@Serializable
data class ViewLogResponse(val views: List<ViewLogEntry>)

@Serializable
data class DeleteAccountBody(val password: String)

@Serializable
data class PlaceSubscription(
    val id: Long,
    val userId: Long,
    val placeId: Long,
    val memberId: Long? = null,
    val placeName: String? = null,
    val memberName: String? = null,
    val onEnter: Boolean = true,
    val onExit: Boolean = true,
    val quietStart: Int? = null,
    val quietEnd: Int? = null,
    val createdAt: Long? = null,
)

@Serializable
data class PlaceSubscriptionsResponse(val subscriptions: List<PlaceSubscription>)

@Serializable
data class PlaceSubBody(
    val placeId: Long,
    val memberId: Long? = null,
    val onEnter: Boolean = true,
    val onExit: Boolean = true,
    val quietStart: Int? = null,
    val quietEnd: Int? = null,
)

@Serializable
data class PlaceSubPatch(
    val onEnter: Boolean? = null,
    val onExit: Boolean? = null,
    val quietStart: Int? = null,
    val quietEnd: Int? = null,
)

@Serializable
data class AddReactionBody(val emoji: String)

@Serializable
data class DrivingScore(
    val score: Double? = null,
    val days: Int = 0,
    val tripCount: Int = 0,
    val drivingMs: Long = 0,
    val distanceM: Double = 0.0,
    val hardBrakeCount: Int = 0,
    val hardBrakePer100Km: Double = 0.0,
    val speedingMinutes: Double = 0.0,
    val speedingThresholdMps: Double = 0.0,
    val nightMiles: Double = 0.0,
    val nightDrivingPct: Double = 0.0,
)

@Serializable
data class CrashReportBody(
    val peakAccelMps2: Double,
    val sustainedMs: Int,
    val peakAxisX: Double? = null,
    val peakAxisY: Double? = null,
    val peakAxisZ: Double? = null,
    val speedMps: Double? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Double? = null,
    val activity: String? = null,
    val platform: String,
    val note: String? = null,
)

@Serializable
data class CrashReportResponse(
    val id: Long,
    val detectedAt: Long,
)