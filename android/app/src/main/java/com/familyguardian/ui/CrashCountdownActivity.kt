package com.familyguardian.ui

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.familyguardian.data.CrashRepo
import com.familyguardian.data.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class CrashCountdownActivity : ComponentActivity() {

    private var toneGenerator: ToneGenerator? = null
    private var vibrator: Vibrator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                    or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        )

        val crashEventId = intent.getLongExtra("crashEventId", -1L)
        val lat = intent.getDoubleExtra("lat", Double.NaN).let { if (it.isNaN()) null else it }
        val lng = intent.getDoubleExtra("lng", Double.NaN).let { if (it.isNaN()) null else it }
        val accuracyM = intent.getDoubleExtra("accuracyM", Double.NaN).let { if (it.isNaN()) null else it }

        vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        toneGenerator = ToneGenerator(AudioManager.STREAM_ALARM, 100)

        val vibePattern = longArrayOf(0, 500, 500, 500)
        vibrator?.let { v ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(vibePattern, 0))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(vibePattern, 0)
            }
        }

        setContent {
            MaterialTheme {
                var remaining by remember { mutableStateOf(30_000L) }
                var expired by remember { mutableStateOf(false) }
                var cancelled by remember { mutableStateOf(false) }
                val context = LocalContext.current

                LaunchedEffect(Unit) {
                    while (remaining > 0 && !cancelled) {
                        kotlinx.coroutines.delay(100)
                        remaining -= 100
                        try {
                            toneGenerator?.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 80)
                        } catch (_: Exception) {}
                    }
                    if (!cancelled) {
                        expired = true
                        val prefs = Prefs(context.applicationContext)
                        val repo = CrashRepo(prefs)
                        try {
                            repo.activateCrashSos(crashEventId, lat, lng, accuracyM)
                        } catch (_: Exception) {}
                        vibrator?.cancel()
                        toneGenerator?.stopTone()
                        toneGenerator?.release()
                        finish()
                    }
                }

                DisposableEffect(Unit) {
                    onDispose {
                        vibrator?.cancel()
                        toneGenerator?.stopTone()
                        toneGenerator?.release()
                    }
                }

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0xFFBA1A1A)),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            text = "CRASH DETECTED",
                            color = Color.White,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "${(remaining / 1000) + 1}",
                            color = Color.White,
                            fontSize = 72.sp,
                            fontWeight = FontWeight.Black,
                        )
                        Text(
                            text = "seconds until SOS",
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 16.sp,
                        )
                        Spacer(modifier = Modifier.height(32.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            OutlinedButton(
                                onClick = {
                                    cancelled = true
                                    vibrator?.cancel()
                                    toneGenerator?.stopTone()
                                    toneGenerator?.release()
                                    val prefs = Prefs(context.applicationContext)
                                    CoroutineScope(Dispatchers.IO).launch {
                                        try { CrashRepo(prefs).dismiss(crashEventId) } catch (_: Exception) {}
                                    }
                                    finish()
                                },
                                colors = ButtonDefaults.outlinedButtonColors(
                                    containerColor = Color.White,
                                    contentColor = Color(0xFFBA1A1A),
                                ),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text("I'M OK — CANCEL", fontWeight = FontWeight.Bold)
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            OutlinedButton(
                                onClick = {
                                    cancelled = true
                                    vibrator?.cancel()
                                    toneGenerator?.stopTone()
                                    toneGenerator?.release()
                                    val prefs = Prefs(context.applicationContext)
                                    CoroutineScope(Dispatchers.IO).launch {
                                        try {
                                            CrashRepo(prefs).activateCrashSos(crashEventId, lat, lng, accuracyM)
                                        } catch (_: Exception) {}
                                    }
                                    finish()
                                },
                                colors = ButtonDefaults.outlinedButtonColors(
                                    containerColor = Color.White,
                                    contentColor = Color(0xFFBA1A1A),
                                ),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text("Send SOS now", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        vibrator?.cancel()
        toneGenerator?.stopTone()
        toneGenerator?.release()
    }

    @Deprecated("Use OnBackPressedCallback instead")
    override fun onBackPressed() {
        // Ignore back press during crash countdown
    }
}
