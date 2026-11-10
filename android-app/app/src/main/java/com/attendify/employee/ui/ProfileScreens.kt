package com.attendify.employee.ui

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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.BeachAccess
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.RosterDay
import com.attendify.employee.UiState
import java.time.LocalDate

private val SignOutBg = Color(0xFFFFEBEE)
private val SignOutFg = Color(0xFFC62828)
private val SummaryBg = Color(0xFFE8F5E9)
private val SummaryFg = Color(0xFF2E7D32)
private val TodayBg = Color(0xFFEDEBFF)

@Composable
fun ProfileHubScreen(state: UiState, viewModel: AttendifyViewModel) {
    var showRoster by remember { mutableStateOf(false) }
    var showChangePasscode by remember { mutableStateOf(false) }
    when {
        showChangePasscode -> ChangeAppPasscodeScreen(
            state = state,
            viewModel = viewModel,
            onBack = {
                viewModel.clearChangePasscodeFields()
                showChangePasscode = false
            },
        )
        showRoster -> ShiftRosterScreen(
            state = state,
            viewModel = viewModel,
            onBack = { showRoster = false },
        )
        else -> MyProfileScreen(
            state = state,
            onOpenRoster = { showRoster = true },
            onChangePasscode = {
                viewModel.clearChangePasscodeFields(clearFeedback = true)
                showChangePasscode = true
            },
            onSignOut = viewModel::signOut,
        )
    }
}

@Composable
private fun MyProfileScreen(
    state: UiState,
    onOpenRoster: () -> Unit,
    onChangePasscode: () -> Unit,
    onSignOut: () -> Unit,
) {
    val initials = state.profileInitials.ifBlank {
        state.firstName.take(2).uppercase().ifBlank { "?" }
    }
    val subtitle = listOfNotNull(
        state.department,
        state.employeeCode,
    ).joinToString(" • ").ifBlank { "Employee" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AttendifyBackground)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("My profile", color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 28.sp)

        state.message?.let {
            Text(it, color = SummaryFg, fontSize = 13.sp)
        }
        state.error?.let {
            Text(it, color = Color(0xFFC62828), fontSize = 13.sp)
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(6.dp, RoundedCornerShape(20.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.White)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(AttendifyPurpleSoft),
                contentAlignment = Alignment.Center,
            ) {
                Text(initials, color = AttendifyPurple, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(
                    state.fullName.ifBlank { state.firstName.ifBlank { "Employee" } },
                    color = AttendifyIndigo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
                Text(subtitle, color = AttendifyMuted, fontSize = 13.sp)
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(6.dp, RoundedCornerShape(20.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.White)
                .padding(horizontal = 14.dp, vertical = 6.dp),
        ) {
            InfoRow(Icons.Default.Email, "Work email", state.email.ifBlank { "—" })
            InfoRow(Icons.Default.Business, "Workplace", state.workplaceName ?: "Head Office")
            InfoRow(Icons.Default.Groups, "Reporting manager", state.reportingManager ?: "Operations Manager", showDivider = false)
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(6.dp, RoundedCornerShape(20.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.White),
        ) {
            val context = LocalContext.current
            MenuRow(Icons.Default.Schedule, "My shift roster", onClick = onOpenRoster)
            MenuRow(
                Icons.Default.Notifications,
                "Notifications",
                onClick = { openNotificationsFromMenu(context) },
            )
            MenuRow(Icons.Default.Lock, "Change app passcode", onClick = onChangePasscode)
            MenuRow(Icons.AutoMirrored.Filled.HelpOutline, "Help & support", onClick = {}, showDivider = false)
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(SignOutBg)
                .clickable(onClick = onSignOut)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, tint = SignOutFg)
            Spacer(Modifier.width(10.dp))
            Text("Sign out", color = SignOutFg, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

@Composable
private fun ChangeAppPasscodeScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    onBack: () -> Unit,
) {
    val canSubmit = !state.busy &&
        state.changeCurrentPasscode.length >= 4 &&
        state.changeNewPasscode.length >= 6 &&
        state.changeConfirmPasscode.length >= 6

    LaunchedEffect(state.message, state.changeCurrentPasscode, state.busy) {
        if (
            !state.busy &&
            state.changeCurrentPasscode.isEmpty() &&
            state.message?.contains("passcode was updated", ignoreCase = true) == true
        ) {
            onBack()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AttendifyBackground)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.fillMaxWidth()) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = AttendifyIndigo,
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .size(24.dp)
                    .clickable(enabled = !state.busy, onClick = onBack),
            )
            Text(
                "Change app passcode",
                color = AttendifyIndigo,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        Text(
            "Enter your current app passcode, then choose a new one (6–16 letters or digits). " +
                "We will email a confirmation — not the new passcode.",
            color = AttendifyMuted,
            fontSize = 13.sp,
        )

        PasscodeField(
            value = state.changeCurrentPasscode,
            onValueChange = viewModel::updateChangeCurrentPasscode,
            label = "Current passcode",
            enabled = !state.busy,
        )
        PasscodeField(
            value = state.changeNewPasscode,
            onValueChange = viewModel::updateChangeNewPasscode,
            label = "New passcode",
            enabled = !state.busy,
        )
        PasscodeField(
            value = state.changeConfirmPasscode,
            onValueChange = viewModel::updateChangeConfirmPasscode,
            label = "Confirm new passcode",
            enabled = !state.busy,
        )

        state.error?.let {
            Text(it, color = Color(0xFFC62828), fontSize = 13.sp)
        }
        state.message?.let {
            Text(it, color = SummaryFg, fontSize = 13.sp)
        }

        Button(
            onClick = viewModel::submitChangePasscode,
            enabled = canSubmit,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = AttendifyPurple,
                contentColor = Color.White,
                disabledContainerColor = AttendifyPurple.copy(alpha = 0.4f),
            ),
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    color = Color.White,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(22.dp),
                )
            } else {
                Text("Update passcode", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            }
        }
    }
}

@Composable
private fun PasscodeField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = true,
        label = { Text(label) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = AttendifyPurple,
            unfocusedBorderColor = Color(0xFFE4E1F0),
            focusedLabelColor = AttendifyPurple,
            cursorColor = AttendifyPurple,
            focusedContainerColor = Color.White,
            unfocusedContainerColor = Color.White,
        ),
    )
}

@Composable
private fun ShiftRosterScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    onBack: () -> Unit,
) {
    var weekStart by remember {
        mutableStateOf(state.rosterWeekStart ?: mondayOf(LocalDate.now()).toString())
    }
    LaunchedEffect(weekStart) {
        viewModel.loadShiftRoster(weekStart)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AttendifyBackground)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.fillMaxWidth()) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = AttendifyIndigo,
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .size(24.dp)
                    .clickable(onClick = onBack),
            )
            Text(
                "My shift roster",
                color = AttendifyIndigo,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .border(1.dp, Color(0xFFE4E1F0), RoundedCornerShape(14.dp))
                .background(Color.White)
                .clickable {
                    // Jump to previous / next week via long-press style: tap cycles next week; hold not needed.
                    // Use left/right by tapping edges conceptually: here advance one week on tap.
                    weekStart = LocalDate.parse(weekStart).plusWeeks(1).toString()
                }
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.CalendarMonth, null, tint = AttendifyPurple)
            Spacer(Modifier.width(10.dp))
            Text(
                state.rosterWeekLabel ?: "Loading week…",
                color = AttendifyIndigo,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                modifier = Modifier.weight(1f),
            )
            Text(
                "Prev",
                color = AttendifyPurple,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                modifier = Modifier.clickable {
                    weekStart = LocalDate.parse(weekStart).minusWeeks(1).toString()
                },
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "Next",
                color = AttendifyPurple,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                modifier = Modifier.clickable {
                    weekStart = LocalDate.parse(weekStart).plusWeeks(1).toString()
                },
            )
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(999.dp))
                .background(SummaryBg)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Icon(Icons.Default.CalendarMonth, null, tint = SummaryFg, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                state.rosterSummaryLabel ?: "—",
                color = SummaryFg,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
            )
        }

        if (state.rosterBusy) {
            Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = AttendifyPurple)
            }
        }

        state.rosterDays.forEach { day ->
            RosterDayCard(day)
        }

        if (!state.rosterError.isNullOrBlank()) {
            Text(state.rosterError, color = Color(0xFFA11D3A), fontSize = 13.sp)
        }
    }
}

