package com.familyguardian.data

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

class ChatRepo(private val prefs: Prefs) {

    private suspend fun bearer(): Pair<String, String>? {
        val s = prefs.snapshot()
        val server = s.serverUrl ?: return null
        val token = s.token ?: return null
        return server to "Bearer $token"
    }

    suspend fun list(circleId: Long): List<ChatMessage> {
        val (server, auth) = bearer() ?: return emptyList()
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/messages")
        return ApiClient.api.listMessages(url, auth).messages
    }

    suspend fun send(circleId: Long, body: String): ChatMessage {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/messages")
        return ApiClient.api.sendMessage(url, auth, SendMessageBody(body.trim()))
    }

    suspend fun sendAttachment(circleId: Long, file: File, kind: String, body: String? = null, durationMs: Long? = null): ChatMessage {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/messages/attachment")
        val mimeType = when (kind) {
            "image" -> "image/jpeg"
            "audio" -> "audio/mp4"
            else -> "application/octet-stream"
        }
        val fileBody = file.asRequestBody(mimeType.toMediaTypeOrNull())
        val filePart = MultipartBody.Part.createFormData("file", file.name, fileBody)
        val kindBody = kind.toRequestBody("text/plain".toMediaTypeOrNull())
        val parts = mutableListOf<Pair<String, okhttp3.RequestBody>>()
        val multipartBuilder = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("kind", kind)
            .addFormDataPart("file", file.name, fileBody)
        if (body != null) multipartBuilder.addFormDataPart("body", body)
        if (durationMs != null) multipartBuilder.addFormDataPart("durationMs", durationMs.toString())
        val multipart = multipartBuilder.build()
        return ApiClient.api.sendAttachment(url, auth, multipart)
    }

    suspend fun react(messageId: Long, emoji: String) {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/messages/$messageId/reactions")
        ApiClient.api.addReaction(url, auth, AddReactionBody(emoji))
    }

    suspend fun unreact(messageId: Long, emoji: String) {
        val (server, auth) = bearer() ?: error("not signed in")
        val url = ApiClient.endpoint(server, "/api/messages/$messageId/reactions/${java.net.URLEncoder.encode(emoji, "UTF-8")}")
        ApiClient.api.removeReaction(url, auth)
    }

    suspend fun sendTyping(circleId: Long) {
        val (server, auth) = bearer() ?: return
        val url = ApiClient.endpoint(server, "/api/circles/$circleId/typing")
        ApiClient.api.sendTyping(url, auth)
    }

    suspend fun markRead(messageIds: List<Long>) {
        val (server, auth) = bearer() ?: return
        val url = ApiClient.endpoint(server, "/api/messages/read-batch")
        ApiClient.api.markRead(url, auth, mapOf("messageIds" to messageIds))
    }
}
