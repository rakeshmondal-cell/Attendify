package com.attendify.employee

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class AttendifyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ensureWorkListChannel()
    }

    private fun ensureWorkListChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            WORK_LIST_CHANNEL_ID,
            "Work list reminders",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Reminders to update the Project Management work list"
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val WORK_LIST_CHANNEL_ID = "work_list"
        const val WORK_LIST_MESSAGE = "Please fill the work list for the day."
    }
}
