package com.familyguardian.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Family Guardian (mobile) design tokens.
private val FgPrimary           = Color(0xFF004AC6)
private val FgOnPrimary         = Color(0xFFFFFFFF)
private val FgPrimaryContainer  = Color(0xFF2563EB)
private val FgOnPrimaryContainer= Color(0xFFEEEFFF)
private val FgSecondary         = Color(0xFF006C49)
private val FgOnSecondary       = Color(0xFFFFFFFF)
private val FgSecondaryContainer= Color(0xFF6CF8BB)
private val FgError             = Color(0xFFBA1A1A)
private val FgOnError           = Color(0xFFFFFFFF)
private val FgBackground        = Color(0xFFF8F9FF)
private val FgOnBackground      = Color(0xFF0B1C30)
private val FgSurface           = Color(0xFFFFFFFF)
private val FgSurfaceVariant    = Color(0xFFE5EEFF)
private val FgOnSurfaceVariant  = Color(0xFF434655)
private val FgOutline           = Color(0xFF737686)
private val FgOutlineVariant    = Color(0xFFC3C6D7)

private val ColorScheme = lightColorScheme(
    primary             = FgPrimary,
    onPrimary           = FgOnPrimary,
    primaryContainer    = FgPrimaryContainer,
    onPrimaryContainer  = FgOnPrimaryContainer,
    secondary           = FgSecondary,
    onSecondary         = FgOnSecondary,
    secondaryContainer  = FgSecondaryContainer,
    error               = FgError,
    onError             = FgOnError,
    background          = FgBackground,
    onBackground        = FgOnBackground,
    surface             = FgSurface,
    onSurface           = FgOnBackground,
    surfaceVariant      = FgSurfaceVariant,
    onSurfaceVariant    = FgOnSurfaceVariant,
    outline             = FgOutline,
    outlineVariant      = FgOutlineVariant,
)

private val FgTypography = Typography(
    headlineLarge = TextStyle(fontSize = 30.sp, fontWeight = FontWeight.Bold, lineHeight = 38.sp),
    headlineMedium = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.Bold, lineHeight = 32.sp),
    headlineSmall = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Normal, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 20.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.05.sp),
)

@Composable
fun FamilyGuardianTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ColorScheme,
        typography  = FgTypography,
        content     = content,
    )
}
