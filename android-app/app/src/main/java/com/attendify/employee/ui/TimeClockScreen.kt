package com.attendify.employee.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Coffee
import androidx.compose.material.icons.filled.FreeBreakfast
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.ActivityItem
import com.attendify.employee.AttendifyApplication
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.UiState
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@Composable
fun TimeClockScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    onTakeBreak: () -> Unit = {},
) {
    var showCheckoutSheet by remember { mutableStateOf(false) }
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            nowMs = System.currentTimeMillis()
            delay(1_000)
        }
    }

    val attendance = state.attendance
    val openBreakMs = if (state.onBreak) {
        nowMs - (state.breakStartedAtMs ?: nowMs)
    } else {
        0L
    }
    val totalBreakMs = state.totalBreakMs + openBreakMs
    val elapsedWorkMs = workElapsedMs(attendance.checkInAt, nowMs, totalBreakMs, attendance.status == "CLOSED", attendance.netMinutes)
    val timerLabel = formatHms(elapsedWorkMs)
    val breakLabel = formatHm(totalBreakMs)
    val shiftEndLabel = formatShiftEnd(attendance.shiftEnd)
    val initial = state.firstName.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val canCheckout = !state.busy && state.locationReady && attendance.status == "OPEN"

    Box(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color(0xFFF7F5FF), Color(0xFFEEEAFF), Color(0xFFF7F5FF)),
                    ),
                )
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Spacer(Modifier.width(26.dp))
                Text(
                    "Time clock",
                    color = AttendifyIndigo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                NotificationBellButton(size = 24)
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(8.dp, RoundedCornerShape(18.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.White)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(AttendifyPurpleSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(initial, color = AttendifyPurple, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(state.firstName.ifBlank { "Employee" }, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text(
                        listOfNotNull(attendance.workplaceName, attendance.shiftWindow).joinToString(" | "),
                        color = AttendifyMuted,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = AttendifyMuted)
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(14.dp, RoundedCornerShape(24.dp), ambientColor = AttendifyPurple.copy(0.35f), spotColor = AttendifyPurple.copy(0.4f))
                    .clip(RoundedCornerShape(24.dp))
                    .background(
                        Brush.verticalGradient(listOf(Color(0xFF7B6CF0), AttendifyPurple, Color(0xFF5848D4))),
                    )
                    .padding(20.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Timer, null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("WORK TIME", color = Color.White.copy(alpha = 0.9f), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, letterSpacing = 1.sp)
                    Spacer(Modifier.weight(1f))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Color.White.copy(alpha = 0.18f))
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                    ) {
                        Box(Modifier.size(7.dp).clip(CircleShape).background(Color(0xFF7CFFB2)))
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (attendance.status == "CLOSED") "Checked out" else if (state.onBreak) "On break" else "Checked in",
                            color = Color.White,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
                Spacer(Modifier.height(18.dp))
                Text(
                    timerLabel,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 44.sp,
                    letterSpacing = 1.sp,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Checked in ${attendance.checkInLabel ?: "--"}",
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 14.sp,
                )
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatMiniCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.FreeBreakfast,
                    title = "Break time",
                    value = breakLabel,
                )
                StatMiniCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.AccessTime,
                    title = "Shift ends",
                    value = shiftEndLabel,
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(8.dp, RoundedCornerShape(22.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Color.White)
                    .padding(16.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Today's activity", color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                    Icon(Icons.Default.CalendarMonth, null, tint = AttendifyMuted, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(attendance.workDateLabel ?: todayLabel(), color = AttendifyMuted, fontSize = 12.sp)
                }
                Spacer(Modifier.height(14.dp))
                ActivityTimeline(items = state.activity)
            }

            if (attendance.status == "OPEN") {
                OutlinedActionButton(
                    label = "Take a break",
                    icon = Icons.Default.Coffee,
                    onClick = onTakeBreak,
                    enabled = !state.busy && !state.onBreak,
                )
                FilledActionButton(
                    label = "Check out",
                    icon = Icons.AutoMirrored.Filled.Logout,
                    onClick = { showCheckoutSheet = true },
                    enabled = canCheckout,
                )
            }

            if (state.error != null) {
                Text(state.error, color = Color(0xFFA11D3A), fontSize = 13.sp)
            }
            if (state.busy) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = AttendifyPurple, modifier = Modifier.size(28.dp))
                }
            }
        }

        if (showCheckoutSheet && !state.workListReminderVisible) {
            CheckoutSheet(
                state = state,
                workLabel = formatDurationWords(elapsedWorkMs),
                breakLabel = breakLabel,
                estimatedOut = SimpleDateFormat("hh:mm a", Locale.US).format(Date(nowMs)).uppercase(Locale.US),
                onDismiss = { showCheckoutSheet = false },
                onConfirm = {
                    showCheckoutSheet = false
                    viewModel.beginCheckOut()
                },
            )
        }
        if (state.workListReminderVisible) {
            WorkListReminderSheet(
                state = state,
                onContinue = viewModel::continueCheckOutDespiteWorkList,
                onGoBack = viewModel::dismissWorkListReminder,
            )
        }
    }
}

