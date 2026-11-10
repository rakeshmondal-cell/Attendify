package com.attendify.employee.ui

import android.app.DatePickerDialog
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.LeaveTypeOption
import com.attendify.employee.RequestItem
import com.attendify.employee.UiState
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

private val PendingBg = Color(0xFFFFF3E0)
private val PendingFg = Color(0xFFEF6C00)
private val RejectBg = Color(0xFFFFEBEE)
private val RejectFg = Color(0xFFC62828)
private val FilterIdle = Color(0xFFF0EEF8)

private enum class RequestFilter { All, Pending, Approved }

@Composable
fun RequestsHubScreen(state: UiState, viewModel: AttendifyViewModel) {
    var showApply by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.loadRequests() }

    if (showApply) {
        ApplyLeaveScreen(
            state = state,
            viewModel = viewModel,
            onBack = { showApply = false },
            onSubmitted = {
                showApply = false
                viewModel.loadRequests()
            },
        )
    } else {
        MyRequestsScreen(
            state = state,
            onApply = { showApply = true },
        )
    }
}

@Composable
private fun MyRequestsScreen(state: UiState, onApply: () -> Unit) {
    var filter by remember { mutableStateOf(RequestFilter.All) }
    val initial = state.firstName.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val filtered = remember(state.requests, filter) {
        when (filter) {
            RequestFilter.All -> state.requests
            RequestFilter.Pending -> state.requests.filter { it.status == "PENDING" }
            RequestFilter.Approved -> state.requests.filter { it.status == "APPROVED" }
        }
    }

    Box(Modifier.fillMaxSize().background(AttendifyBackground)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(42.dp)
                            .clip(CircleShape)
                            .background(AttendifyPurpleSoft),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(initial, color = AttendifyPurple, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text("${state.greeting}, ", color = AttendifyIndigo, fontSize = 16.sp)
                    Text(state.firstName.ifBlank { "there" }, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                }
                NotificationBellButton(size = 24)
            }
            Spacer(Modifier.height(16.dp))
            Text("My requests", color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 28.sp)
            Text(
                "Manage your leave requests, attendance corrections and more.",
                color = AttendifyMuted,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(16.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(FilterIdle)
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                FilterChip("All", filter == RequestFilter.All, Modifier.weight(1f)) { filter = RequestFilter.All }
                FilterChip("Pending", filter == RequestFilter.Pending, Modifier.weight(1f)) { filter = RequestFilter.Pending }
                FilterChip("Approved", filter == RequestFilter.Approved, Modifier.weight(1f)) { filter = RequestFilter.Approved }
            }
            Spacer(Modifier.height(14.dp))

            if (state.requestsBusy) {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = AttendifyPurple)
                }
            } else if (filtered.isEmpty()) {
                Text("No requests yet. Tap + to apply for leave.", color = AttendifyMuted, fontSize = 14.sp)
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxSize().padding(bottom = 88.dp),
                ) {
                    items(filtered, key = { it.id }) { item ->
                        RequestCard(item)
                    }
                }
            }

            if (!state.requestsError.isNullOrBlank()) {
                Text(state.requestsError, color = Color(0xFFA11D3A), fontSize = 13.sp)
            }
        }

        FloatingActionButton(
            onClick = onApply,
            containerColor = AttendifyPurple,
            contentColor = Color.White,
            shape = CircleShape,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(20.dp)
                .size(60.dp),
        ) {
            Icon(Icons.Default.Add, contentDescription = "Apply for leave", modifier = Modifier.size(28.dp))
        }
    }
}

@Composable
private fun FilterChip(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) AttendifyPurple else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) Color.White else AttendifyIndigo,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun RequestCard(item: RequestItem) {
    val isLeave = item.requestType != "ATTENDANCE_CORRECTION"
    val iconBg = when (item.status) {
        "APPROVED" -> AttendifySuccessBg
        "REJECTED" -> RejectBg
        else -> PendingBg
    }
    val iconTint = when {
        !isLeave && item.status == "APPROVED" -> AttendifySuccess
        item.status == "REJECTED" -> RejectFg
        item.status == "APPROVED" -> AttendifySuccess
        else -> PendingFg
    }
    val icon = if (isLeave) Icons.Default.Work else Icons.Default.Description

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(6.dp, RoundedCornerShape(18.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(iconBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = iconTint, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(item.dateLabel, color = AttendifyMuted, fontSize = 13.sp)
            Text(item.summary, color = AttendifyMuted, fontSize = 12.sp)
        }
        StatusBadge(item.status, item.statusLabel)
        Spacer(Modifier.width(4.dp))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = AttendifyMuted)
    }
}

