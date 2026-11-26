package com.attendify.employee.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.UiState

@Composable
fun ManagerReportsScreen(state: UiState, viewModel: AttendifyViewModel) {
    var tab by remember { mutableIntStateOf(0) }
    LaunchedEffect(tab) {
        if (tab == 0) viewModel.loadDailyPmReport()
        else viewModel.loadWeeklyPmReport()
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
        Text("Team reports", color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 26.sp)
        Text(
            "Daily attendance vs Project Control updates, plus weekly pack for you as manager.",
            color = AttendifyMuted,
            fontSize = 13.sp,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ReportTabChip("Daily", selected = tab == 0) { tab = 0 }
            ReportTabChip("Weekly", selected = tab == 1) { tab = 1 }
        }

        if (state.reportBusy) {
            CircularProgressIndicator(color = AttendifyPurple)
        }
        state.reportError?.let { Text(it, color = Color(0xFFC62828), fontSize = 13.sp) }
        state.reportMessage?.let { Text(it, color = Color(0xFF2E7D32), fontSize = 13.sp) }

        if (tab == 0) {
            val report = state.dailyReport
            if (report != null) {
                Text(report.workDateLabel, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    StatChip("${report.presentCount}", "Present")
                    StatChip("${report.pmUpdatedCount}", "PM updated")
                    StatChip("${report.presentNoUpdateCount}", "No PM update")
                }
                report.rows.forEach { row ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Color.White)
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(row.fullName, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text(row.employeeCode, color = AttendifyMuted, fontSize = 12.sp)
                        Text(
                            "Checked in: ${if (row.checkedIn) "Yes" else "No"} · ${row.checkInLabel ?: "—"} / ${row.checkOutLabel ?: "—"}",
                            color = AttendifyMuted,
                            fontSize = 12.sp,
                        )
                        Text("PM update: ${row.pmUpdate}", color = AttendifyIndigo, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        row.exception?.let {
                            Text(it, color = Color(0xFFC62828), fontSize = 12.sp)
                        }
                    }
                }
                if (report.rows.isEmpty()) {
                    Text("No direct reports found for this manager.", color = AttendifyMuted, fontSize = 13.sp)
                }
            }
        } else {
            val report = state.weeklyReport
            if (report != null) {
                Text(report.weekLabel, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold)
                report.managerName?.let {
                    Text("Manager: $it", color = AttendifyMuted, fontSize = 12.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    StatChip(String.format("%.1f", report.avgDaysPresent), "Avg present")
                    StatChip("${report.presentNoUpdateDays}", "No-update days")
                }
                if (report.highlights.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFFFFF6E8))
                            .padding(12.dp),
                    ) {
                        Text("Highlights", fontWeight = FontWeight.SemiBold, color = Color(0xFF94620D))
                        report.highlights.forEach {
                            Text("• $it", color = Color(0xFF94620D), fontSize = 12.sp)
                        }
                    }
                }
                report.employees.forEach { emp ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Color.White)
                            .padding(14.dp),
                    ) {
                        Text(emp.fullName, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text(
                            "Present ${emp.daysPresent} · PM ${emp.daysPmUpdated} · No-update ${emp.daysPresentNoUpdate} · Absent ${emp.daysAbsent}",
                            color = AttendifyMuted,
                            fontSize = 12.sp,
                        )
                        Text(
                            "Days: ${emp.dayMarks.joinToString(" ")}",
                            color = AttendifyIndigo,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                Button(
                    onClick = viewModel::emailWeeklyPmReport,
                    enabled = !state.reportBusy,
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = AttendifyPurple, contentColor = Color.White),
                ) {
                    Text("Email weekly report to me", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun ReportTabChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (selected) Color.White else AttendifyIndigo,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) AttendifyPurple else Color.White)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
private fun StatChip(value: String, label: String) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(value, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(label, color = AttendifyMuted, fontSize = 11.sp)
    }
}