@Composable
private fun StatMiniCard(modifier: Modifier, icon: ImageVector, title: String, value: String) {
    Column(
        modifier = modifier
            .shadow(6.dp, RoundedCornerShape(18.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .padding(14.dp),
    ) {
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(AttendifyPurpleSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = AttendifyPurple, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.height(10.dp))
        Text(title, color = AttendifyMuted, fontSize = 12.sp)
        Text(value, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 20.sp)
    }
}

@Composable
private fun ActivityTimeline(items: List<ActivityItem>) {
    if (items.isEmpty()) {
        Text("No activity yet today.", color = AttendifyMuted, fontSize = 13.sp)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
        items.forEachIndexed { index, item ->
            Row(Modifier.fillMaxWidth()) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(AttendifyPurple))
                    if (index != items.lastIndex) {
                        Box(
                            Modifier
                                .width(2.dp)
                                .height(42.dp)
                                .background(AttendifyPurple.copy(alpha = 0.35f)),
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.padding(bottom = if (index == items.lastIndex) 0.dp else 12.dp)) {
                    Text(item.timeLabel, color = AttendifyMuted, fontSize = 12.sp)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(item.title, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        if (!item.badge.isNullOrBlank()) {
                            Spacer(Modifier.width(8.dp))
                            Text(
                                item.badge,
                                color = AttendifySuccess,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 11.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(AttendifySuccessBg)
                                    .padding(horizontal = 8.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OutlinedActionButton(label: String, icon: ImageVector, onClick: () -> Unit, enabled: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(16.dp))
            .border(1.5.dp, AttendifyPurple, RoundedCornerShape(16.dp))
            .background(Color.White)
            .clickable(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, tint = AttendifyPurple)
        Spacer(Modifier.width(8.dp))
        Text(label, color = AttendifyPurple, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

@Composable
private fun FilledActionButton(label: String, icon: ImageVector, onClick: () -> Unit, enabled: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (enabled) AttendifyPurple else AttendifyPurple.copy(alpha = 0.45f))
            .clickable(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, tint = Color.White)
        Spacer(Modifier.width(8.dp))
        Text(label, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

@Composable
private fun WorkListReminderSheet(
    state: UiState,
    onContinue: () -> Unit,
    onGoBack: () -> Unit,
) {
    val context = LocalContext.current
    val pmUrl = state.pmWebUrl
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f)),
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(Color.White)
                .padding(horizontal = 20.dp)
                .padding(top = 10.dp, bottom = 28.dp),
        ) {
            Box(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .width(42.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xFFD8D5E8)),
            )
            Spacer(Modifier.height(18.dp))
            Text(
                "Work list reminder",
                color = AttendifyIndigo,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                state.workListReminderMessage ?: AttendifyApplication.WORK_LIST_MESSAGE,
                color = AttendifyIndigo,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                textAlign = TextAlign.Start,
            )
            Spacer(Modifier.height(20.dp))
            FilledActionButton(
                label = "Continue Clock Out",
                icon = Icons.AutoMirrored.Filled.Logout,
                onClick = onContinue,
                enabled = !state.busy && !state.checkoutGateBusy,
            )
            Spacer(Modifier.height(10.dp))
            if (!pmUrl.isNullOrBlank()) {
                OutlinedActionButton(
                    label = "Open Project Management",
                    icon = Icons.AutoMirrored.Filled.OpenInNew,
                    onClick = {
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pmUrl)))
                        }
                    },
                    enabled = true,
                )
                Spacer(Modifier.height(10.dp))
            }
            OutlinedActionButton(
                label = "Go Back",
                icon = Icons.Default.AccessTime,
                onClick = onGoBack,
                enabled = !state.busy,
            )
        }
    }
}

@Composable
private fun CheckoutSheet(
    state: UiState,
    workLabel: String,
    breakLabel: String,
    estimatedOut: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable(onClick = onDismiss),
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(Color.White)
                .clickable(enabled = false) {}
                .padding(horizontal = 20.dp)
                .padding(top = 10.dp, bottom = 28.dp),
        ) {
            Box(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .width(42.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xFFD8D5E8)),
            )
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(AttendifyPurpleSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, null, tint = AttendifyPurple)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Finish your shift?", color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    Text("Review your work summary before checking out.", color = AttendifyMuted, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.height(20.dp))
            SummaryRow(Icons.AutoMirrored.Filled.Login, "Check-in", state.attendance.checkInLabel ?: "--")
            SummaryRow(Icons.AutoMirrored.Filled.Logout, "Check-out", estimatedOut)
            SummaryRow(Icons.Default.Timer, "Work time", workLabel)
            SummaryRow(Icons.Default.FreeBreakfast, "Breaks", breakLabel)
            Spacer(Modifier.height(18.dp))
            FilledActionButton("Confirm check-out", Icons.AutoMirrored.Filled.Logout, onConfirm, enabled = !state.busy && state.locationReady)
            Spacer(Modifier.height(10.dp))
            OutlinedActionButton("Keep working", Icons.Default.AccessTime, onDismiss, enabled = true)
        }
    }
}

