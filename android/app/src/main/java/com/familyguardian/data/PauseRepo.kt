package com.familyguardian.data

class PauseRepo(private val prefs: Prefs) {

    suspend fun current(): PauseState {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/users/me/pause")
        return ApiClient.api.getPauseState(url, "Bearer $token")
    }

    suspend fun pause(durationMinutes: Int, reason: String? = null): PauseState {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/users/me/pause")
        return ApiClient.api.setPause(url, "Bearer $token", PauseBody(durationMinutes, reason))
    }

    suspend fun unpause(): PauseState {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/users/me/pause")
        return ApiClient.api.clearPause(url, "Bearer $token")
    }
}
