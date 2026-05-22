package com.familyguardian.location

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.SensorManager.SENSOR_DELAY_GAME
import com.familyguardian.data.CrashRepo
import com.familyguardian.data.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CrashDetector(
    private val context: Context,
    private val prefs: Prefs,
    private val onCrashDetected: (crashEventId: Long) -> Unit,
) : SensorEventListener {

    private val sensorManager by lazy { context.getSystemService(Context.SENSOR_SERVICE) as SensorManager }
    private val linearAccelSensor by lazy { sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val windowMs = 100L
    private val thresholdMps2 = 30.0
    private val minSustainedMs = 100L
    private val minSpeedMps = 5.0
    private val maxFixAgeMs = 60_000L
    private val cooldownMs = 300_000L

    private var magnitudeBuffer = mutableListOf<Pair<Long, Double>>()
    private var lastDetectionMs = 0L

    @Volatile var lastSpeedMps: Double? = null
    @Volatile var lastFixAtMs: Long = 0L
    @Volatile var currentActivity: String? = null

    private var registered = false

    fun start() {
        if (registered) return
        if (linearAccelSensor == null) return
        sensorManager.registerListener(this, linearAccelSensor, SENSOR_DELAY_GAME)
        registered = true
    }

    fun stop() {
        if (!registered) return
        sensorManager.unregisterListener(this)
        registered = false
        magnitudeBuffer.clear()
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event == null) return
        val x = event.values[0].toDouble()
        val y = event.values[1].toDouble()
        val z = event.values[2].toDouble()
        val mag = Math.sqrt(x * x + y * y + z * z)
        val now = System.currentTimeMillis()

        magnitudeBuffer.add(now to mag)
        val cutoff = now - windowMs
        magnitudeBuffer.removeAll { it.first < cutoff }

        val sustainedMs = magnitudeBuffer.last().first - magnitudeBuffer.first().first
        val peakMag = magnitudeBuffer.maxOf { it.second }

        if (peakMag >= thresholdMps2 && sustainedMs >= minSustainedMs) {
            magnitudeBuffer.clear()
            if (now - lastDetectionMs < cooldownMs) return

            val speed = lastSpeedMps
            if (speed == null || speed < minSpeedMps) return
            if (now - lastFixAtMs > maxFixAgeMs) return
            val activity = currentActivity
            if (activity != null && activity != "driving" && activity != "in_vehicle") return

            lastDetectionMs = now
            scope.launch {
                try {
                    val repo = CrashRepo(prefs)
                    val peakX = magnitudeBuffer.maxOfOrNull { 0.0 } ?: x
                    val result = repo.report(
                        peakAccelMps2 = peakMag,
                        sustainedMs = sustainedMs.toInt(),
                        peakAxisX = x,
                        peakAxisY = y,
                        peakAxisZ = z,
                        speedMps = speed,
                        activity = activity,
                        platform = "android",
                    )
                    onCrashDetected(result.id)
                } catch (_: Exception) {}
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
