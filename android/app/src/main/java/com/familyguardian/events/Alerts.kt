package com.familyguardian.events

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.familyguardian.MainActivity
import com.familyguardian.R

/**
 * Wraps Android notification plumbing for SOS + geofence alerts. Two channels:
 *  - fg_alerts_high   — heads-up for SOS (IMPORTANCE_HIGH)
 *  - fg_alerts_normal — geofence enter/exit (IMPORTANCE_DEFAULT)
 *
 * Each event-source carries a stable notification id so a sos_resolved cancels
 * the earlier sos_active for the same event id.
 */
object Alerts {
    const val CHANNEL_HIGH = "fg_alerts_high"
    const val CHANNEL_NORMAL = "fg_alerts_normal"

    private fun ensureChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_HIGH) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_HIGH,
                    context.getString(R.string.notif_channel_alerts_high),
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = context.getString(R.string.notif_channel_alerts_high_desc)
                    enableVibration(true)
                    enableLights(true)
                },
            )
        }
        if (nm.getNotificationChannel(CHANNEL_NORMAL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_NORMAL,
                    context.getString(R.string.notif_channel_alerts_normal),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = context.getString(R.string.notif_channel_alerts_normal_desc)
                },
            )
        }
    }

    /**
     * Android 13+ requires POST_NOTIFICATIONS. Without it, [NotificationManager.notify]
     * is a silent no-op — the worst kind of failure. Skip work upfront and log once
     * per call site so missing permission is debuggable from logcat.
     */
    private fun canPostNotifications(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) Log.w("Alerts", "POST_NOTIFICATIONS not granted; dropping notification")
        return granted
    }

    private fun openAppIntent(context: Context, mapsUri: Uri? = null): PendingIntent {
        val intent = mapsUri?.let { Intent(Intent.ACTION_VIEW, it) }
            ?: Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
        return PendingIntent.getActivity(
            context, 0, intent, PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun showSos(context: Context, event: GuardianEvent.SosActive) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val prefix = if (event.source == "crash") "🚨 Crash SOS from" else "🚨 SOS from"
        val title = "$prefix ${event.displayName ?: "a family member"}"
        val text = if (event.lat != null && event.lng != null) {
            "Last location: ${"%.4f".format(event.lat)}, ${"%.4f".format(event.lng)}"
        } else "Location unavailable"
        val mapsUri = if (event.lat != null && event.lng != null) {
            Uri.parse("geo:${event.lat},${event.lng}?q=${event.lat},${event.lng}(SOS)")
        } else null
        val notif = NotificationCompat.Builder(context, CHANNEL_HIGH)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text + (event.note?.let { "\n\"$it\"" } ?: "")))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setColor(0xFFBA1A1A.toInt())
            .setOngoing(true)
            .setContentIntent(openAppIntent(context, mapsUri))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(sosNotifId(event.id), notif)
    }

    fun cancelSos(context: Context, sosId: Long) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(sosNotifId(sosId))
    }

    fun showChatMessage(
        context: Context,
        userId: Long,
        displayName: String?,
        body: String,
    ) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val title = displayName ?: "Family chat"
        val notif = NotificationCompat.Builder(context, CHANNEL_NORMAL)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(chatNotifId(userId), notif)
    }

    fun cancelChat(context: Context, userId: Long) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(chatNotifId(userId))
    }

    fun showGeofence(
        context: Context,
        userId: Long,
        displayName: String?,
        placeName: String,
        entered: Boolean,
    ) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val name = displayName ?: "Someone"
        val title = if (entered) "$name arrived at $placeName" else "$name left $placeName"
        val notif = NotificationCompat.Builder(context, CHANNEL_NORMAL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(title)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(geofenceNotifId(userId, placeName, entered), notif)
    }

    fun showCheckIn(
        context: Context,
        userId: Long,
        displayName: String?,
        status: String,
    ) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val name = displayName ?: "Someone"
        val label = when (status) {
            "safe_home" -> "safe at home"
            "out_safe" -> "out & safe"
            "heading_home" -> "heading home"
            else -> status
        }
        val title = "$name checked in: $label"
        val notif = NotificationCompat.Builder(context, CHANNEL_NORMAL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(title)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(checkinNotifId(userId), notif)
    }

    fun showSpeeding(context: Context, userId: Long, displayName: String?, speedMps: Double) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val name = displayName ?: "Someone"
        val mph = speedMps * 2.2369
        val title = "$name is going fast"
        val text = "Current speed: ${"%.0f".format(mph)} mph (${"%.0f".format(speedMps * 3.6)} km/h)"
        val notif = NotificationCompat.Builder(context, CHANNEL_HIGH)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(speedingNotifId(userId), notif)
    }

    fun showLowBattery(context: Context, userId: Long, displayName: String?, batteryPct: Int) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val name = displayName ?: "Someone"
        val notif = NotificationCompat.Builder(context, CHANNEL_NORMAL)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("$name's phone battery is low")
            .setContentText("Battery at ${batteryPct}%")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(lowBatteryNotifId(userId), notif)
    }

    fun showOffline(context: Context, userId: Long, displayName: String?, minutesOffline: Int) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val name = displayName ?: "Someone"
        val notif = NotificationCompat.Builder(context, CHANNEL_NORMAL)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle("Haven't heard from $name")
            .setContentText("No location for $minutesOffline min")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(offlineNotifId(userId), notif)
    }

    private fun sosNotifId(eventId: Long): Int = 1_000_000 + (eventId.toInt() and 0xFFFFF)
    private fun geofenceNotifId(userId: Long, placeName: String, entered: Boolean): Int {
        val base = (userId.toInt() * 31 + placeName.hashCode()) and 0xFFFFF
        return (if (entered) 2_000_000 else 3_000_000) + base
    }
    private fun chatNotifId(userId: Long): Int = 4_000_000 + (userId.toInt() and 0xFFFFF)
    private fun checkinNotifId(userId: Long): Int = 5_000_000 + (userId.toInt() and 0xFFFFF)
    private fun speedingNotifId(userId: Long): Int = 6_000_000 + (userId.toInt() and 0xFFFFF)
    private fun lowBatteryNotifId(userId: Long): Int = 7_000_000 + (userId.toInt() and 0xFFFFF)
    private fun offlineNotifId(userId: Long): Int = 8_000_000 + (userId.toInt() and 0xFFFFF)

    fun showCrashPending(context: Context, event: GuardianEvent.CrashPending) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val title = "⚠️ Possible crash: ${event.displayName ?: "a member"}"
        val text = "Waiting for confirmation…"
        val notif = NotificationCompat.Builder(context, CHANNEL_HIGH)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setColor(0xFFBA1A1A.toInt())
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(crashNotifId(event.crashEventId), notif)
    }

    private fun crashNotifId(eventId: Long): Int = 9_000_000 + (eventId.toInt() and 0xFFFFF)

    fun showRoutineDeviation(
        context: Context,
        userId: Long,
        displayName: String?,
        placeName: String,
        kind: String,
    ) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val name = displayName ?: "Someone"
        val title = "Routine deviation"
        val text = when (kind) {
            "overstay" -> "$name still at $placeName past usual time"
            "early_departure" -> "$name left $placeName earlier than usual"
            else -> "$name may have missed arrival at $placeName"
        }
        val notif = NotificationCompat.Builder(context, CHANNEL_NORMAL)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(routineDeviationNotifId(userId, placeName), notif)
    }

    private fun routineDeviationNotifId(userId: Long, placeName: String): Int =
        10_000_000 + ((userId.toInt() * 31 + placeName.hashCode()) and 0xFFFFF)

    fun showEta(context: Context, displayName: String, etaMinutes: Int, destLabel: String) {
        show(context, "eta_${displayName}", "ETA Update", "$displayName · $etaMinutes min to $destLabel", CHANNEL_NORMAL)
    }

    fun showArrivedSafely(context: Context, displayName: String, placeName: String) {
        show(context, "arrived_${displayName}", "Arrived Safely", "$displayName arrived at $placeName", CHANNEL_NORMAL)
    }

    fun showBreakNudge(context: Context, drivingHours: Int) {
        show(context, "break_nudge", "Break Reminder", "You've been driving ${drivingHours}hr+. Time for a quick break?", CHANNEL_NORMAL)
    }

    private fun show(context: Context, tag: String, title: String, text: String, channel: String) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val notif = NotificationCompat.Builder(context, channel)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(if (channel == CHANNEL_HIGH) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(tag.hashCode(), notif)
    }

    fun showDigest(context: Context) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notif = NotificationCompat.Builder(context, CHANNEL_NORMAL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Weekly digest ready")
            .setContentText("Your family's weekly summary is available.")
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        nm.notify(11_000_000, notif)
    }
}
