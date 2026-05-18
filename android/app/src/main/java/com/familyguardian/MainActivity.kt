package com.familyguardian

import android.os.Bundle
import android.preference.PreferenceManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import com.familyguardian.ui.FamilyGuardianTheme
import com.familyguardian.ui.MapScreen
import com.familyguardian.ui.PlacesScreen
import com.familyguardian.ui.ServerConfigScreen
import org.osmdroid.config.Configuration

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // osmdroid wants a user agent before any tile fetch.
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
    val startRoute = remember { mutableStateOf<String?>(null) }

    LaunchedEffect(token) {
        startRoute.value = if (token.isNullOrBlank()) "login" else "map"
    }

    val start = startRoute.value ?: return

    NavHost(navController = nav, startDestination = start) {
        composable("login") {
            ServerConfigScreen(
                onLoggedIn = {
                    nav.navigate("map") {
                        popUpTo("login") { inclusive = true }
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
            )
        }
        composable("places") {
            PlacesScreen(onBack = { nav.popBackStack() })
        }
    }
}
