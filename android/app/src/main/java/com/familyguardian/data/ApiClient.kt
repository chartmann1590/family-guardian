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
import retrofit2.http.HTTP
import retrofit2.http.POST
import retrofit2.http.PATCH
import retrofit2.http.Url
import java.util.concurrent.TimeUnit

/**
 * Retrofit-style API surface. We intentionally pass full URLs at call time so
 * a single Retrofit instance can talk to whichever server URL the user has
 * configured in [Prefs] — no rebuild required when the URL changes.
 */
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
}

object ApiClient {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val okHttp = OkHttpClient.Builder()
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
            // baseUrl is ignored at call sites (they pass @Url) but Retrofit
            // requires one. Any valid URL works.
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
