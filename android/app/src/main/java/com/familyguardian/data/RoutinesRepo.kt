package com.familyguardian.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class RoutinesRepo(private val prefs: Prefs) {

    private val api = ApiClient.api

    private fun auth(snap: Prefs.Snapshot): String {
        val token = snap.token ?: throw IllegalStateException("Not authenticated")
        return "Bearer $token"
    }

    private fun server(snap: Prefs.Snapshot): String {
        return snap.serverUrl ?: throw IllegalStateException("No server URL")
    }

    private fun jsonBody(value: String) =
        value.toRequestBody("application/json".toMediaType())

    suspend fun listForMember(userId: Int): RoutinesResponse {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/users/$userId/routines")
        return api.listRoutines(url, auth(snap))
    }

    suspend fun update(id: Int, body: String): Routine {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/routines/$id")
        return api.patchRoutine(url, auth(snap), jsonBody(body))
    }

    suspend fun delete(id: Int) {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/routines/$id")
        api.deleteRoutine(url, auth(snap))
    }

    suspend fun getPrefs(): RoutinePrefs {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/users/me/routine-prefs")
        return api.getRoutinePrefs(url, auth(snap))
    }

    suspend fun setPrefs(body: String): RoutinePrefs {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/users/me/routine-prefs")
        return api.patchRoutinePrefs(url, auth(snap), jsonBody(body))
    }

    suspend fun getUpcoming(circleId: Int, within: Int = 240): ExpectedArrivalsResponse {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/circles/$circleId/expected-arrivals?within=$within")
        return api.getExpectedArrivals(url, auth(snap))
    }

    suspend fun create(body: String): CreateRoutineResponse {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/users/me/routines")
        return api.createRoutine(url, auth(snap), jsonBody(body))
    }

    suspend fun getTemplates(): List<RoutineTemplate> {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/routine-templates")
        return api.getRoutineTemplates(url)
    }

    suspend fun applyTemplate(body: String): ApplyTemplateResponse {
        val snap = prefs.snapshot()
        val url = ApiClient.endpoint(server(snap), "/api/users/me/routines/from-template")
        return api.applyRoutineTemplate(url, auth(snap), jsonBody(body))
    }
}