@Composable
private fun SummaryRow(icon: ImageVector, label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(AttendifyPurpleSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = AttendifyPurple, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(label, color = AttendifyMuted, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

private fun workElapsedMs(
    checkInAt: String?,
    nowMs: Long,
    totalBreakMs: Long,
    closed: Boolean,
    netMinutes: Int?,
): Long {
    if (closed && netMinutes != null) return netMinutes * 60_000L
    val start = parseInstantMs(checkInAt) ?: return 0L
    return (nowMs - start - totalBreakMs).coerceAtLeast(0L)
}

private fun parseInstantMs(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
        ?: runCatching {
            val formats = listOf(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'",
                "yyyy-MM-dd HH:mm:ss",
            )
            for (pattern in formats) {
                val sdf = SimpleDateFormat(pattern, Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                val parsed = runCatching { sdf.parse(value)?.time }.getOrNull()
                if (parsed != null) return parsed
            }
            null
        }.getOrNull()
}

private fun formatHms(ms: Long): String {
    val totalSec = (ms / 1000).toInt().coerceAtLeast(0)
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return "%02d:%02d:%02d".format(h, m, s)
}

private fun formatHm(ms: Long): String {
    val totalMin = (ms / 60_000).toInt().coerceAtLeast(0)
    val h = totalMin / 60
    val m = totalMin % 60
    return "%02d:%02d".format(h, m)
}

private fun formatDurationWords(ms: Long): String {
    val totalMin = (ms / 60_000).toInt().coerceAtLeast(0)
    val h = totalMin / 60
    val m = totalMin % 60
    return "${h}h ${m}m"
}

private fun formatShiftEnd(shiftEnd: String?): String {
    if (shiftEnd.isNullOrBlank()) return "--"
    val parts = shiftEnd.split(":")
    if (parts.size < 2) return shiftEnd
    val hour = parts[0].toIntOrNull() ?: return shiftEnd
    val minute = parts[1].toIntOrNull() ?: 0
    val amPm = if (hour >= 12) "PM" else "AM"
    val h12 = when {
        hour == 0 -> 12
        hour > 12 -> hour - 12
        else -> hour
    }
    return "%02d:%02d %s".format(h12, minute, amPm)
}

private fun todayLabel(): String = SimpleDateFormat("dd-MM-yyyy", Locale.US).format(Date())
