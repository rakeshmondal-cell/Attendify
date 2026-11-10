package com.attendify.employee.ui

import android.Manifest
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.AuthPhase
import com.attendify.employee.UiState

@Composable
fun AttendifyApp(viewModel: AttendifyViewModel) {
    val state by viewModel.state.collectAsState()
    val activity = LocalContext.current as FragmentActivity
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        val allowed = grants.values.any { it }
        if (state.phase == AuthPhase.Home && allowed) viewModel.refreshLocationStatus()
    }

    fun askLocationPermission() {
        permissionLauncher.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ),
        )
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* no-op: FCM still registers; notifications show when granted */ }

    LaunchedEffect(state.phase) {
        if (state.phase == AuthPhase.Home) {
            askLocationPermission()
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    LaunchedEffect(state.error) {
        if (state.phase == AuthPhase.Home && state.error?.contains("Allow location access") == true) {
            askLocationPermission()
        }
    }

    when (state.phase) {
        AuthPhase.Checking -> LoadingScreen()
        AuthPhase.SetupEmail, AuthPhase.ActivationEmail -> SetupEmailScreen(state, viewModel)
        AuthPhase.SetupOtp, AuthPhase.ActivationOtp -> SetupOtpScreen(state, viewModel)
        AuthPhase.SetupFingerprint, AuthPhase.ActivationFingerprint ->
            SetupFingerprintScreen(state, viewModel, activity)
        AuthPhase.SetupBlocked -> SetupBlockedScreen(state, viewModel, activity)
        AuthPhase.SetupPasscodePending -> SetupPasscodePendingScreen(state, viewModel)
        AuthPhase.LockedFingerprint, AuthPhase.ReturningFingerprint ->
            LockedFingerprintScreen(state, viewModel, activity)
        AuthPhase.LockedPasscode -> LockedPasscodeScreen(state, viewModel)
        AuthPhase.ForgotEmail -> ForgotEmailScreen(state, viewModel)
        AuthPhase.ForgotOtp, AuthPhase.Recovery -> ForgotOtpScreen(state, viewModel)
        AuthPhase.ReturningEmail, AuthPhase.ReturningOtp -> LockedFingerprintScreen(state, viewModel, activity)
        AuthPhase.Home -> {
            if (!state.unlockedThisProcess) {
                LaunchedEffect(Unit) { viewModel.reassertLockGate() }
                LoadingScreen()
            } else {
                HomeScreen(state, viewModel)
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.White),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = AttendifyPurple)
    }
}

@Composable
private fun SetupEmailScreen(state: UiState, viewModel: AttendifyViewModel) {
    AuthScaffold(
        title = "Verify your work email",
        subtitle = "Enter the work email HR created for you. We will send a one-time code.",
        state = state,
    ) {
        AuthEmailField(
            value = state.email,
            onValueChange = viewModel::updateEmail,
            enabled = !state.busy,
        )
        Spacer(Modifier.height(24.dp))
        PrimaryCta(
            label = "Send code",
            enabled = !state.busy && state.email.isNotBlank(),
            onClick = viewModel::requestActivationOtp,
        )
    }
}

@Composable
private fun SetupOtpScreen(state: UiState, viewModel: AttendifyViewModel) {
    AuthScaffold(
        title = "Verify code",
        subtitle = "Enter the 6-digit code sent to ${state.email}.",
        state = state,
    ) {
        AuthEmailField(
            value = state.otp,
            onValueChange = viewModel::updateOtp,
            enabled = !state.busy,
            label = "6-digit code",
            keyboardType = KeyboardType.NumberPassword,
        )
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = viewModel::requestActivationOtp, enabled = !state.busy) {
            Text("Resend code", color = AttendifyPurple, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
        PrimaryCta(
            label = "Continue",
            enabled = !state.busy && state.otp.length == 6,
            onClick = viewModel::verifyActivationOtp,
        )
    }
}

@Composable
private fun SetupFingerprintScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    activity: FragmentActivity,
) {
    AuthScaffold(
        title = "Set up fingerprint unlock",
        subtitle = "Fingerprint unlocks Attendify on this phone. Your screen-lock PIN is never used as the app passcode.",
        state = state,
    ) {
        Box(
            modifier = Modifier
                .size(180.dp)
                .clip(CircleShape)
                .background(AttendifyPurpleSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Fingerprint, null, tint = AttendifyPurple, modifier = Modifier.size(96.dp))
        }
        Spacer(Modifier.height(36.dp))
        PrimaryCta(
            label = "Verify fingerprint",
            enabled = !state.busy,
            onClick = { viewModel.finishActivation(activity) },
        )
    }
}

@Composable
private fun SetupBlockedScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    activity: FragmentActivity,
) {
    AuthScaffold(
        title = "Fingerprint required",
        subtitle = state.message ?: state.error ?: "This phone must support fingerprint unlock.",
        state = state,
    ) {
        PrimaryCta(
            label = "Open fingerprint settings",
            enabled = !state.busy,
            onClick = {
                activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
            },
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = viewModel::resumeFingerprintSetupAfterSettings, enabled = !state.busy) {
            Text("I enrolled a fingerprint — continue", color = AttendifyPurple, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SetupPasscodePendingScreen(state: UiState, viewModel: AttendifyViewModel) {
    AuthScaffold(
        title = "Passcode email pending",
        subtitle = "Your phone is registered. We still need to email your app passcode.",
        state = state,
    ) {
        PrimaryCta(
            label = "Retry passcode email",
            enabled = !state.busy,
            onClick = viewModel::retryPasscodeEmail,
        )
    }
}

@Composable
private fun LockedFingerprintScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    activity: FragmentActivity,
) {
    AuthScaffold(
        title = "Unlock Attendify",
        subtitle = state.biometricStatusMessage
            ?: "Use your fingerprint. After 3 mismatches you can enter your app passcode.",
        state = state,
    ) {
        Box(
            modifier = Modifier
                .size(160.dp)
                .clip(CircleShape)
                .background(AttendifyPurpleSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Fingerprint, null, tint = AttendifyPurple, modifier = Modifier.size(88.dp))
        }
        Spacer(Modifier.height(12.dp))
        if (state.biometricFailCount > 0) {
            Text(
                "Fingerprint mismatches: ${state.biometricFailCount} of 3",
                color = AttendifyMuted,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(12.dp))
        }
        PrimaryCta(
            label = "Unlock with fingerprint",
            enabled = !state.busy,
            onClick = { viewModel.unlockWithFingerprint(activity) },
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = viewModel::showPasscodeUnlock, enabled = !state.busy) {
            Text("Use app passcode", color = AttendifyPurple, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun LockedPasscodeScreen(state: UiState, viewModel: AttendifyViewModel) {
    AuthScaffold(
        title = "Enter app passcode",
        subtitle = "This is the Attendify passcode emailed to you — not your phone screen-lock PIN.",
        state = state,
    ) {
        AuthEmailField(
            value = state.passcode,
            onValueChange = viewModel::updatePasscode,
            enabled = !state.busy,
            label = "App passcode",
            keyboardType = KeyboardType.Ascii,
        )
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = viewModel::showForgotPasscode, enabled = !state.busy) {
            Text("Forgot passcode?", color = AttendifyPurple, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
        PrimaryCta(
            label = "Unlock",
            enabled = !state.busy && state.passcode.length >= 4,
            onClick = viewModel::unlockWithPasscode,
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = viewModel::backToFingerprintUnlock, enabled = !state.busy) {
            Text("Back to fingerprint", color = AttendifyMuted)
        }
    }
}

@Composable
private fun ForgotEmailScreen(state: UiState, viewModel: AttendifyViewModel) {
    AuthScaffold(
        title = "Forgot passcode",
        subtitle = "Enter the work email registered on this phone. We will send a recovery code.",
        state = state,
    ) {
        AuthEmailField(
            value = state.email,
            onValueChange = viewModel::updateEmail,
            enabled = !state.busy,
        )
        Spacer(Modifier.height(24.dp))
        PrimaryCta(
            label = "Send recovery code",
            enabled = !state.busy && state.email.isNotBlank(),
            onClick = viewModel::requestForgotOtp,
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = viewModel::showPasscodeUnlock, enabled = !state.busy) {
            Text("Back", color = AttendifyMuted)
        }
    }
}

@Composable
private fun ForgotOtpScreen(state: UiState, viewModel: AttendifyViewModel) {
    AuthScaffold(
        title = "Enter recovery code",
        subtitle = "After this code is verified, a new app passcode is emailed. You must type that passcode to unlock.",
        state = state,
    ) {
        AuthEmailField(
            value = state.otp,
            onValueChange = viewModel::updateOtp,
            enabled = !state.busy,
            label = "6-digit code",
            keyboardType = KeyboardType.NumberPassword,
        )
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = viewModel::requestForgotOtp, enabled = !state.busy) {
            Text("Resend code", color = AttendifyPurple, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
        PrimaryCta(
            label = "Verify & email new passcode",
            enabled = !state.busy && state.otp.length == 6,
            onClick = viewModel::verifyForgotOtp,
        )
    }
}

@Composable
fun AuthScaffold(
    title: String,
    subtitle: String,
    state: UiState,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AttendifyLogo()
        Spacer(Modifier.height(28.dp))
        Text(title, color = AttendifyIndigo, fontWeight = FontWeight.Bold, fontSize = 26.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(10.dp))
        Text(subtitle, color = AttendifyMuted, fontSize = 15.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        content()
        if (!state.error.isNullOrBlank()) {
            Spacer(Modifier.height(16.dp))
            Text(state.error, color = Color(0xFFA11D3A), textAlign = TextAlign.Center, fontSize = 13.sp)
        }
        if (!state.message.isNullOrBlank()) {
            Spacer(Modifier.height(12.dp))
            Text(state.message, color = AttendifyPurple, textAlign = TextAlign.Center, fontSize = 13.sp)
        }
        if (state.busy) {
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator(color = AttendifyPurple, modifier = Modifier.size(28.dp))
        }
    }
}

@Composable
fun AuthEmailField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    label: String = "Work email",
    keyboardType: KeyboardType = KeyboardType.Email,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = true,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = AttendifyPurple,
            cursorColor = AttendifyPurple,
            focusedLabelColor = AttendifyPurple,
        ),
    )
}
