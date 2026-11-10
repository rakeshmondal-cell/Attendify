package com.attendify.employee.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Coffee
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.UiState
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val BreakBg = Color(0xFFF9F9FB)
private val ChipBorder = Color(0xFFE4E1F0)
private val FormCard = Color(0xFFF3F1FA)

private val breakTypes = listOf("Lunch", "Tea", "Personal", "Other")

@Composable
fun BreakSetupScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    onBack: () -> Unit,
) {
    var selectedMinutes by remember { mutableIntStateOf(30) }
    var customMode by remember { mutableStateOf(false) }
    var customMinutesText by remember { mutableStateOf("45") }
    var breakType by remember { mutableStateOf(state.breakType.ifBlank { "Lunch" }) }
    var note by remember { mutableStateOf(if (state.breakNote.isNotBlank()) state.breakNote else "Lunch break") }
    var typeMenuOpen by remember { mutableStateOf(false) }

    val duration = if (customMode) customMinutesText.toIntOrNull()?.coerceIn(1, 240) ?: 45 else selectedMinutes

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BreakBg),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BreakTopBar(title = "Take a break", onBack = onBack)
            Text("Choose your break duration", color = AttendifyMuted, fontSize = 14.sp)
            Spacer(Modifier.height(18.dp))

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(15, 30, 60).forEach { minutes ->
                    DurationChip(
                        label = "$minutes min",
                        selected = !customMode && selectedMinutes == minutes,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            customMode = false
                            selectedMinutes = minutes
                        },
                    )
                }
                DurationChip(
                    label = "Custom",
                    selected = customMode,
                    modifier = Modifier.weight(1f),
                    onClick = { customMode = true },
                )
            }

            if (customMode) {
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .border(1.dp, ChipBorder, RoundedCornerShape(14.dp))
                        .background(Color.White)
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Minutes", color = AttendifyMuted, modifier = Modifier.weight(1f))
                    BasicTextField(
                        value = customMinutesText,
                        onValueChange = { customMinutesText = it.filter { ch -> ch.isDigit() }.take(3) },
                        singleLine = true,
                        textStyle = TextStyle(color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 16.sp, textAlign = TextAlign.End),
                        modifier = Modifier.width(64.dp),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(FormCard)
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box {
                    FormRow(
                        icon = Icons.Default.Coffee,
                        label = "Break type",
                        value = breakType,
                        trailing = {
                            Icon(Icons.Default.KeyboardArrowDown, null, tint = AttendifyMuted)
                        },
                        onClick = { typeMenuOpen = true },
                    )
                    DropdownMenu(expanded = typeMenuOpen, onDismissRequest = { typeMenuOpen = false }) {
                        breakTypes.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option) },
                                onClick = {
                                    breakType = option
                                    if (note.isBlank() || note.endsWith("break", ignoreCase = true)) {
                                        note = "$option break"
                                    }
                                    typeMenuOpen = false
                                },
                            )
                        }
                    }
                }
                FormNoteRow(value = note, onValueChange = { note = it })
            }

            Spacer(Modifier.height(14.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(AttendifyPurpleSoft)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Info, null, tint = AttendifyPurple, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Your work timer pauses during breaks.", color = AttendifyPurple, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }

            Spacer(Modifier.height(28.dp))
            CoffeeHero()
            Spacer(Modifier.height(28.dp))
        }

        PrimaryBreakButton(
            label = "Start break",
            icon = Icons.Default.PlayArrow,
            onClick = {
                viewModel.startBreak(duration, breakType, note)
            },
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )
    }
}

