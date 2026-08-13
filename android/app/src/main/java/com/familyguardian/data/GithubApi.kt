package com.familyguardian.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface GithubApi {
    @POST("issue")
    suspend fun createIssue(
        @Body body: CreateIssueRequest
    ): GithubIssue

    @GET("issue/{number}")
    suspend fun getIssue(
        @Path("number") number: Int
    ): GithubIssue

    @GET("issue/{number}/comments")
    suspend fun getComments(
        @Path("number") number: Int
    ): List<GithubComment>

    @POST("issue/{number}/comments")
    suspend fun postComment(
        @Path("number") number: Int,
        @Body body: PostCommentRequest
    ): GithubComment

    @POST("upload-image")
    suspend fun uploadAsset(
        @Body body: UploadAssetRequest
    ): UploadAssetResponse
}

/**
 * Talks to the cloudflare-worker/ feedback relay, not api.github.com directly. See
 * cloudflare-worker/src/index.ts, which holds the GitHub token server-side as a Worker
 * secret. Previously this embedded BuildConfig.GITHUB_API_TOKEN client-side as a Bearer
 * header, which shipped a real repo-write PAT in every release build (extractable from
 * the APK).
 */
object GithubClient {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val okHttp = OkHttpClient.Builder()
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .build()

    val api: GithubApi by lazy {
        Retrofit.Builder()
            .baseUrl("https://family-guardian-github-feedback.charles-h-hartmann1.workers.dev/")
            .client(okHttp)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(GithubApi::class.java)
    }
}
