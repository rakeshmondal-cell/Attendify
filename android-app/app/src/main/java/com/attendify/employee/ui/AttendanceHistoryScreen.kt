package com.attendify.employee.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Coffee
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Remove
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.HistoryDay
import com.attendify.employee.UiState
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

private val AbsentBg = Color(0xFFFFEBEE)
private val AbsentFg = Color(0xFFC62828)
private val LeaveBg = AttendifyPurpleSoft
private val WeekDays = listOf("M", "T", "W", "T", "F", "S", "S")

@Composable
fun AttendanceHistoryScreen(state: UiState, viewModel: AttendifyViewModel) {
    var month by remember {
        mutableStateOf(
            state.historyMonth?.let { YearMonth.parse(it) } ?: YearMonth.now(),
        )
    }
    var selectedDate by remember { mutableStateOf(LocalDate.now()) }

    LaunchedEffect(month) {
        viewModel.loadAttendanceHistory(month.toString())
        val today = LocalDate.now()
        selectedDate = if (YearMonth.from(today) == month) today else month.atDay(1)
    }

    val daysByDate = remember(state.historyDays) {
        state.historyDays.associateBy { it.workDate }
    }
    val selected = daysByDate[selectedDate.toString()]
    val summary = state.historySummary

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AttendifyBackground)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.fillMaxWidth()) {
            Text(
                "My attendance",
                color = AttendifyIndigo,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                modifier = Modifier.align(Alignment.Center),
            )
            Icon(
                Icons.Default.Download,
                contentDescription = "Export",
                tint = AttendifyPurple,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .size(22.dp)
                    .clickable { viewModel.exportAttendanceHistory() },
            )
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SummaryChip(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Person,
                label = "Present",
                value = summary?.present?.toString() ?: "0",
                bg = AttendifySuccessBg,
                fg = AttendifySuccess,
            )
            SummaryChip(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Remove,
                label = "Absent",
                value = summary?.absent?.toString() ?: "0",
                bg = AbsentBg,
                fg = AbsentFg,
            )
            SummaryChip(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.CalendarMonth,
                label = "Leave",
                value = summary?.leave?.toString() ?: "0",
                bg = LeaveBg,
                fg = AttendifyPurple,
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
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                    contentDescription = "Previous month",
                    tint = AttendifyIndigo,
                    modifier = Modifier
                        .size(28.dp)
                        .clickable { month = month.minusMonths(1) },
                )
                Text(
                    month.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.US)),
                    color = AttendifyIndigo,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = "Next month",
                    tint = AttendifyIndigo,
                    modifier = Modifier
                        .size(28.dp)
                        .clickable { month = month.plusMonths(1) },
                )
            }
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth()) {
                WeekDays.forEach { day ->
                    Text(
                        day,
                        color = AttendifyMuted,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            MonthGrid(
                month = month,
                selected = selectedDate,
                daysByDate = daysByDate,
                onSelect = { selectedDate = it },
            )
        }

        DayDetailCard(
            date = selectedDate,
            day = selected,
            localBreakLabel = if (selectedDate == LocalDate.now() && state.totalBreakMs > 0) {
                formatBreakMinutes((state.totalBreakMs / 60_000).toInt())
            } else {
                null
            },
        )

        if (state.historyError != null) {
            Text(state.historyError, color = Color(0xFFA11D3A), fontSize = 13.sp)
        }
        if (state.historyBusy) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = AttendifyPurple, modifier = Modifier.size(28.dp))
            }
        }
    }
}

@Composable
private fun SummaryChip(
    modifier: Modifier,
    icon: ImageVector,
    label: String,
    value: String,
    bg: Color,
    fg: Color,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .padding(horizontal = 10.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(18.dp))
        Spacer(Modifier.height(4.dp))
        Text(label, color = fg, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        Text(value, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 20.sp)
    }
}

