package com.familyguardian.data

class PlacesRepo(private val prefs: Prefs) {

    private suspend fun bearer(): Pair<String, String>? {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: return null
        val token = s.token ?: return null
        return server to "Bearer $token"
    }

    suspend fun list(circleId: Long): List<Place> {
        val (server, auth) = bearer() ?: return emptyList()
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/places")
        return ApiClient.api.listPlaces(url, auth).places
    }

    suspend fun create(circleId: Long, body: PlaceBody): Place {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/places")
        return ApiClient.api.createPlace(url, auth, body)
    }

    suspend fun update(id: Long, body: PlaceBody): Place {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/places/$id")
        return ApiClient.api.patchPlace(url, auth, body)
    }

    suspend fun delete(id: Long) {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/places/$id")
        ApiClient.api.deletePlace(url, auth)
    }

    suspend fun getAnalytics(placeId: Int, days: Int = 30): PlaceAnalytics? {
        val snap = prefs.snapshot()
        val server = snap.serverUrl ?: return null
        val url = ApiClient.endpoint(server, "/api/places/$placeId/analytics?days=$days")
        return try { ApiClient.api.getPlaceAnalytics(url, "Bearer ${snap.token}") } catch (_: Exception) { null }
    }
}
