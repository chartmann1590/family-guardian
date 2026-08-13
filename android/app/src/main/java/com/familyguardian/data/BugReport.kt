package com.familyguardian.data

import kotlinx.serialization.Serializable

@Serializable
data class BugReport(
    val number: Int,
    val title: String,
    val status: String, // "open" or "closed"
    val createdAt: String,
    val htmlUrl: String
)

@Serializable
data class CreateIssueRequest(
    val title: String,
    val body: String
)

@Serializable
data class GithubIssue(
    val number: Int,
    val title: String,
    val state: String, // "open" or "closed"
    val html_url: String,
    val created_at: String,
    val body: String? = null
)

@Serializable
data class GithubUser(
    val login: String
)

@Serializable
data class GithubComment(
    val id: Long,
    val body: String,
    val created_at: String,
    val user: GithubUser
)

@Serializable
data class PostCommentRequest(
    val body: String
)

@Serializable
data class UploadAssetRequest(
    val filename: String,
    val contentBase64: String
)

@Serializable
data class UploadAssetContent(
    val download_url: String
)

@Serializable
data class UploadAssetResponse(
    val content: UploadAssetContent
)
