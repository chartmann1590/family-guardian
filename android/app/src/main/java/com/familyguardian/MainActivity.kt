package com.familyguardian

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.preference.PreferenceManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.familyguardian.data.Prefs
import com.familyguardian.location.LocationService
import com.familyguardian.ui.AlertHistoryScreen
import com.familyguardian.ui.AlertSettingsScreen
import com.familyguardian.ui.AboutScreen
import com.familyguardian.ui.ChatScreen
import com.familyguardian.ui.FamilyGuardianTheme
import com.familyguardian.ui.MapScreen
import com.familyguardian.ui.MemberDetailScreen
import com.familyguardian.ui.MemberInfo
import com.familyguardian.ui.OnboardingScreen
import com.familyguardian.ui.PlacesScreen
import com.familyguardian.ui.ServerConfigScreen
import com.familyguardian.ui.TripsScreen
import com.familyguardian.ui.VisitsScreen
import org.osmdroid.config.Configuration

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Configuration.getInstance().apply {
            userAgentValue = packageName
            load(applicationContext, PreferenceManager.getDefaultSharedPreferences(applicationContext))
        }

        setContent {
            FamilyGuardianTheme {
                AppRoot()
            }
        }
    }
}

@Composable
private fun AppRoot() {
    val nav = rememberNavController()
    val context = androidx.compose.ui.platform.LocalContext.current
    val prefs = remember { Prefs(context.applicationContext) }
    val token by prefs.token.collectAsStateWithLifecycle(initialValue = null)
    val onboarded by prefs.onboarded.collectAsStateWithLifecycle(initialValue = true)
    val startRoute = remember { mutableStateOf<String?>(null) }

    LaunchedEffect(token, onboarded) {
        startRoute.value = when {
            token.isNullOrBlank() -> "login"
            !onboarded -> "onboarding"
            else -> "map"
        }
        // Keep the foreground location service running whenever the user is
        // signed in and has granted location permission — independent of which
        // screen they happen to be on. The service is idempotent; calling
        // start() while it's already running is a no-op.
        if (!token.isNullOrBlank() && hasLocationPermission(context)) {
            LocationService.start(context.applicationContext)
        }
    }

    val start = startRoute.value ?: return

    NavHost(navController = nav, startDestination = start) {
        composable("login") {
            ServerConfigScreen(
                onLoggedIn = {
                    // AuthRepo sets `onboarded` based on login vs joinWithInvite;
                    // navigate via the same decision logic so the wizard shows up
                    // only for fresh accounts.
                    val next = if (prefs.snapshotBlocking().onboarded) "map" else "onboarding"
                    nav.navigate(next) {
                        popUpTo("login") { inclusive = true }
                    }
                },
            )
        }
        composable("onboarding") {
            OnboardingScreen(
                onDone = {
                    nav.navigate("map") {
                        popUpTo("onboarding") { inclusive = true }
                    }
                },
            )
        }
        composable("map") {
            MapScreen(
                onLoggedOut = {
                    nav.navigate("login") {
                        popUpTo("map") { inclusive = true }
                    }
                },
                onOpenPlaces = { nav.navigate("places") },
                onOpenChat = { nav.navigate("chat") },
                onOpenMember = { userId, displayName ->
                    nav.navigate("member/$userId/$displayName")
                },
                onOpenAlertSettings = { nav.navigate("alert-settings") },
                onOpenAlertHistory = { nav.navigate("alert-history") },
                onOpenAbout = { nav.navigate("about") },
            )
        }
        composable("places") {
            PlacesScreen(onBack = { nav.popBackStack() })
        }
        composable("chat") {
            ChatScreen(onBack = { nav.popBackStack() })
        }
        composable("member/{userId}/{displayName}") { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId")?.toLongOrNull() ?: return@composable Box {}
            val displayName = java.net.URLDecoder.decode(
                backStackEntry.arguments?.getString("displayName") ?: "Member", "UTF-8"
            )
            val circleId by prefs.circleId.collectAsStateWithLifecycle(initialValue = null)
            val cid = circleId ?: return@composable Box {}
            MemberDetailScreen(
                member = MemberInfo(userId = userId, displayName = displayName),
                circleId = cid,
                onBack = { nav.popBackStack() },
                onOpenVisits = { nav.navigate("visits/$cid/$userId/$displayName") },
                onOpenTrips = { nav.navigate("trips/$cid/$userId/$displayName") },
            )
        }
        composable("visits/{circleId}/{userId}/{displayName}") { backStackEntry ->
            val cid = backStackEntry.arguments?.getString("circleId")?.toLongOrNull() ?: return@composable Box {}
            val userId = backStackEntry.arguments?.getString("userId")?.toLongOrNull() ?: return@composable Box {}
            val displayName = java.net.URLDecoder.decode(
                backStackEntry.arguments?.getString("displayName") ?: "Member", "UTF-8"
            )
            VisitsScreen(circleId = cid, userId = userId, displayName = displayName, onBack = { nav.popBackStack() })
        }
        composable("trips/{circleId}/{userId}/{displayName}") { backStackEntry ->
            val cid = backStackEntry.arguments?.getString("circleId")?.toLongOrNull() ?: return@composable Box {}
            val userId = backStackEntry.arguments?.getString("userId")?.toLongOrNull() ?: return@composable Box {}
            val displayName = java.net.URLDecoder.decode(
                backStackEntry.arguments?.getString("displayName") ?: "Member", "UTF-8"
            )
            TripsScreen(circleId = cid, userId = userId, displayName = displayName, onBack = { nav.popBackStack() })
        }
        composable("alert-settings") {
            AlertSettingsScreen(onBack = { nav.popBackStack() })
        }
        composable("alert-history") {
            AlertHistoryScreen(onBack = { nav.popBackStack() })
        }
        composable("about") {
            AboutScreen(onBack = { nav.popBackStack() })
        }
    }
}

private fun hasLocationPermission(ctx: android.content.Context): Boolean =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
