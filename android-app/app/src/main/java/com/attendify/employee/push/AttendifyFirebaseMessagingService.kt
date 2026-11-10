package com.attendify.employee.push

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.attendify.employee.AttendifyApplication
import com.attendify.employee.MainActivity
import com.attendify.employee.R
import com.attendify.employee.data.AttendifyApi
import com.attendify.employee.data.DeviceVault
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AttendifyFirebaseMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        scope.launch {
            val vault = DeviceVault(applicationContext)
            val session = vault.sessionToken ?: return@launch
            runCatching { AttendifyApi().registerPushToken(session, token) }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val body = message.notification?.body
            ?: message.data["message"]
            ?: AttendifyApplication.WORK_LIST_MESSAGE
        val title = message.notification?.title ?: "Attendify"
        showNotification(title, body, message.data["deliveryId"])
    }

    private fun showNotification(title: String, body: String, deliveryId: String?) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val launch = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, AttendifyApplication.WORK_LIST_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(launch)
            .build()
        val id = deliveryId?.hashCode() ?: body.hashCode()
        NotificationManagerCompat.from(this).notify(id, notification)
    }
}