@Composable
private fun MonthGrid(
    month: YearMonth,
    selected: LocalDate,
    daysByDate: Map<String, HistoryDay>,
    onSelect: (LocalDate) -> Unit,
) {
    val first = month.atDay(1)
    // Monday-first: Monday=0 … Sunday=6
    val lead = (first.dayOfWeek.value + 6) % 7
    val cells = lead + month.lengthOfMonth()
    val rows = (cells + 6) / 7
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(rows) { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                repeat(7) { col ->
                    val index = row * 7 + col
                    val dayNum = index - lead + 1
                    if (dayNum in 1..month.lengthOfMonth()) {
                        val date = month.atDay(dayNum)
                        val kind = daysByDate[date.toString()]?.attendanceKind
                        val isSelected = date == selected
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .aspectRatio(1f)
                                .padding(2.dp)
                                .clip(CircleShape)
                                .background(if (isSelected) AttendifyPurple else Color.Transparent)
                                .clickable { onSelect(date) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    dayNum.toString(),
                                    color = when {
                                        isSelected -> Color.White
                                        else -> AttendifyIndigo
                                    },
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                    fontSize = 14.sp,
                                )
                                if (!isSelected && kind != null) {
                                    Box(
                                        Modifier
                                            .size(4.dp)
                                            .clip(CircleShape)
                                            .background(
                                                when (kind) {
                                                    "PRESENT" -> AttendifySuccess
                                                    "LEAVE" -> AttendifyPurple
                                                    else -> AbsentFg
                                                },
                                            ),
                                    )
                                } else {
                                    Spacer(Modifier.height(4.dp))
                                }
                            }
                        }
                    } else {
                        Spacer(Modifier.weight(1f).aspectRatio(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun DayDetailCard(date: LocalDate, day: HistoryDay?, localBreakLabel: String?) {
    val label = date.format(DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.US))
    val status = when (day?.attendanceKind) {
        "PRESENT" -> "Present"
        "LEAVE" -> "Leave"
        "ABSENT" -> "Absent"
        else -> "No record"
    }
    val statusBg = when (day?.attendanceKind) {
        "PRESENT" -> AttendifySuccessBg
        "LEAVE" -> LeaveBg
        "ABSENT" -> AbsentBg
        else -> Color(0xFFF0F0F5)
    }
    val statusFg = when (day?.attendanceKind) {
        "PRESENT" -> AttendifySuccess
        "LEAVE" -> AttendifyPurple
        "ABSENT" -> AbsentFg
        else -> AttendifyMuted
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(8.dp, RoundedCornerShape(22.dp), ambientColor = AttendifyCardShadow, spotColor = AttendifyCardShadow)
            .clip(RoundedCornerShape(22.dp))
            .background(Color.White)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.weight(1f))
            Text(
                status,
                color = statusFg,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(statusBg)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DetailTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.AccessTime,
                label = "Check-in",
                value = day?.checkInLabel ?: "--",
            )
            DetailTile(
                modifier = Modifier.weight(1f),
                icon = Icons.AutoMirrored.Filled.Logout,
                label = "Check-out",
                value = day?.checkOutLabel ?: "--",
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DetailTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.BarChart,
                label = "Work time",
                value = day?.hoursLabel ?: "--",
            )
            DetailTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Coffee,
                label = "Breaks",
                value = localBreakLabel ?: day?.breaksLabel ?: "--",
            )
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.LocationOn, null, tint = AttendifyMuted, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text(
                listOfNotNull(day?.workplaceName, day?.shiftName).joinToString(" • ").ifBlank { "No shift details" },
                color = AttendifyMuted,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun DetailTile(modifier: Modifier, icon: ImageVector, label: String, value: String) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, Color(0xFFE8E5F2), RoundedCornerShape(14.dp))
            .background(Color(0xFFFAF9FD))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = AttendifyPurple, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, color = AttendifyMuted, fontSize = 11.sp)
        }
        Spacer(Modifier.height(6.dp))
        Text(value, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

private fun formatBreakMinutes(minutes: Int): String {
    val h = minutes / 60
    val m = minutes % 60
    return if (h > 0) "${h}h ${m}m" else "${m}m"
}
