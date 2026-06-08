package com.familyguardian.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.bugReportDataStore by preferencesDataStore(name = "feedback_bug_reports")

class BugReportRepo(private val context: Context) {
    private val keyBugReports = stringPreferencesKey("bug_reports_list")

    val bugReports: Flow<List<BugReport>> = context.bugReportDataStore.data.map {
        val jsonStr = it[keyBugReports] ?: "[]"
        try {
            Json.decodeFromString<List<BugReport>>(jsonStr)
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun saveBugReport(report: BugReport) {
        context.bugReportDataStore.edit { prefs ->
            val currentList = getBugReportsList()
            val newList = currentList.filter { it.number != report.number } + report
            prefs[keyBugReports] = Json.encodeToString(newList)
        }
    }

    suspend fun updateBugReports(reports: List<BugReport>) {
        context.bugReportDataStore.edit { prefs ->
            prefs[keyBugReports] = Json.encodeToString(reports)
        }
    }

    suspend fun getBugReportsList(): List<BugReport> {
        val jsonStr = context.bugReportDataStore.data.map { it[keyBugReports] }.first() ?: "[]"
        return try {
            Json.decodeFromString<List<BugReport>>(jsonStr)
        } catch (_: Exception) {
            emptyList()
        }
    }
}