@Composable
private fun RosterDayCard(day: RosterDay) {
    val bg = if (day.isToday) TodayBg else Color.White
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(4.dp, RoundedCornerShape(16.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            day.dayLabel,
            color = AttendifyIndigo,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            modifier = Modifier.width(92.dp),
        )
        Column(Modifier.weight(1f)) {
            if (day.isOff) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.BeachAccess, null, tint = AttendifyMuted, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(day.offLabel ?: "Weekly off", color = AttendifyMuted, fontSize = 14.sp)
                }
            } else {
                Text(day.shiftName ?: "Shift", color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(day.shiftWindow ?: "", color = AttendifyMuted, fontSize = 12.sp)
            }
        }
        if (day.isToday) {
            Text(
                "Today",
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(AttendifyPurple)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun InfoRow(icon: ImageVector, label: String, value: String, showDivider: Boolean = true) {
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp),
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
            Column {
                Text(label, color = AttendifyMuted, fontSize = 12.sp)
                Text(value, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }
        if (showDivider) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFF0EEF6)))
        }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, onClick: () -> Unit, showDivider: Boolean = true) {
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, tint = AttendifyPurple, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(12.dp))
            Text(label, color = AttendifyIndigo, fontWeight = FontWeight.Medium, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = AttendifyMuted)
        }
        if (showDivider) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFF0EEF6)))
        }
    }
}

private fun mondayOf(date: LocalDate): LocalDate {
    val offset = ((date.dayOfWeek.value + 6) % 7).toLong()
    return date.minusDays(offset)
}
