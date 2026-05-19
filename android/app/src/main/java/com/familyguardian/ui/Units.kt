package com.familyguardian.ui

import java.util.Locale

private val IMPERIAL_COUNTRIES = setOf("US", "LR", "MM")

fun isImperialLocale(locale: Locale = Locale.getDefault()): Boolean =
    locale.country in IMPERIAL_COUNTRIES

fun formatSpeed(mps: Double?, locale: Locale = Locale.getDefault()): String {
    if (mps == null) return "—"
    return if (isImperialLocale(locale)) {
        String.format(locale, "%.1f mph", mps * 2.2369362921)
    } else {
        String.format(locale, "%.1f km/h", mps * 3.6)
    }
}

fun formatDistance(meters: Double?, locale: Locale = Locale.getDefault()): String {
    if (meters == null) return "—"
    return if (isImperialLocale(locale)) {
        val miles = meters / 1609.344
        if (miles >= 0.1) String.format(locale, "%.1f mi", miles)
        else String.format(locale, "%d ft", (meters * 3.2808).toInt())
    } else {
        if (meters >= 1000) String.format(locale, "%.1f km", meters / 1000)
        else String.format(locale, "%d m", meters.toInt())
    }
}

fun formatDuration(ms: Long?): String {
    if (ms == null || ms < 0) return "—"
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    return when {
        h > 0 -> "${h}h ${m}m"
        m > 0 -> "${m}m"
        else -> "<1m"
    }
}

fun activityLabel(activity: String?): String? = when (activity) {
    "driving" -> "Driving"
    "walking" -> "Walking"
    "running" -> "Running"
    "cycling" -> "Cycling"
    "still" -> "Stationary"
    "unknown", null -> null
    else -> activity.replaceFirstChar { it.uppercase() }
}
