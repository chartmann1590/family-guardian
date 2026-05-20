package com.familyguardian.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PATCH
import retrofit2.http.Url
import java.util.concurrent.TimeUnit

interface GuardianApi {
    @POST
    suspend fun login(@Url url: String, @Body body: LoginRequest): LoginResponse

    @POST
    suspend fun signup(@Url url: String, @Body body: SignupRequest): LoginResponse

    @POST
    suspend fun postLocation(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: LocationReport,
    ): OkResponse

    @GET
    suspend fun me(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): Map<String, kotlinx.serialization.json.JsonElement>

    @GET
    suspend fun listMembers(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): MembersResponse

    @GET
    suspend fun listPlaces(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): PlacesResponse

    @POST
    suspend fun createPlace(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: PlaceBody,
    ): Place

    @PATCH
    suspend fun patchPlace(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: PlaceBody,
    ): Place

    @DELETE
    suspend fun deletePlace(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): OkResponse

    @POST
    suspend fun activateSos(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: SosActivateBody,
    ): SosEvent

    @POST
    suspend fun resolveSos(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): SosEvent

    @GET
    suspend fun listActiveSos(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): SosListResponse

    @GET
    suspend fun listMessages(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): MessagesResponse

    @POST
    suspend fun sendMessage(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: SendMessageBody,
    ): ChatMessage

    @GET
    suspend fun getHistory(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): HistoryResponse

    @POST
    suspend fun sendCheckin(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: CheckinBody,
    ): CheckinResponse

    @GET
    suspend fun getVisits(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): VisitsResponse

    @GET
    suspend fun getTrips(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): TripsResponse

    @GET
    suspend fun getAlertPrefs(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): AlertPrefs

    @PATCH
    suspend fun patchAlertPrefs(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: AlertPrefs,
    ): AlertPrefs

    @GET
    suspend fun getAlerts(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): AlertsResponse

    @GET
    suspend fun getPauseState(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): PauseState

    @POST
    suspend fun setPause(
        @Url url: String,
        @Header("Authorization") auth: String,
        @Body body: PauseBody,
    ): PauseState

    @DELETE
    suspend fun clearPause(
        @Url url: String,
        @Header("Authorization") auth: String,
    ): PauseState
}

object ApiClient {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    val okHttp = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .addInterceptor(Interceptor { chain ->
            val req = chain.request().newBuilder()
                .header("User-Agent", "FamilyGuardian-Android/0.1")
                .header("Accept", "application/json")
                .build()
            chain.proceed(req)
        })
        .build()

    val api: GuardianApi by lazy {
        Retrofit.Builder()
            .baseUrl("http://localhost/")
            .client(okHttp)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(GuardianApi::class.java)
    }

    fun endpoint(serverUrl: String, path: String): String {
        val trimmed = serverUrl.trim().trimEnd('/')
        return "$trimmed$path"
    }
}