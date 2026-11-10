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
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Timelapse
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.TeamRequestItem
import com.attendify.employee.UiState

private val PendingBg = Color(0xFFFFF3E0)
private val PendingFg = Color(0xFFEF6C00)
private val RejectBg = Color(0xFFFFEBEE)
private val RejectFg = Color(0xFFC62828)
private val OfficeBg = Color(0xFFE8F5E9)
private val OfficeFg = Color(0xFF2E7D32)

private enum class TeamFilter { Pending, Approved, Rejected }

@Composable
fun TeamApprovalsHub(state: UiState, viewModel: AttendifyViewModel) {
    var selectedId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { viewModel.loadTeamRequests() }

    val selected = state.teamRequests.firstOrNull { it.id == selectedId }
    if (selected != null) {
        ReviewRequestScreen(
            state = state,
            item = selected,
            viewModel = viewModel,
            onBack = { selectedId = null },
        )
    } else {
        TeamApprovalsList(
            state = state,
            onOpen = { selectedId = it },
        )
    }
}

@Composable
private fun TeamApprovalsList(state: UiState, onOpen: (String) -> Unit) {
    var filter by remember { mutableStateOf(TeamFilter.Pending) }
    val filtered = remember(state.teamRequests, filter) {
        state.teamRequests.filter {
            when (filter) {
                TeamFilter.Pending -> it.status == "PENDING"
                TeamFilter.Approved -> it.status == "APPROVED"
                TeamFilter.Rejected -> it.status == "REJECTED"
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AttendifyBackground)
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Team approvals",
                color = AttendifyIndigo,
                fontWeight = FontWeight.Bold,
                fontSize = 26.sp,
                modifier = Modifier.weight(1f),
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(AttendifyPurpleSoft)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                Icon(Icons.Default.Person, null, tint = AttendifyPurple, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("Manager", color = AttendifyPurple, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TeamTab("Pending", filter == TeamFilter.Pending, state.teamPendingCount) { filter = TeamFilter.Pending }
            Spacer(Modifier.width(18.dp))
            TeamTab("Approved", filter == TeamFilter.Approved, null) { filter = TeamFilter.Approved }
            Spacer(Modifier.width(18.dp))
            TeamTab("Rejected", filter == TeamFilter.Rejected, null) { filter = TeamFilter.Rejected }
            Spacer(Modifier.weight(1f))
            Icon(Icons.Default.FilterList, null, tint = AttendifyMuted, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.height(14.dp))

        if (state.teamBusy) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = AttendifyPurple)
            }
        } else if (filtered.isEmpty()) {
            Text(
                if (state.teamRequests.isEmpty()) {
                    "No requests from your team yet. HR must assign employees to you as their reporting manager."
                } else {
                    "No ${filter.name.lowercase()} requests."
                },
                color = AttendifyMuted,
                fontSize = 14.sp,
            )
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize().padding(bottom = 12.dp),
            ) {
                items(filtered, key = { it.id }) { item ->
                    TeamRequestCard(item) { onOpen(item.id) }
                }
            }
        }

        if (!state.teamError.isNullOrBlank()) {
            Text(state.teamError, color = Color(0xFFA11D3A), fontSize = 13.sp)
        }
    }
}

@Composable
private fun TeamTab(label: String, selected: Boolean, badge: Int?, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                color = if (selected) AttendifyPurple else AttendifyMuted,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                fontSize = 15.sp,
            )
            if (badge != null && badge > 0) {
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(AttendifyPurple)
                        .padding(horizontal = 6.dp, vertical = 1.dp),
                ) {
                    Text(badge.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Box(
            Modifier
                .width(if (selected) 56.dp else 0.dp)
                .height(3.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(if (selected) AttendifyPurple else Color.Transparent),
        )
    }
}

@Composable
private fun TeamRequestCard(item: TeamRequestItem, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(6.dp, RoundedCornerShape(18.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .clickable(onClick = onClick)
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
            Text(item.employeeInitials, color = AttendifyPurple, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.employeeName, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text("${item.title} · ${item.daysText}", color = AttendifyMuted, fontSize = 13.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.CalendarMonth, null, tint = AttendifyMuted, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(4.dp))
                Text(item.dateLabel, color = AttendifyMuted, fontSize = 12.sp)
            }
        }
        StatusPill(item.status, item.statusLabel)
        Spacer(Modifier.width(4.dp))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = AttendifyMuted)
    }
}

