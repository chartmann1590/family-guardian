package com.familyguardian.location

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.familyguardian.MainActivity
import com.familyguardian.R
import com.familyguardian.data.Prefs
import com.familyguardian.events.Alerts
import com.familyguardian.events.EventBus
import com.familyguardian.events.EventStreamClient
import com.familyguardian.events.GuardianEvent
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class LocationService : Service() {

    companion object {
        private const val NOTIF_CHANNEL = "fg_location"
        private const val NOTIF_ID = 1001
        const val ACTION_START = "com.familyguardian.location.START"
        const val ACTION_STOP  = "com.familyguardian.location.STOP"

        fun start(context: Context) {
            val intent = Intent(context, LocationService::class.java).apply { action = ACTION_START }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, LocationService::class.java).apply { action = ACTION_STOP }
            context.startService(intent)
        }
    }

    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var reporter: LocationReporter? = null
    private var eventStream: EventStreamClient? = null
    private val client by lazy { LocationServices.getFusedLocationProviderClient(this) }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val fix = result.lastLocation ?: return
            val batteryPct = currentBatteryPct()
            updateNotification(lastFixAtMs = fix.time, batteryPct = batteryPct)
            scope.launch {
                reporter?.report(
                    lat = fix.latitude,
                    lng = fix.longitude,
                    accuracyM = if (fix.hasAccuracy()) fix.accuracy.toDouble() else null,
                    speedMps  = if (fix.hasSpeed()) fix.speed.toDouble() else null,
                    batteryPct = batteryPct,
                    recordedAtMs = fix.time,
                )
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        val prefs = Prefs(applicationContext)
        reporter = LocationReporter(prefs)
        ensureChannel()
        eventStream = EventStreamClient(prefs, scope).also { stream ->
            stream.start()
            scope.launch { observeEvents(prefs, stream) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopSelfWithService(); return START_NOT_STICKY }
        }
        startForegroundCompat()
        if (!hasLocationPermission()) {
            stopSelfWithService()
            return START_NOT_STICKY
        }
        requestUpdates()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        client.removeLocationUpdates(callback)
        eventStream?.shutdown()
        eventStream = null
        scope.cancel()
        super.onDestroy()
    }

    /**
     * Forwards inbound WebSocket events to the system notification tray, filtering
     * out events caused by this user (we already see our own SOS in the app UI).
     */
    private suspend fun observeEvents(prefs: Prefs, stream: EventStreamClient) {
        stream.events.collectLatest { ev ->
            // Republish so foreground UIs (chat, map) can react in real time.
            EventBus.emit(ev)

            val selfId = prefs.snapshot().userId
            when (ev) {
                is GuardianEvent.SosActive -> {
                    if (ev.userId != selfId) Alerts.showSos(applicationContext, ev)
                }
                is GuardianEvent.SosResolved -> {
                    Alerts.cancelSos(applicationContext, ev.id)
                }
                is GuardianEvent.GeofenceEnter -> {
                    if (ev.userId != selfId) {
                        Alerts.showGeofence(
                            context = applicationContext,
                            userId = ev.userId,
                            displayName = ev.displayName,
                            placeName = ev.placeName,
                            entered = true,
                        )
                    }
                }
                is GuardianEvent.GeofenceExit -> {
                    if (ev.userId != selfId) {
                        Alerts.showGeofence(
                            context = applicationContext,
                            userId = ev.userId,
                            displayName = ev.displayName,
                            placeName = ev.placeName,
                            entered = false,
                        )
                    }
                }
                is GuardianEvent.ChatMessage -> {
                    if (ev.userId != selfId) {
                        Alerts.showChatMessage(
                            context = applicationContext,
                            userId = ev.userId,
                            displayName = ev.displayName,
                            body = ev.body,
                        )
                    }
                }
                is GuardianEvent.CheckIn -> {
                    if (ev.userId != selfId) {
                        Alerts.showCheckIn(
                            context = applicationContext,
                            userId = ev.userId,
                            displayName = ev.displayName,
                            status = ev.status,
                        )
                    }
                }
                else -> Unit
            }
        }
    }

    private fun requestUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 30_000L)
            .setMinUpdateIntervalMillis(15_000L)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        } catch (sec: SecurityException) {
            stopSelfWithService()
        }
    }

    private fun stopSelfWithService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION") stopForeground(true)
        }
        stopSelf()
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun ensureChannel() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(NOTIF_CHANNEL) != null) return
        val channel = NotificationChannel(
            NOTIF_CHANNEL,
            getString(R.string.notif_channel_location),
            NotificationManager.IMPORTANCE_LOW,
        ).apply { description = getString(R.string.notif_channel_location_desc) }
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(lastFixAtMs: Long?, batteryPct: Int?): android.app.Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
            PendingIntent.FLAG_IMMUTABLE,
        )
        val text = buildString {
            if (lastFixAtMs == null) {
                append(getString(R.string.notif_sharing_text))
            } else {
                val time = android.text.format.DateFormat.getTimeFormat(this@LocationService)
                    .format(java.util.Date(lastFixAtMs))
                append("Last update ").append(time)
                if (batteryPct != null) append(" • battery ").append(batteryPct).append('%')
            }
        }
        return NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.notif_sharing_title))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun startForegroundCompat() {
        val notification = buildNotification(lastFixAtMs = null, batteryPct = null)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun updateNotification(lastFixAtMs: Long?, batteryPct: Int?) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(lastFixAtMs, batteryPct))
    }

    private fun currentBatteryPct(): Int? {
        val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return if (pct in 0..100) pct else null
    }
}
