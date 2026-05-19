package com.familyguardian.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

private val Context.dataStore by preferencesDataStore(name = "family_guardian")

class Prefs(private val context: Context) {
    private val keyServerUrl   = stringPreferencesKey("server_url")
    private val keyToken       = stringPreferencesKey("session_token")
    private val keyEmail       = stringPreferencesKey("email")
    private val keyDisplayName = stringPreferencesKey("display_name")
    private val keyCircleId    = longPreferencesKey("circle_id")
    private val keyUserId      = longPreferencesKey("user_id")
    private val keyOnboarded   = booleanPreferencesKey("onboarded")
    private val keyFcmToken    = stringPreferencesKey("fcm_token")

    val serverUrl: Flow<String?>   = context.dataStore.data.map { it[keyServerUrl] }
    val token:     Flow<String?>   = context.dataStore.data.map { it[keyToken] }
    val email:     Flow<String?>   = context.dataStore.data.map { it[keyEmail] }
    val displayName: Flow<String?> = context.dataStore.data.map { it[keyDisplayName] }
    val circleId:  Flow<Long?>     = context.dataStore.data.map { it[keyCircleId] }
    val userId:    Flow<Long?>     = context.dataStore.data.map { it[keyUserId] }
    val onboarded: Flow<Boolean>   = context.dataStore.data.map { it[keyOnboarded] ?: false }
    val fcmToken: Flow<String?>    = context.dataStore.data.map { it[keyFcmToken] }

    suspend fun snapshot(): Snapshot = context.dataStore.data.map {
        Snapshot(
            serverUrl   = it[keyServerUrl],
            token       = it[keyToken],
            email       = it[keyEmail],
            displayName = it[keyDisplayName],
            circleId    = it[keyCircleId],
            userId      = it[keyUserId],
            onboarded   = it[keyOnboarded] ?: false,
        )
    }.first()

    /**
     * For non-suspending call sites (e.g. OkHttp interceptors) that need a
     * read of the current session token. Blocks the calling thread briefly.
     */
    fun snapshotBlocking(): Snapshot = runBlocking { snapshot() }

    suspend fun setServerUrl(url: String) = context.dataStore.edit { it[keyServerUrl] = url.trim() }

    suspend fun setOnboarded(value: Boolean) = context.dataStore.edit { it[keyOnboarded] = value }

    suspend fun setDisplayName(name: String) = context.dataStore.edit { it[keyDisplayName] = name }

    suspend fun setFcmToken(token: String) = context.dataStore.edit { it[keyFcmToken] = token }

    suspend fun saveSession(
        token: String,
        email: String,
        displayName: String,
        circleId: Long?,
        userId: Long?,
    ) = context.dataStore.edit {
        it[keyToken] = token
        it[keyEmail] = email
        it[keyDisplayName] = displayName
        if (circleId != null) it[keyCircleId] = circleId else it.remove(keyCircleId)
        if (userId != null) it[keyUserId] = userId else it.remove(keyUserId)
    }

    suspend fun clearSession() = context.dataStore.edit { prefs ->
        prefs.remove(keyToken)
        prefs.remove(keyEmail)
        prefs.remove(keyDisplayName)
        prefs.remove(keyCircleId)
        prefs.remove(keyUserId)
    }

    data class Snapshot(
        val serverUrl: String?,
        val token: String?,
        val email: String?,
        val displayName: String?,
        val circleId: Long?,
        val userId: Long?,
        val onboarded: Boolean = false,
    )
}
