package com.attendify.employee.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.UiState
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class HomeTab { Home, Attendance, Team, Requests, Profile }
private enum class BreakFlow { None, Setup }

@Composable
fun HomeScreen(state: UiState, viewModel: AttendifyViewModel) {
    var tab by remember { mutableStateOf(HomeTab.Home) }
    var breakFlow by remember { mutableStateOf(BreakFlow.None) }

    // When a break becomes active (or ends), leave the setup screen.
    LaunchedEffect(state.onBreak) {
        if (state.onBreak) breakFlow = BreakFlow.None
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AttendifyBackground)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                tab == HomeTab.Home && state.onBreak -> BreakActiveScreen(
                    state = state,
                    viewModel = viewModel,
                    onBack = { /* stay on break until ended */ },
                )
                tab == HomeTab.Home && breakFlow == BreakFlow.Setup -> BreakSetupScreen(
                    state = state,
                    viewModel = viewModel,
                    onBack = { breakFlow = BreakFlow.None },
                )
                tab == HomeTab.Home -> {
                    if (state.attendance.status == "OPEN" || state.attendance.status == "CLOSED") {
                        TimeClockScreen(
                            state = state,
                            viewModel = viewModel,
                            onTakeBreak = { breakFlow = BreakFlow.Setup },
                        )
                    } else {
                        HomeDashboard(state, viewModel)
                    }
                }
                tab == HomeTab.Attendance -> Column(Modifier.fillMaxSize()) {
                    AttendanceHistoryScreen(state, viewModel)
                    if (!state.historyMessage.isNullOrBlank()) {
                        Text(
                            state.historyMessage,
                            color = AttendifyPurple,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                        )
                    }
                }
                tab == HomeTab.Team -> TeamApprovalsHub(state, viewModel)
                tab == HomeTab.Requests -> RequestsHubScreen(state, viewModel)
                else -> ProfileHubScreen(state, viewModel)
            }
        }
        BottomNav(
            selected = tab,
            isManager = state.isManager,
            onSelect = { next ->
                // Leaving break setup via another tab cancels the setup flow.
                if (next != HomeTab.Home) breakFlow = BreakFlow.None
                tab = next
            },
        )
    }
}

@Composable
private fun HomeDashboard(state: UiState, viewModel: AttendifyViewModel) {
    val attendance = state.attendance
    var now by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = Date()
            delay(1_000)
        }
    }
    val timeLabel = remember(now) {
        SimpleDateFormat("hh:mm a", Locale.US).format(now).uppercase(Locale.US)
    }
    val dateLabel = attendance.workDateLabel ?: remember(now) {
        SimpleDateFormat("dd-MM-yyyy", Locale.US).format(now)
    }
    val initial = state.firstName.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val status = attendance.status
    val canPunch = !state.busy && state.locationReady && status != "OPEN" && status != "CLOSED"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 12.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(AttendifyPurpleSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(initial, color = AttendifyPurple, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                }
                Spacer(Modifier.width(12.dp))
                Text(
                    text = buildString {
                        append(state.greeting.ifBlank { "Hello" })
                        append(", ")
                    },
                    color = AttendifyIndigo,
                    fontSize = 18.sp,
                )
                Text(
                    text = state.firstName.ifBlank { "there" },
                    color = AttendifyIndigo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
            }
            NotificationBellButton()
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Ready for your day?",
                color = AttendifyIndigo,
                fontWeight = FontWeight.Bold,
                fontSize = 28.sp,
                lineHeight = 34.sp,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.CalendarMonth, contentDescription = null, tint = AttendifyMuted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(dateLabel, color = AttendifyMuted, fontSize = 14.sp)
            }
        }

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                timeLabel,
                color = AttendifyIndigo,
                fontWeight = FontWeight.Bold,
                fontSize = 28.sp,
            )

            PunchButton(
                label = "CHECK IN",
                enabled = canPunch,
                onClick = viewModel::checkIn,
            )

            LocationReadyPill(ready = state.locationReady, status = status)
        }

        LocationMapCard(
            workplace = attendance.workplaceName ?: "Workplace",
            address = state.locationAddress,
            verified = state.locationReady,
            onRefresh = viewModel::refreshLocationStatus,
        )

        ReminderCard(
            title = "Attendance reminder",
            subtitle = when (status) {
                null -> "Check in when you arrive."
                "OPEN" -> "Remember to check out when you leave."
                else -> "Shift complete for today."
            },
        )

        if (state.error != null) {
            Text(state.error, color = Color(0xFFA11D3A), fontSize = 13.sp)
        }
        if (state.message != null) {
            Text(state.message, color = AttendifyPurple, fontSize = 13.sp)
        }
        if (state.busy) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = AttendifyPurple, modifier = Modifier.size(28.dp))
            }
        }
    }
}

@Composable
private fun PunchButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(168.dp)
            .shadow(
                elevation = if (enabled) 22.dp else 6.dp,
                shape = CircleShape,
                ambientColor = AttendifyPurple.copy(alpha = 0.45f),
                spotColor = AttendifyPurple.copy(alpha = 0.55f),
            )
            .clip(CircleShape)
            .background(
                brush = Brush.verticalGradient(
                    colors = if (enabled) {
                        listOf(Color(0xFF8B7CF7), AttendifyPurple, Color(0xFF5A49D6))
                    } else {
                        listOf(Color(0xFFB8B0E8), Color(0xFF9A90D8))
                    },
                ),
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.TouchApp, contentDescription = null, tint = Color.White, modifier = Modifier.size(42.dp))
            Spacer(Modifier.height(6.dp))
            Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 0.5.sp)
        }
    }
}

