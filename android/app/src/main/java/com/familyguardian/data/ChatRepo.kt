package com.familyguardian.data

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
}
