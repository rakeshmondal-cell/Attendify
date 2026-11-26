package com.attendify.employee.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusEvent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.ProjectTaskItem
import com.attendify.employee.UiState
import com.attendify.employee.WorkNoteMessage
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val taskStatuses = listOf("Open", "In progress", "Done")

@Composable
fun ProjectsTasksScreen(state: UiState, viewModel: AttendifyViewModel) {
    val context = LocalContext.current
    LaunchedEffect(state.attendance.status) { viewModel.loadProjects() }

    val eligible = state.attendance.status == "OPEN"
    val pmUrl = state.pmWebUrl
    var expandedProject by remember { mutableStateOf<String?>(null) }
    var showAddForm by remember { mutableStateOf(false) }
    var newProjectName by remember { mutableStateOf("") }
    var newTaskTitle by remember { mutableStateOf("") }
    var newTaskNote by remember { mutableStateOf("") }
    LaunchedEffect(state.projectJustCreated) {
        val created = state.projectJustCreated ?: return@LaunchedEffect
        expandedProject = "open:$created"
        showAddForm = false
        newProjectName = ""
        newTaskTitle = ""
        newTaskNote = ""
        viewModel.clearProjectJustCreated()
    }
    val openPm: () -> Unit = {
        if (!pmUrl.isNullOrBlank() && eligible) {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pmUrl)))
            }
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
        Text("Projects & tasks", color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 26.sp)
        Text(
            "After check-in, set status and write what you worked on today. Or open Project Control for the full web app.",
            color = AttendifyMuted,
            fontSize = 13.sp,
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(if (eligible) Color(0xFFE8F5E9) else Color(0xFFFFF6E8))
                .padding(14.dp),
        ) {
            Text(
                when {
                    !eligible -> "Read-only until check-in"
                    state.projectsProgressUpdated -> "Progress updated today"
                    else -> "Write access eligible"
                },
                color = if (eligible) Color(0xFF2E7D32) else Color(0xFF94620D),
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
            )
            Text(
                state.projectsMessage
                    ?: if (eligible) {
                        "Checked in. Update status, add a work note, or open Project Control."
                    } else {
                        "Check in on Home to unlock in-app updates and Project Control."
                    },
                color = AttendifyMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
            state.projectsWorkDate?.let {
                Text("Work date: $it", color = AttendifyMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }

        if (state.projectsBusy) {
            CircularProgressIndicator(color = AttendifyPurple, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
        state.projectsError?.let { Text(it, color = Color(0xFFC62828), fontSize = 13.sp) }

        if (eligible) {
            Button(
                onClick = viewModel::markWorkProgressUpdated,
                enabled = !state.projectsBusy,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (state.projectsProgressUpdated) Color(0xFF2E7D32) else AttendifyPurple,
                    contentColor = Color.White,
                ),
            ) {
                Text(
                    if (state.projectsProgressUpdated) "Progress marked for today" else "Mark progress updated today",
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        val activeTasks = state.projectTasks.filter { !it.isClosed() }
        val closedTasks = state.projectTasks.filter { it.isClosed() }
        val openProjects = state.projectItems.filter { project ->
            project.openTaskCount > 0 && activeTasks.any { it.projectName == project.name }
        }

        if (eligible) {
            if (showAddForm) {
                AddProjectForm(
                    name = newProjectName,
                    title = newTaskTitle,
                    note = newTaskNote,
                    busy = state.projectsBusy,
                    onName = { newProjectName = it },
                    onTitle = { newTaskTitle = it },
                    onNote = { newTaskNote = it },
                    onCancel = { showAddForm = false },
                    onSave = { viewModel.createWorkProject(newProjectName, newTaskTitle, newTaskNote) },
                )
            } else {
                OutlinedButton(
                    onClick = { showAddForm = true },
                    enabled = !state.projectsBusy,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("Add project", color = AttendifyPurple, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        Text("Assigned projects", color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        if (openProjects.isEmpty() && activeTasks.isEmpty() && !state.projectsBusy) {
            Text(
                if (closedTasks.isEmpty()) "No project allocations synced yet." else "No open projects. Closed work is listed below.",
                color = AttendifyMuted,
                fontSize = 13.sp,
            )
        }
        val placedTaskIds = mutableSetOf<String>()
        openProjects.forEach { project ->
            val projectKey = "open:${project.name}"
            val expanded = expandedProject == projectKey
            val projectTasks = activeTasks.filter { it.projectName == project.name }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color.White)
                    .clickable {
                        expandedProject = if (expanded) null else projectKey
                    }
                    .padding(14.dp),
            ) {
                Text(project.name, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(
                    "${project.openTaskCount} open · ${project.taskCount} tasks",
                    color = AttendifyMuted,
                    fontSize = 12.sp,
                )
                if (projectTasks.any { it.pendingPm }) {
                    Text(
                        "Waiting to sync with Project Control",
                        color = Color(0xFFB26A00),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                Text(
                    if (expanded) "Hide tasks" else "Tap to view tasks",
                    color = AttendifyPurple,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            if (expanded) {
                projectTasks.forEach { task ->
                    placedTaskIds += task.id ?: task.title
                    TaskUpdateCard(
                        task = task,
                        eligible = eligible,
                        busy = state.projectsBusy,
                        onStatus = { status -> viewModel.updateWorkTaskStatus(task, status) },
                        onSaveNote = { note -> viewModel.saveWorkTaskNote(task, note) },
                        onOpenPm = openPm,
                        hasPmUrl = !pmUrl.isNullOrBlank(),
                    )
                }
            } else {
                projectTasks.forEach { task -> placedTaskIds += task.id ?: task.title }
            }
        }

        val unplacedTasks = activeTasks.filter { (it.id ?: it.title) !in placedTaskIds }
        if (unplacedTasks.isNotEmpty()) {
            Text("My tasks", color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        }
        unplacedTasks.forEach { task ->
            TaskUpdateCard(
                task = task,
                eligible = eligible,
                busy = state.projectsBusy,
                onStatus = { status -> viewModel.updateWorkTaskStatus(task, status) },
                onSaveNote = { note -> viewModel.saveWorkTaskNote(task, note) },
                onOpenPm = openPm,
                hasPmUrl = !pmUrl.isNullOrBlank(),
            )
        }

        val closedByProject = closedTasks.groupBy { it.projectName ?: "Assigned work" }
        if (closedByProject.isNotEmpty()) {
            Text("Closed", color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(
                "Tap a project to reopen it. Closed projects stay closed until then.",
                color = AttendifyMuted,
                fontSize = 12.sp,
            )
            closedByProject.forEach { (projectName, tasks) ->
                val projectKey = "closed:$projectName"
                val expanded = expandedProject == projectKey
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color.White)
                        .clickable {
                            expandedProject = if (expanded) null else projectKey
                        }
                        .padding(14.dp),
                ) {
                    Text(projectName, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text(
                        "${tasks.size} closed",
                        color = AttendifyMuted,
                        fontSize = 12.sp,
                    )
                    Text(
                        if (expanded) "Hide" else "Tap to view",
                        color = AttendifyPurple,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                if (expanded) {
                    tasks.forEach { task ->
                        ClosedTaskCard(
                            task = task,
                            eligible = eligible,
                            busy = state.projectsBusy,
                            onReopen = { viewModel.updateWorkTaskStatus(task, "Open") },
                        )
                    }
                }
            }
        }

        if (!pmUrl.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Button(
                onClick = openPm,
                enabled = eligible && !state.projectsBusy,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = AttendifyPurple,
                    contentColor = Color.White,
                    disabledContainerColor = AttendifyPurple.copy(alpha = 0.35f),
                    disabledContentColor = Color.White.copy(alpha = 0.85f),
                ),
            ) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null)
                Spacer(Modifier.padding(4.dp))
                Text(
                    if (eligible) "Open Project Control" else "Open Project Control (check in first)",
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (!eligible) {
                Text(
                    "In-app updates and Project Control stay locked until you check in.",
                    color = AttendifyMuted,
                    fontSize = 12.sp,
                )
            }
        }

        Button(
            onClick = viewModel::loadProjects,
            enabled = !state.projectsBusy,
            colors = ButtonDefaults.buttonColors(containerColor = AttendifyPurpleSoft, contentColor = AttendifyPurple),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Refresh allocations")
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TaskUpdateCard(
    task: ProjectTaskItem,
    eligible: Boolean,
    busy: Boolean,
    onStatus: (String) -> Unit,
    onSaveNote: (String) -> Unit,
    onOpenPm: () -> Unit,
    hasPmUrl: Boolean,
) {
    val canEditInApp = eligible && !task.id.isNullOrBlank()
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val saver = remember(task.id) { BringIntoViewRequester() }
    var draftNote by remember(task.id) { mutableStateOf("") }
    var pendingCount by remember(task.id) { mutableStateOf<Int?>(null) }
    LaunchedEffect(task.notes.size) {
        val mark = pendingCount ?: return@LaunchedEffect
        if (task.notes.size > mark) {
            draftNote = ""
            pendingCount = null
        }
    }
    LaunchedEffect(task.id, canEditInApp) {
        if (!canEditInApp) return@LaunchedEffect
        kotlinx.coroutines.delay(80)
        saver.bringIntoView()
    }
    val messages = task.notes.ifEmpty {
        task.workNote?.takeIf { it.isNotBlank() }?.let { listOf(WorkNoteMessage("latest", it, "")) }.orEmpty()
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(task.title, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Text(
            listOfNotNull(task.projectName, task.status, task.dueDate).joinToString(" · "),
            color = AttendifyMuted,
            fontSize = 12.sp,
        )
        if (task.pendingPm) {
            Text(
                "Saved in Attendify. Waiting to sync with Project Control.",
                color = Color(0xFFB26A00),
                fontSize = 12.sp,
            )
        }
        if (messages.isNotEmpty()) {
            WorkNoteThread(messages)
        }
        if (canEditInApp) {
            Text("Update status in app", color = AttendifyIndigo, fontWeight = FontWeight.Medium, fontSize = 12.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                taskStatuses.forEach { status ->
                    val selected = task.status.equals(status, ignoreCase = true)
                    TextButton(
                        onClick = { onStatus(status) },
                        enabled = !busy,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (selected) AttendifyPurpleSoft else Color(0xFFF5F3FB)),
                    ) {
                        Text(
                            status,
                            color = if (selected) AttendifyPurple else AttendifyMuted,
                            fontSize = 11.sp,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                        )
                    }
                }
            }

            Text("What I worked on today", color = AttendifyIndigo, fontWeight = FontWeight.Medium, fontSize = 12.sp)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .bringIntoViewRequester(saver),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
            BasicTextField(
                value = draftNote,
                onValueChange = { if (it.length <= 2000) draftNote = it },
                enabled = !busy,
                textStyle = TextStyle(color = AttendifyIndigo, fontSize = 14.sp),
                cursorBrush = SolidColor(AttendifyPurple),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 72.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, Color(0xFFE0DCEA), RoundedCornerShape(12.dp))
                    .background(Color(0xFFFAF9FD))
                    .padding(12.dp)
                    .onFocusEvent { state ->
                        if (state.isFocused) scope.launch { saver.bringIntoView() }
                    },
            )
            Button(
                onClick = {
                    val text = draftNote.trim()
                    if (text.isEmpty()) return@Button
                    focusManager.clearFocus()
                    pendingCount = task.notes.size
                    onSaveNote(text)
                },
                enabled = !busy && draftNote.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AttendifyPurple, contentColor = Color.White),
            ) {
                Text(if (busy) "Saving…" else "Save note", fontWeight = FontWeight.SemiBold)
            }
            }
            if (draftNote.isNotBlank()) {
                Text(
                    "Not saved yet. Tap Save note to store it in Attendify.",
                    color = Color(0xFFB26A00),
                    fontSize = 12.sp,
                )
            }
        } else if (eligible && task.id.isNullOrBlank()) {
            Text(
                "No task id from Project Control — use Open Project Control to update this item.",
                color = AttendifyMuted,
                fontSize = 12.sp,
            )
        }
        if (hasPmUrl) {
            OutlinedButton(
                onClick = onOpenPm,
                enabled = eligible && !busy,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = AttendifyPurple)
                Spacer(Modifier.padding(4.dp))
                Text(
                    if (eligible) "Also open Project Control" else "Check in to update",
                    color = AttendifyPurple,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun AddProjectForm(
    name: String,
    title: String,
    note: String,
    busy: Boolean,
    onName: (String) -> Unit,
    onTitle: (String) -> Unit,
    onNote: (String) -> Unit,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    val focusManager = LocalFocusManager.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Add project", color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        OutlinedTextField(
            value = name,
            onValueChange = { if (it.length <= 120) onName(it) },
            enabled = !busy,
            singleLine = true,
            label = { Text("Project name or code") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = title,
            onValueChange = { if (it.length <= 300) onTitle(it) },
            enabled = !busy,
            label = { Text("First task") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = note,
            onValueChange = { if (it.length <= 2000) onNote(it) },
            enabled = !busy,
            label = { Text("What I worked on (optional)") },
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "It is saved in Attendify now and sent to Project Control when that connection is ready.",
            color = AttendifyMuted,
            fontSize = 12.sp,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = {
                    focusManager.clearFocus()
                    onCancel()
                },
                enabled = !busy,
                modifier = Modifier.weight(1f).height(44.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Cancel", color = AttendifyPurple)
            }
            Button(
                onClick = {
                    focusManager.clearFocus()
                    onSave()
                },
                enabled = !busy && name.isNotBlank() && title.isNotBlank(),
                modifier = Modifier.weight(1f).height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AttendifyPurple, contentColor = Color.White),
            ) {
                Text(if (busy) "Saving…" else "Add project", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun WorkNoteThread(notes: List<WorkNoteMessage>) {
    val scroll = rememberScrollState()
    LaunchedEffect(notes.size) { scroll.scrollTo(scroll.maxValue) }
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(max = 168.dp)
            .verticalScroll(scroll),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Updates today", color = AttendifyIndigo, fontWeight = FontWeight.Medium, fontSize = 12.sp)
        notes.forEach { note ->
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                Column(
                    modifier = Modifier
                        .widthIn(max = 280.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(AttendifyPurpleSoft)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Text(note.text, color = AttendifyIndigo, fontSize = 14.sp)
                    val time = formatNoteTime(note.createdAt)
                    if (time.isNotBlank()) {
                        Text(
                            time,
                            color = AttendifyMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.align(Alignment.End),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ClosedTaskCard(
    task: ProjectTaskItem,
    eligible: Boolean,
    busy: Boolean,
    onReopen: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(task.title, color = AttendifyIndigo, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Text(
            listOfNotNull(task.projectName, "Closed").joinToString(" · "),
            color = AttendifyMuted,
            fontSize = 12.sp,
        )
        if (eligible && !task.id.isNullOrBlank()) {
            OutlinedButton(
                onClick = onReopen,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Reopen", color = AttendifyPurple, fontWeight = FontWeight.SemiBold)
            }
        } else if (task.id.isNullOrBlank()) {
            Text(
                "No task id from Project Control — reopen it there.",
                color = AttendifyMuted,
                fontSize = 12.sp,
            )
        } else {
            Text("Check in to reopen this project.", color = AttendifyMuted, fontSize = 12.sp)
        }
    }
}

private fun ProjectTaskItem.isClosed(): Boolean {
    if (stillAssigned == false) return true
    val value = status ?: return false
    return Regex("done|closed|complete|completed|cancelled", RegexOption.IGNORE_CASE).containsMatchIn(value)
}

private fun formatNoteTime(iso: String): String {
    if (iso.isBlank()) return ""
    return try {
        val zoned = Instant.parse(iso).atZone(ZoneId.of("Asia/Kolkata"))
        DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).format(zoned)
    } catch (_: Exception) {
        ""
    }
}
