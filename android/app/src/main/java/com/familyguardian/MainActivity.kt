package com.familyguardian

import android.os.Bundle
import android.preference.PreferenceManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.familyguardian.data.Prefs
import com.familyguardian.ui.ChatScreen
import com.familyguardian.ui.FamilyGuardianTheme
import com.familyguardian.ui.MapScreen
import com.familyguardian.ui.MemberDetailScreen
import com.familyguardian.ui.MemberInfo
import com.familyguardian.ui.OnboardingScreen
import com.familyguardian.ui.PlacesScreen
import com.familyguardian.ui.ServerConfigScreen
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
            )
        }
    }
}
