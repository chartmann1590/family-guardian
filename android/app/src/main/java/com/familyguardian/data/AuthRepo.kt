package com.familyguardian.data

class AuthRepo(private val prefs: Prefs) {

    suspend fun signup(serverUrl: String, email: String, password: String, displayName: String): LoginResponse {
        val url = ApiClient.endpoint(serverUrl, "/api/auth/signup")
        val body = SignupRequest(
            email = email,
            password = password,
            displayName = displayName,
            inviteCode = null,
        )
        val resp = ApiClient.api.signup(url, body)
        persist(serverUrl, email, resp)
        prefs.setOnboarded(false)
        return resp
    }

    suspend fun login(serverUrl: String, email: String, password: String): LoginResponse {
        val url = ApiClient.endpoint(serverUrl, "/api/auth/login")
        val resp = ApiClient.api.login(url, LoginRequest(email = email, password = password))
        persist(serverUrl, email, resp)
        // Returning users skip the onboarding wizard — they already have a
        // display name set, and the server keeps any prior photo.
        prefs.setOnboarded(true)
        return resp
    }

    suspend fun joinWithInvite(
        serverUrl: String,
        email: String,
        password: String,
        displayName: String,
        inviteCode: String,
    ): LoginResponse {
        val url = ApiClient.endpoint(serverUrl, "/api/auth/signup")
        val body = SignupRequest(
            email = email,
            password = password,
            displayName = displayName,
            inviteCode = inviteCode,
        )
        val resp = ApiClient.api.signup(url, body)
        persist(serverUrl, email, resp)
        prefs.setOnboarded(false)
        return resp
    }

    private suspend fun persist(serverUrl: String, email: String, resp: LoginResponse) {
        prefs.setServerUrl(serverUrl)
        prefs.saveSession(
            token = resp.token,
            email = email,
            displayName = resp.displayName,
            circleId = resp.circleId,
            userId = resp.userId,
        )
    }

    suspend fun logout() {
        prefs.clearSession()
    }
}
