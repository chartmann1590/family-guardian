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
    val requiresTotp: Boolean = false,
    val challengeToken: String? = null,
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
    val kind: String = "other",
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
    val kind: String = "other",
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
    val coachingJson: String? = null,
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
    val curfewEnabled: Boolean = false,
    val curfewStart: Int? = null,
    val curfewEnd: Int? = null,
    val curfewHomePlaceId: Long? = null,
    val lowBatteryAlerts: Boolean = false,
    val lowBatteryThresholdPct: Int? = null,
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
    val daysOfWeek: String? = null,
    val windowStart: String? = null,
    val windowEnd: String? = null,
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

@Serializable
data class Routine(
    val id: Int,
    val userId: Int,
    val circleId: Int,
    val placeId: Int,
    val placeName: String,
    val kind: String,
    val dayOfWeek: Int,
    val expectedMinute: Int,
    val expectedDwellMinutes: Int? = null,
    val toleranceMinutes: Int,
    val sampleCount: Int,
    val confidence: Double,
    val source: String,
    val active: Boolean,
    val firstSeenAt: Long? = null,
    val lastSeenAt: Long? = null,
    val createdAt: Long,
    val updatedAt: Long,
)

@Serializable
data class RoutinesResponse(val routines: List<Routine>)

@Serializable
data class RoutinePrefs(
    val routinesEnabled: Boolean,
    val quietStart: Int? = null,
    val quietEnd: Int? = null,
)

@Serializable
data class CreateRoutineRequest(
    val placeId: Int,
    val kind: String,
    val daysOfWeek: List<Int>,
    val expectedMinute: Int,
    val toleranceMinutes: Int,
)

@Serializable
data class CreateRoutineResponse(val ids: List<Int>, val count: Int)

@Serializable
data class RoutineTemplate(
    val id: String,
    val title: String,
    val description: String,
    val needsPlace: String? = null,
    val items: List<RoutineTemplateItem>,
)

@Serializable
data class RoutineTemplateItem(
    val kind: String,
    val daysOfWeek: List<Int>,
    val expectedMinute: Int,
    val toleranceMinutes: Int,
)

@Serializable
data class ApplyTemplateResponse(val created: List<Int>, val skipped: List<Int>, val total: Int)

@Serializable
data class ExpectedArrival(
    val userId: Int,
    val displayName: String,
    val photoUrl: String? = null,
    val placeId: Int,
    val placeName: String,
    val kind: String,
    val expectedMinute: Int,
    val expectedAt: Long,
)

@Serializable
data class ExpectedArrivalsResponse(val arrivals: List<ExpectedArrival>)

@Serializable
data class MemberHealth(
    val userId: Int,
    val displayName: String,
    val photoUrl: String? = null,
    val batteryPct: Int? = null,
    val lastFixAt: Long? = null,
    val staleMinutes: Int? = null,
    val activity: String? = null,
    val paused: Boolean = false,
    val pausedUntil: Long? = null,
    val nextRoutine: NextRoutine? = null,
    val drivingScore: Int? = null,
    val checkinStatus: String? = null,
    val checkinAt: Long? = null,
)

@Serializable
data class NextRoutine(
    val kind: String,
    val placeName: String,
    val expectedMinute: Int,
)

@Serializable
data class HealthResponse(val members: List<MemberHealth>)

@Serializable
data class TimelineItem(
    val kind: String,
    val at: Long,
    val payload: TimelinePayload
)

@Serializable
data class TimelinePayload(
    val id: Int? = null,
    val placeId: Int? = null,
    val placeName: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val mode: String? = null,
    val distanceM: Double? = null,
    val maxSpeedMps: Double? = null,
    val status: String? = null,
    val alertKind: String? = null,
    val expectedMinute: Int? = null,
    val actualMinute: Int? = null,
    val type: String? = null,
    val value: Double? = null,
    val startedAt: Long? = null,
    val endedAt: Long? = null
)

@Serializable
data class TimelineResponse(val items: List<TimelineItem>, val cursor: Long? = null)

@Serializable
data class PlaceAnalyticsMember(
    val userId: Int,
    val displayName: String,
    val visitCount: Int,
    val totalDwellMs: Long,
    val lastVisitAt: Long? = null,
    val avgDwellMs: Long? = null,
    val longestDwellMs: Long? = null,
)

