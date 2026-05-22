package com.familyguardian.data

import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File

class CheckinRepo(private val prefs: Prefs) {

    suspend fun send(
        status: String,
        lat: Double? = null,
        lng: Double? = null,
    ): CheckinResponse {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/checkins")
        return ApiClient.api.sendCheckin(
            url = url,
            auth = "Bearer $token",
            body = CheckinBody(status = status, lat = lat, lng = lng),
        )
    }

    suspend fun checkinWithPhoto(status: String, file: File, lat: Double? = null, lng: Double? = null): CheckinResponse {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/checkins/with-photo")
        val fileBody = file.asRequestBody("image/jpeg".toMediaTypeOrNull())
        val multipart = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("status", status)
            .addFormDataPart("photo", file.name, fileBody)
            .apply {
                if (lat != null) addFormDataPart("lat", lat.toString())
                if (lng != null) addFormDataPart("lng", lng.toString())
            }
            .build()
        return ApiClient.api.sendCheckinWithPhoto(url, "Bearer $token", multipart)
    }
}
