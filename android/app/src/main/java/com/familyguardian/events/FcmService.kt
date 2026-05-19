package com.familyguardian.events

import android.util.Log
import com.familyguardian.data.ApiClient
import com.familyguardian.data.Prefs
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class FcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val prefs = Prefs(applicationContext)
        CoroutineScope(Dispatchers.IO).launch {
            prefs.setFcmToken(token)
            uploadToken(prefs, token)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        val type = data["type"] ?: return
        val appCtx = applicationContext
        val userId = data["userId"]?.toLongOrNull()
        val displayName = data["displayName"]
        when (type) {
            "sos_active" -> {
                if (userId != null) {
                    Alerts.showSos(appCtx, GuardianEvent.SosActive(
                        id = data["id"]?.toLongOrNull() ?: 0L,
                        userId = userId,
                        displayName = displayName,
                        startedAt = data["startedAt"]?.toLongOrNull() ?: System.currentTimeMillis(),
                        lat = data["lat"]?.toDoubleOrNull(),
                        lng = data["lng"]?.toDoubleOrNull(),
                    ))
                }
            }
            "chat_message" -> {
                if (userId != null) {
                    Alerts.showChatMessage(appCtx, userId, displayName, data["body"] ?: "")
                }
            }
            "geofence_enter", "geofence_exit" -> {
                if (userId != null) {
                    Alerts.showGeofence(appCtx, userId, displayName, data["placeName"] ?: "", type == "geofence_enter")
                }
            }
            "check_in" -> {
                if (userId != null) {
                    Alerts.showCheckIn(appCtx, userId, displayName, data["status"] ?: "")
                }
            }
        }
    }

    companion object {
        private const val TAG = "FcmService"

        fun uploadToken(prefs: Prefs, token: String) {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val snap = prefs.snapshot()
                    val server = snap.serverUrl ?: return@launch
                    val authToken = snap.token ?: return@launch
                    val url = ApiClient.endpoint(server, "/api/users/me/fcm-token")
                    val json = JSONObject().apply {
                        put("token", token)
                        put("platform", "android")
                    }
                    val body = json.toString()
                        .toRequestBody(okhttp3.MediaType.Companion.parse("application/json"))
                    val request = Request.Builder()
                        .url(url)
                        .post(body)
                        .addHeader("Authorization", "Bearer $authToken")
                        .build()
                    ApiClient.okHttp.newCall(request).execute().use { resp ->
                        if (!resp.isSuccessful) Log.w(TAG, "FCM token upload failed: ${resp.code}")
                    }
                } catch (t: Throwable) {
                    Log.w(TAG, "FCM token upload error: ${t.message}")
                }
            }
        }
    }
}
