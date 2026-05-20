package com.familyguardian.data

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import okhttp3.ResponseBody
import retrofit2.Response
import java.io.File

class AccountRepo(private val prefs: Prefs) {

    suspend fun exportData(context: Context) {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/users/me/export")
        val response = ApiClient.api.exportData(url, "Bearer $token")
        if (!response.isSuccessful) {
            val errBody = response.errorBody()?.string()
            throw Exception("Export failed: ${response.code()} $errBody")
        }
        val body = response.body() ?: throw Exception("Empty response")
        val fileName = response.headers()["content-disposition"]
            ?.let { Regex("""filename="([^"]+)"""").find(it)?.groupValues?.get(1) }
            ?: "family-guardian-export.json"
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val file = File(downloadsDir, fileName)
        file.outputStream().use { out -> body.byteStream().use { it.copyTo(out) } }
    }

    suspend fun deleteAccount(password: String) {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/users/me")
        val response = ApiClient.api.deleteAccount(url, "Bearer $token", DeleteAccountBody(password))
        if (response.code() == 409) throw AdminHandoffRequired()
        if (response.code() == 401) throw WrongPassword()
        if (!response.isSuccessful) throw Exception("Delete failed: ${response.code()}")
    }

    suspend fun promoteAdmin(circleId: Long, userId: Long) {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: error("not signed in")
        val token = s.token ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/admins/$userId")
        ApiClient.api.promoteAdmin(url, "Bearer $token")
    }

    class AdminHandoffRequired : Exception("requires_admin_handoff")
    class WrongPassword : Exception("wrong_password")
}
