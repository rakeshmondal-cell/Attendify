package com.attendify.employee.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val AttendifyIndigo = Color(0xFF1A1A5E)
val AttendifyPurple = Color(0xFF6C5CE7)
val AttendifyPurpleSoft = Color(0xFFEDEBFF)
val AttendifyBackground = Color(0xFFF7F5FF)
val AttendifySuccess = Color(0xFF2E7D32)
val AttendifySuccessBg = Color(0xFFE8F5E9)
val AttendifyMuted = Color(0xFF6B6B8D)
val AttendifyCardShadow = Color(0x1A1A1A5E)

private val LightColors = lightColorScheme(
    primary = AttendifyPurple,
    onPrimary = Color.White,
    secondary = AttendifyIndigo,
    onSecondary = Color.White,
    background = AttendifyBackground,
    onBackground = AttendifyIndigo,
    surface = Color.White,
    onSurface = AttendifyIndigo,
    error = Color(0xFFA11D3A),
)

private val AppTypography = Typography(
    headlineLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        color = AttendifyIndigo,
    ),
    headlineMedium = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        color = AttendifyIndigo,
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        color = AttendifyIndigo,
    ),
    bodyLarge = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        color = AttendifyIndigo,
    ),
    bodyMedium = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        color = AttendifyMuted,
    ),
    labelLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 14.sp,
        color = AttendifyIndigo,
    ),
)

@Composable
fun AttendifyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = AppTypography,
        content = content,
    )
}