@Composable
private fun StatusBadge(status: String, label: String) {
    val bg = when (status) {
        "APPROVED" -> AttendifySuccessBg
        "REJECTED" -> RejectBg
        else -> PendingBg
    }
    val fg = when (status) {
        "APPROVED" -> AttendifySuccess
        "REJECTED" -> RejectFg
        else -> PendingFg
    }
    val icon = when (status) {
        "APPROVED" -> Icons.Default.CheckCircle
        "REJECTED" -> Icons.Default.Close
        else -> Icons.Default.AccessTime
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(12.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, color = fg, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
    }
}

@Composable
private fun ApplyLeaveScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    onBack: () -> Unit,
    onSubmitted: () -> Unit,
) {
    val context = LocalContext.current
    val displayFmt = DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.US)
    var leaveType by remember {
        mutableStateOf(state.leaveTypes.firstOrNull() ?: LeaveTypeOption("ANNUAL", "Annual leave"))
    }
    var startDate by remember { mutableStateOf(LocalDate.now().plusDays(2)) }
    var endDate by remember { mutableStateOf(LocalDate.now().plusDays(3)) }
    var halfDay by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var attachmentName by remember { mutableStateOf<String?>(null) }
    var typeMenu by remember { mutableStateOf(false) }

    LaunchedEffect(state.leaveTypes) {
        if (state.leaveTypes.isNotEmpty() && state.leaveTypes.none { it.value == leaveType.value }) {
            leaveType = state.leaveTypes.first()
        }
    }
    LaunchedEffect(state.requestsMessage) {
        if (state.requestsMessage == "submitted") onSubmitted()
    }

    if (halfDay && endDate != startDate) endDate = startDate
    val totalDays = if (halfDay) 0.5 else (ChronoUnit.DAYS.between(startDate, endDate) + 1).toDouble().coerceAtLeast(1.0)

    fun pickDate(current: LocalDate, onPicked: (LocalDate) -> Unit) {
        DatePickerDialog(
            context,
            { _, y, m, d -> onPicked(LocalDate.of(y, m + 1, d)) },
            current.year,
            current.monthValue - 1,
            current.dayOfMonth,
        ).show()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AttendifyBackground),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
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
                    "Apply for leave",
                    color = AttendifyIndigo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    FormSelector(
                        label = "Leave type",
                        value = leaveType.label,
                        trailing = { Icon(Icons.Default.KeyboardArrowDown, null, tint = AttendifyMuted) },
                        onClick = { typeMenu = true },
                    )
                    DropdownMenu(expanded = typeMenu, onDismissRequest = { typeMenu = false }) {
                        state.leaveTypes.ifEmpty {
                            listOf(LeaveTypeOption("ANNUAL", "Annual leave"), LeaveTypeOption("CASUAL", "Casual leave"), LeaveTypeOption("SICK", "Sick leave"))
                        }.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option.label) },
                                onClick = {
                                    leaveType = option
                                    typeMenu = false
                                },
                            )
                        }
                    }
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    "Balance: ${state.leaveBalanceDays} days",
                    color = AttendifyPurple,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(AttendifyPurpleSoft)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                )
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DateField(
                    modifier = Modifier.weight(1f),
                    label = "Start date",
                    value = startDate.format(displayFmt),
                    onClick = {
                        pickDate(startDate) { picked ->
                            startDate = picked
                            if (endDate.isBefore(picked)) endDate = picked
                        }
                    },
                )
                DateField(
                    modifier = Modifier.weight(1f),
                    label = "End date",
                    value = endDate.format(displayFmt),
                    onClick = {
                        if (halfDay) return@DateField
                        pickDate(endDate) { picked ->
                            endDate = if (picked.isBefore(startDate)) startDate else picked
                        }
                    },
                )
            }

            Text("Leave duration", color = AttendifyMuted, fontSize = 12.sp)
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(FilterIdle)
                    .padding(4.dp),
            ) {
                DurationChip("Half day", halfDay, Modifier.weight(1f)) {
                    halfDay = true
                    endDate = startDate
                }
                DurationChip("Full day", !halfDay, Modifier.weight(1f)) { halfDay = false }
            }
            Text(
                if (halfDay) "Total: Half day" else "Total: ${totalDays.toInt()} day${if (totalDays == 1.0) "" else "s"}",
                color = AttendifyPurple,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(AttendifyPurpleSoft)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            )

            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .border(1.dp, Color(0xFFE4E1F0), RoundedCornerShape(14.dp))
                    .background(Color.White)
                    .padding(12.dp),
            ) {
                Text("Reason", color = AttendifyMuted, fontSize = 12.sp)
                BasicTextField(
                    value = reason,
                    onValueChange = { if (it.length <= 300) reason = it },
                    textStyle = TextStyle(color = AttendifyIndigo, fontSize = 15.sp),
                    cursorBrush = SolidColor(AttendifyPurple),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 96.dp)
                        .padding(top = 6.dp),
                )
                Text(
                    "${reason.length}/300",
                    color = AttendifyMuted,
                    fontSize = 11.sp,
                    modifier = Modifier.align(Alignment.End),
                )
            }

            Text("Add attachment (optional)", color = AttendifyMuted, fontSize = 12.sp)
            FormSelector(
                label = null,
                value = attachmentName ?: "Choose file",
                leading = { Icon(Icons.Default.AttachFile, null, tint = AttendifyPurple) },
                trailing = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = AttendifyMuted) },
                onClick = { attachmentName = "leave-document.pdf" },
            )

            Text("Approver", color = AttendifyMuted, fontSize = 12.sp)
            FormSelector(
                label = null,
                value = "Reporting manager",
                leading = { Icon(Icons.Default.Person, null, tint = AttendifyPurple) },
                onClick = null,
            )

            if (!state.requestsError.isNullOrBlank()) {
                Text(state.requestsError, color = Color(0xFFA11D3A), fontSize = 13.sp)
            }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .padding(20.dp)
                .height(54.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(if (state.requestsBusy) AttendifyPurple.copy(alpha = 0.5f) else AttendifyPurple)
                .clickable(enabled = !state.requestsBusy) {
                    viewModel.submitLeaveRequest(
                        leaveType = leaveType.value,
                        startDate = startDate.toString(),
                        endDate = endDate.toString(),
                        duration = if (halfDay) "HALF_DAY" else "FULL_DAY",
                        reason = reason,
                        attachmentName = attachmentName,
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            if (state.requestsBusy) {
                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(22.dp))
            } else {
                Text("Submit request", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun DurationChip(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) AttendifyPurple else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) Color.White else AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}

@Composable
private fun DateField(modifier: Modifier, label: String, value: String, onClick: () -> Unit) {
    Column(modifier = modifier) {
        Text(label, color = AttendifyMuted, fontSize = 12.sp)
        Spacer(Modifier.height(6.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .border(1.dp, Color(0xFFE4E1F0), RoundedCornerShape(14.dp))
                .background(Color.White)
                .clickable(onClick = onClick)
                .padding(horizontal = 12.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.CalendarMonth, null, tint = AttendifyPurple, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(value, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
    }
}

@Composable
private fun FormSelector(
    label: String?,
    value: String,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)?,
) {
    Column(Modifier.fillMaxWidth()) {
        if (label != null) {
            Text(label, color = AttendifyMuted, fontSize = 12.sp)
            Spacer(Modifier.height(6.dp))
        }
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .border(1.dp, Color(0xFFE4E1F0), RoundedCornerShape(14.dp))
                .background(Color.White)
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(horizontal = 12.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (leading != null) {
                leading()
                Spacer(Modifier.width(8.dp))
            }
            Text(value, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.weight(1f))
            trailing?.invoke()
        }
    }
}