@Composable
private fun StatusPill(status: String, label: String) {
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
private fun ReviewRequestScreen(
    state: UiState,
    item: TeamRequestItem,
    viewModel: AttendifyViewModel,
    onBack: () -> Unit,
) {
    var note by remember { mutableStateOf("") }
    LaunchedEffect(state.teamMessage) {
        if (state.teamMessage == "reviewed") onBack()
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
                    "Review request",
                    color = AttendifyIndigo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.White)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(AttendifyPurpleSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(item.employeeInitials, color = AttendifyPurple, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.employeeName, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(item.roleLabel, color = AttendifyMuted, fontSize = 13.sp)
                }
                Text(
                    item.workplaceName,
                    color = OfficeFg,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 11.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(OfficeBg)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }

            Column(
                Modifier
                    .fillMaxWidth()
                    .shadow(6.dp, RoundedCornerShape(20.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color.White)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CalendarMonth, null, tint = AttendifyPurple)
                    Spacer(Modifier.width(8.dp))
                    Text(item.title, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Schedule, null, tint = AttendifyMuted, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(item.dateLabel.replace(" – ", " — "), color = AttendifyIndigo, fontSize = 14.sp)
                }
                Row(Modifier.fillMaxWidth()) {
                    Column(Modifier.weight(1f)) {
                        Text("Duration", color = AttendifyMuted, fontSize = 12.sp)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Timelapse, null, tint = AttendifyPurple, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(item.daysText, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Leave balance", color = AttendifyMuted, fontSize = 12.sp)
                        Text("${item.balanceDays} days", color = AttendifyIndigo, fontWeight = FontWeight.SemiBold)
                    }
                }
                Column {
                    Text("Reason", color = AttendifyMuted, fontSize = 12.sp)
                    Text(item.reason?.ifBlank { "—" } ?: "—", color = AttendifyIndigo, fontSize = 14.sp)
                }
            }

            if (item.status == "PENDING") {
                Text("Review note (optional)", color = AttendifyMuted, fontSize = 12.sp)
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .border(1.dp, Color(0xFFE4E1F0), RoundedCornerShape(14.dp))
                        .background(Color.White)
                        .padding(12.dp),
                ) {
                    BasicTextField(
                        value = note,
                        onValueChange = { if (it.length <= 500) note = it },
                        textStyle = TextStyle(color = AttendifyIndigo, fontSize = 14.sp),
                        cursorBrush = SolidColor(AttendifyPurple),
                        decorationBox = { inner ->
                            if (note.isEmpty()) {
                                Text("Add a note for the employee...", color = AttendifyMuted, fontSize = 14.sp)
                            }
                            inner()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 90.dp),
                    )
                    Text("${note.length}/500", color = AttendifyMuted, fontSize = 11.sp, modifier = Modifier.align(Alignment.End))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Info, null, tint = AttendifyPurple, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Employee will be notified after your decision", color = AttendifyMuted, fontSize = 12.sp)
                }
            } else {
                StatusPill(item.status, item.statusLabel)
                if (!item.reviewNote.isNullOrBlank()) {
                    Text("Review note: ${item.reviewNote}", color = AttendifyMuted, fontSize = 13.sp)
                }
            }

            if (!state.teamError.isNullOrBlank()) {
                Text(state.teamError, color = Color(0xFFA11D3A), fontSize = 13.sp)
            }
        }

        if (item.status == "PENDING") {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .border(1.5.dp, RejectFg, RoundedCornerShape(14.dp))
                        .background(Color.White)
                        .clickable(enabled = !state.teamBusy) {
                            viewModel.reviewTeamRequest(item.id, "REJECTED", note)
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Default.Close, null, tint = RejectFg)
                    Spacer(Modifier.width(6.dp))
                    Text("Reject", color = RejectFg, fontWeight = FontWeight.SemiBold)
                }
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (state.teamBusy) AttendifyPurple.copy(alpha = 0.5f) else AttendifyPurple)
                        .clickable(enabled = !state.teamBusy) {
                            viewModel.reviewTeamRequest(item.id, "APPROVED", note)
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Default.Check, null, tint = Color.White)
                    Spacer(Modifier.width(6.dp))
                    Text("Approve", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
