package com.familyguardian.data

class PlaceSubscriptionsRepo(private val prefs: Prefs) {

    private suspend fun bearer(): Pair<String, String>? {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: return null
        val token = s.token ?: return null
        return server to "Bearer $token"
    }

    suspend fun list(circleId: Long): List<PlaceSubscription> {
        val (server, auth) = bearer() ?: return emptyList()
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/place-subscriptions")
        return ApiClient.api.listPlaceSubscriptions(url, auth).subscriptions
    }

    suspend fun upsert(circleId: Long, body: PlaceSubBody): PlaceSubscription {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/place-subscriptions")
        return ApiClient.api.upsertPlaceSubscription(url, auth, body)
    }

    suspend fun patch(id: Long, body: PlaceSubPatch): PlaceSubscription {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/place-subscriptions/$id")
        return ApiClient.api.patchPlaceSubscription(url, auth, body)
    }

    suspend fun delete(id: Long) {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/place-subscriptions/$id")
        ApiClient.api.deletePlaceSubscription(url, auth)
    }
}
