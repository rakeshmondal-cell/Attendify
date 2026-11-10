package com.attendify.employee.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.attendify.employee.BuildConfig

fun notificationsEnabled(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT < 33) return true
    return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
}

fun openAppNotificationSettings(context: Context) {
    val intent = Intent().apply {
        action = Settings.ACTION_APP_NOTIFICATION_SETTINGS
        putExtra(Settings.EXTRA_APP_PACKAGE, BuildConfig.APPLICATION_ID)
        putExtra("app_package", BuildConfig.APPLICATION_ID)
        putExtra("app_uid", context.applicationInfo.uid)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { context.startActivity(intent) }.onFailure {
        val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = android.net.Uri.fromParts("package", BuildConfig.APPLICATION_ID, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(fallback)
    }
}

fun requestNotificationsIfNeeded(activity: Activity): Boolean {
    if (notificationsEnabled(activity)) return false
    if (Build.VERSION.SDK_INT >= 33) {
        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2401)
        return true
    }
    openAppNotificationSettings(activity)
    return true
}

@Composable
fun NotificationBellButton(
    modifier: Modifier = Modifier,
    tint: Color = AttendifyPurple,
    size: Int = 26,
) {
    val context = LocalContext.current
    var showInfo by remember { mutableStateOf(false) }
    val enabled = remember(showInfo) { notificationsEnabled(context) }

    Box(
        modifier = modifier
            .size((size + 8).dp)
            .clip(CircleShape)
            .clickable { showInfo = true },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Default.Notifications,
            contentDescription = "Notifications",
            tint = tint,
            modifier = Modifier.size(size.dp),
        )
        if (!enabled) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(AttendifyPurple),
            )
        }
    }

    if (showInfo) {
        AlertDialog(
            onDismissRequest = { showInfo = false },
            title = { Text("Notifications") },
            text = {
                Text(
                    if (enabled) {
                        "Work-list reminders (for example after clock-in if Project Management is not updated) are delivered here."
                    } else {
                        "Notifications are off. Turn them on so Attendify can remind you to fill the work list for the day."
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showInfo = false
                        val activity = context as? FragmentActivity ?: context as? Activity
                        if (activity != null && !notificationsEnabled(context)) {
                            requestNotificationsIfNeeded(activity)
                        }
                        openAppNotificationSettings(context)
                        Toast.makeText(context, "Opening notification settings", Toast.LENGTH_SHORT).show()
                    },
                ) {
                    Text(if (enabled) "Open settings" else "Enable")
                }
            },
            dismissButton = {
                TextButton(onClick = { showInfo = false }) { Text("Close") }
            },
        )
    }
}

fun openNotificationsFromMenu(context: Context) {
    val activity = context as? FragmentActivity ?: context as? Activity
    if (activity != null && !notificationsEnabled(context)) {
        requestNotificationsIfNeeded(activity)
    }
    openAppNotificationSettings(context)
}
