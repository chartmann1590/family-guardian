package com.familyguardian.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity
import java.util.concurrent.atomic.AtomicReference

/**
 * Cached output of the Activity Recognition API. [LocationService] reads it
 * when a fresh GPS fix arrives so the upload payload can include
 * driving/walking/etc. without having to call the API synchronously.
 */
data class ActivitySample(val type: String, val confidence: Int, val sampledAt: Long)

private val latest = AtomicReference<ActivitySample?>(null)

fun latestActivitySample(): ActivitySample? = latest.get()

private fun activityCode(type: Int): String = when (type) {
    DetectedActivity.STILL -> "still"
    DetectedActivity.WALKING -> "walking"
    DetectedActivity.ON_FOOT -> "walking"
    DetectedActivity.RUNNING -> "running"
    DetectedActivity.ON_BICYCLE -> "cycling"
    DetectedActivity.IN_VEHICLE -> "driving"
    DetectedActivity.TILTING -> "unknown"
    else -> "unknown"
}

class ActivityRecognitionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!ActivityRecognitionResult.hasResult(intent)) return
        val result = ActivityRecognitionResult.extractResult(intent) ?: return
        val top = result.mostProbableActivity ?: return
        latest.set(
            ActivitySample(
                type = activityCode(top.type),
                confidence = top.confidence,
                sampledAt = System.currentTimeMillis(),
            ),
        )
    }
}