@Composable
fun BreakActiveScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    onBack: () -> Unit,
) {
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            nowMs = System.currentTimeMillis()
            delay(1_000)
        }
    }

    val startedAt = state.breakStartedAtMs ?: nowMs
    val plannedEnd = state.breakPlannedEndMs ?: (startedAt + state.breakDurationMinutes * 60_000L)
    val totalMs = (plannedEnd - startedAt).coerceAtLeast(1L)
    val remainingMs = (plannedEnd - nowMs).coerceAtLeast(0L)
    val elapsedMs = (nowMs - startedAt).coerceAtLeast(0L)
    val progress = (elapsedMs.toFloat() / totalMs.toFloat()).coerceIn(0f, 1f)
    val remainingLabel = formatMmSs(remainingMs)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BreakBg),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BreakTopBar(title = "Break in progress", onBack = onBack)
            Spacer(Modifier.height(18.dp))

            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(220.dp)) {
                Canvas(Modifier.fillMaxSize()) {
                    val stroke = 16.dp.toPx()
                    drawArc(
                        color = Color(0xFFE7E4F4),
                        startAngle = -90f,
                        sweepAngle = 360f,
                        useCenter = false,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                        size = Size(size.width - stroke, size.height - stroke),
                        topLeft = Offset(stroke / 2f, stroke / 2f),
                    )
                    drawArc(
                        color = AttendifyPurple,
                        startAngle = -90f,
                        sweepAngle = 360f * progress,
                        useCenter = false,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                        size = Size(size.width - stroke, size.height - stroke),
                        topLeft = Offset(stroke / 2f, stroke / 2f),
                    )
                }
                Box(
                    Modifier
                        .size(110.dp)
                        .clip(CircleShape)
                        .background(AttendifyPurpleSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Coffee, null, tint = AttendifyPurple, modifier = Modifier.size(52.dp))
                }
            }

            Spacer(Modifier.height(18.dp))
            Text(remainingLabel, color = AttendifyPurple, fontWeight = FontWeight.Bold, fontSize = 42.sp)
            Text("of ${state.breakDurationMinutes} minutes", color = AttendifyMuted, fontSize = 14.sp)
            Spacer(Modifier.height(4.dp))
            Text("Take a moment to recharge", color = AttendifyMuted, fontSize = 14.sp)

            Spacer(Modifier.height(22.dp))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .border(1.dp, ChipBorder, RoundedCornerShape(18.dp))
                    .background(Color.White)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                DetailLine(
                    icon = Icons.Default.AccessTime,
                    label = "Started at",
                    time = formatClock(startedAt),
                    date = formatDate(startedAt),
                )
                DetailLine(
                    icon = Icons.Default.CalendarMonth,
                    label = "Planned return",
                    time = formatClock(plannedEnd),
                    date = formatDate(plannedEnd),
                )
            }
        }

        PrimaryBreakButton(
            label = "End break & resume",
            icon = Icons.Default.Stop,
            onClick = viewModel::endBreak,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )
    }
}

@Composable
private fun BreakTopBar(title: String, onBack: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
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
            title,
            color = AttendifyIndigo,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            modifier = Modifier.align(Alignment.Center),
        )
    }
}

@Composable
private fun DurationChip(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .height(42.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) AttendifyPurple else Color.White)
            .border(1.dp, if (selected) AttendifyPurple else ChipBorder, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
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
private fun FormRow(
    icon: ImageVector,
    label: String,
    value: String,
    trailing: @Composable (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = AttendifyPurple, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label, color = AttendifyMuted, fontSize = 11.sp)
            Text(value, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
        trailing?.invoke()
    }
}

@Composable
private fun FormNoteRow(value: String, onValueChange: (String) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("Note (optional)", color = AttendifyMuted, fontSize = 11.sp)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = TextStyle(color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun CoffeeHero() {
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(180.dp)) {
        Box(
            Modifier
                .size(150.dp)
                .clip(CircleShape)
                .background(AttendifyPurpleSoft.copy(alpha = 0.65f)),
        )
        Icon(Icons.Default.Coffee, null, tint = AttendifyPurple, modifier = Modifier.size(88.dp))
    }
}

@Composable
private fun DetailLine(icon: ImageVector, label: String, time: String, date: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
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
        Column(Modifier.weight(1f)) {
            Text(label, color = AttendifyMuted, fontSize = 12.sp)
            Text(time, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Text(date, color = AttendifyMuted, fontSize = 12.sp)
    }
}

@Composable
private fun PrimaryBreakButton(
    label: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(AttendifyPurple)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, tint = Color.White)
        Spacer(Modifier.width(8.dp))
        Text(label, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

private fun formatMmSs(ms: Long): String {
    val totalSec = (ms / 1000).toInt().coerceAtLeast(0)
    val m = totalSec / 60
    val s = totalSec % 60
    return "%02d:%02d".format(m, s)
}

private fun formatClock(ms: Long): String =
    SimpleDateFormat("hh:mm a", Locale.US).format(Date(ms)).uppercase(Locale.US)

private fun formatDate(ms: Long): String =
    SimpleDateFormat("dd-MM-yyyy", Locale.US).format(Date(ms))
