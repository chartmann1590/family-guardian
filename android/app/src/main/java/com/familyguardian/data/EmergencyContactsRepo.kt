package com.familyguardian.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class EmergencyContactsRepo(private val prefs: Prefs) {
    private val api = ApiClient.api

    private suspend fun base(): Pair<String, String> {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: throw IllegalStateException("No server URL")
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        return server to "Bearer $token"
    }

    suspend fun list(): EmergencyContactsResponse {
        val (server, auth) = base()
        return api.getEmergencyContacts(ApiClient.endpoint(server, "/api/users/me/emergency-contacts"), auth)
    }

    suspend fun pendingInvites(): PendingInvitesResponse {
        val (server, auth) = base()
        return api.getPendingInvites(ApiClient.endpoint(server, "/api/users/me/pending-invites"), auth)
    }

    suspend fun invite(email: String): EmergencyContact {
        val (server, auth) = base()
        val body = """{"email":"${email.replace("\"", "\\\"")}"}"""
            .toRequestBody("application/json".toMediaType())
        return api.inviteEmergencyContact(ApiClient.endpoint(server, "/api/users/me/emergency-contacts"), auth, body)
    }

    suspend fun respond(contactId: Int, action: String): EmergencyContact {
        val (server, auth) = base()
        val body = """{"action":"$action"}"""
            .toRequestBody("application/json".toMediaType())
        return api.respondEmergencyContact(
            ApiClient.endpoint(server, "/api/users/me/emergency-contacts/$contactId/respond"),
            auth,
            body,
        )
    }

    suspend fun revoke(contactId: Int) {
        val (server, auth) = base()
        api.deleteEmergencyContact(
            ApiClient.endpoint(server, "/api/users/me/emergency-contacts/$contactId"),
            auth,
        )
    }
}