@Composable
private fun LocationReadyPill(ready: Boolean, status: String?) {
    val text = when {
        status == "CLOSED" -> "Shift already checked out"
        ready -> "Inside workplace area"
        else -> "Waiting for location"
    }
    val tint = if (ready || status == "CLOSED") AttendifySuccess else Color(0xFFA11D3A)
    val bg = if (ready || status == "CLOSED") AttendifySuccessBg else Color(0xFFFFEBEE)
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(Icons.Default.CheckCircle, null, tint = tint, modifier = Modifier.size(16.dp))
        Text(text, color = tint, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}

@Composable
private fun LocationMapCard(
    workplace: String,
    address: String?,
    verified: Boolean,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(10.dp, RoundedCornerShape(22.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .clip(RoundedCornerShape(22.dp))
            .background(Color.White),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(168.dp)
                .background(Color(0xFFF0EEFA)),
        ) {
            StylizedMap(workplace = workplace)
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onRefresh)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                tint = if (verified) AttendifySuccess else AttendifyMuted,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (verified) "Location verified" else "Verifying location…",
                    color = AttendifyIndigo,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                )
                if (!address.isNullOrBlank()) {
                    Text(address, color = AttendifyMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = AttendifyMuted)
        }
    }
}

@Composable
private fun StylizedMap(workplace: String) {
    Box(Modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            drawRect(Color(0xFFF3F1FB))

            val road = Color(0xFFE2DEEF)
            val roadStroke = 14.dp.toPx()
            // Horizontal roads
            drawLine(road, Offset(0f, h * 0.28f), Offset(w, h * 0.28f), roadStroke, StrokeCap.Round)
            drawLine(road, Offset(0f, h * 0.62f), Offset(w, h * 0.62f), roadStroke, StrokeCap.Round)
            // Vertical roads
            drawLine(road, Offset(w * 0.22f, 0f), Offset(w * 0.22f, h), roadStroke, StrokeCap.Round)
            drawLine(road, Offset(w * 0.55f, 0f), Offset(w * 0.55f, h), roadStroke, StrokeCap.Round)
            drawLine(road, Offset(w * 0.78f, 0f), Offset(w * 0.78f, h), roadStroke, StrokeCap.Round)

            // Soft geofence circle
            val center = Offset(w * 0.52f, h * 0.48f)
            drawCircle(color = AttendifyPurple.copy(alpha = 0.12f), radius = 56.dp.toPx(), center = center)
            drawCircle(
                color = AttendifyPurple.copy(alpha = 0.35f),
                radius = 56.dp.toPx(),
                center = center,
                style = Stroke(width = 2.dp.toPx()),
            )

            // Pin drop
            val pinTop = Offset(center.x, center.y - 18.dp.toPx())
            drawCircle(AttendifyPurple, radius = 10.dp.toPx(), center = pinTop)
            drawCircle(Color.White, radius = 4.dp.toPx(), center = pinTop)
            val tip = Path().apply {
                moveTo(center.x - 8.dp.toPx(), center.y - 10.dp.toPx())
                lineTo(center.x + 8.dp.toPx(), center.y - 10.dp.toPx())
                lineTo(center.x, center.y + 8.dp.toPx())
                close()
            }
            drawPath(tip, AttendifyPurple)
        }
        Text(
            text = workplace,
            color = AttendifyIndigo,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.sp,
            modifier = Modifier
                .align(Alignment.Center)
                .padding(top = 52.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Color.White.copy(alpha = 0.92f))
                .padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun ReminderCard(title: String, subtitle: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(8.dp, RoundedCornerShape(20.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .clip(RoundedCornerShape(20.dp))
            .background(Color.White)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(AttendifyPurpleSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Notifications, null, tint = AttendifyPurple)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(subtitle, color = AttendifyMuted, fontSize = 13.sp)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = AttendifyMuted)
    }
}

@Composable
private fun BottomNav(selected: HomeTab, isManager: Boolean, onSelect: (HomeTab) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(16.dp, ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .background(Color.White)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        NavItem(HomeTab.Home, "Home", Icons.Outlined.Home, Icons.Filled.Home, selected, onSelect)
        if (isManager) {
            NavItem(HomeTab.Team, "Team", Icons.Outlined.Groups, Icons.Filled.Groups, selected, onSelect)
        } else {
            NavItem(HomeTab.Attendance, "Attendance", Icons.Outlined.CalendarMonth, Icons.Filled.CalendarMonth, selected, onSelect)
        }
        NavItem(HomeTab.Requests, "Requests", Icons.Outlined.Description, Icons.Filled.Description, selected, onSelect)
        NavItem(HomeTab.Profile, "Profile", Icons.Outlined.Person, Icons.Filled.Person, selected, onSelect)
    }
}

@Composable
private fun NavItem(
    tab: HomeTab,
    label: String,
    outlined: ImageVector,
    filled: ImageVector,
    selected: HomeTab,
    onSelect: (HomeTab) -> Unit,
) {
    val active = selected == tab
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .then(
                if (active) Modifier.background(AttendifyPurpleSoft)
                else Modifier,
            )
            .clickable { onSelect(tab) }
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Icon(
            imageVector = if (active) filled else outlined,
            contentDescription = label,
            tint = if (active) AttendifyPurple else AttendifyMuted,
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            color = if (active) AttendifyPurple else AttendifyMuted,
            fontSize = 11.sp,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

@Composable
private fun PlaceholderTab(
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 24.sp)
        Text(body, color = AttendifyMuted, fontSize = 15.sp, lineHeight = 22.sp)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                actionLabel,
                color = AttendifyPurple,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(onClick = onAction),
            )
        }
    }
}
