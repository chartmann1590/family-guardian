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
    val recordedAt: Long? = null,
    // Relative path like "/api/users/42/photo" or null if no photo set.
    // Resolve against the server URL when fetching with Coil.
    val photoUrl: String? = null,
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
    val recordedAt: Long,
)

@Serializable
data class HistoryResponse(val points: List<LocationPoint>)

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