@Serializable
data class WeekOverWeek(
    val lastWeekCount: Int,
    val prevWeekCount: Int,
    val deltaPct: Double,
)

@Serializable
data class PlaceAnalytics(
    val placeId: Int,
    val placeName: String,
    val days: Int,
    val perMember: List<PlaceAnalyticsMember>,
    val weekOverWeek: WeekOverWeek,
)

@Serializable
data class DigestMember(
    val userId: Int,
    val displayName: String,
    val tripCount: Int = 0,
    val totalDistanceM: Long = 0,
    val visitCount: Int = 0,
    val routineAlerts: Int = 0,
    val drivingScore: Int? = null,
    val checkinCount: Int = 0,
)

@Serializable
data class DigestData(
    val weekStart: Long,
    val weekEnd: Long,
    val perMember: List<DigestMember> = emptyList(),
    val totalKm: Int = 0,
    val totalAlerts: Int = 0,
    val busiestPlace: String? = null,
    val quietestMember: String? = null,
)

@Serializable
data class DigestResponse(val digest: DigestData? = null)

@Serializable
data class DigestPrefsResponse(val enabled: Boolean = false)

@Serializable
data class EmergencyContact(
    val id: Int,
    val contactUserId: Int,
    val contactDisplayName: String = "",
    val contactPhotoUrl: String? = null,
    val status: String = "pending",
    val invitedAt: Long,
    val acceptedAt: Long? = null,
)

@Serializable
data class EmergencyContactsResponse(val contacts: List<EmergencyContact> = emptyList())

@Serializable
data class PendingInvite(
    val id: Int,
    val fromUserId: Int,
    val fromDisplayName: String = "",
    val invitedAt: Long,
)

@Serializable
data class PendingInvitesResponse(val invites: List<PendingInvite> = emptyList())

@Serializable
data class PlaceSuggestion(
    val id: Int,
    val userId: Int,
    val lat: Double,
    val lng: Double,
    val label: String? = null,
    val visitCount: Int,
    val totalDwellMs: Long,
    val firstSeen: Long,
    val lastSeen: Long,
    val status: String,
    val createdAt: Long,
)

@Serializable
data class PlaceSuggestionsResponse(val suggestions: List<PlaceSuggestion>)

@Serializable
data class AcceptSuggestionBody(val name: String, val kind: String = "other", val radiusM: Double = 100.0)

@Serializable
data class TripShareCreateBody(
    val durationMinutes: Int = 60,
    val destination: TripShareDestination? = null,
    val maxViews: Int? = null,
)

@Serializable
data class TripShareDestination(val lat: Double, val lng: Double, val label: String? = null)

@Serializable
data class TripShareResponse(val token: String, val url: String, val expiresAt: Long)

@Serializable
data class TripSharesResponse(val shares: List<TripShareItem>)

@Serializable
data class TripShareItem(
    val token: String,
    val userId: Int,
    val createdAt: Long,
    val expiresAt: Long,
    val destination: TripShareDestination? = null,
    val maxViews: Int? = null,
    val viewCount: Int,
    val revoked: Boolean,
)

@Serializable
data class WebPushSubscription(val endpoint: String, val keys: WebPushKeys)

@Serializable
data class WebPushKeys(val p256dh: String, val auth: String)

@Serializable
data class TotpEnrollStartResponse(val provisioningUri: String, val secret: String)

@Serializable
data class TotpEnrollConfirmBody(val code: String)

@Serializable
data class TotpEnrollConfirmResponse(val backupCodes: List<String>)

@Serializable
data class TotpDisableBody(val password: String, val code: String? = null)

@Serializable
data class CircleInfo(val circleId: Int, val name: String? = null, val role: String)

@Serializable
data class CirclesResponse(val circles: List<CircleInfo>)

@Serializable
data class ActiveCircleBody(val circleId: Int)

@Serializable
data class WebhookBody(val url: String, val events: String, val active: Boolean = true)

@Serializable
data class WebhookItem(
    val id: Int,
    val circleId: Int,
    val url: String,
    val events: String,
    val active: Boolean,
    val createdAt: Long,
    val lastDispatchedAt: Long? = null,
    val lastError: String? = null,
)

@Serializable
data class WebhooksResponse(val webhooks: List<WebhookItem>)