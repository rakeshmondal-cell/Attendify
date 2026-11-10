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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.attendify.employee.AttendifyViewModel
import com.attendify.employee.AuthPhase
import com.attendify.employee.UiState
import kotlinx.coroutines.delay

private val ScreenBg = Color.White
private val StepInactive = Color(0xFFD8D5E8)
private val FieldBorder = Color(0xFFE0DCEA)
private val Navy = AttendifyIndigo
private val Muted = AttendifyMuted

@Composable
fun ReturningLoginScreen(
    state: UiState,
    viewModel: AttendifyViewModel,
    activity: FragmentActivity,
) {
    val step = when (state.phase) {
        AuthPhase.ReturningEmail -> 1
        AuthPhase.ReturningOtp -> 2
        else -> 3
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ScreenBg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 24.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(28.dp))
            AttendifyLogo()
            Spacer(Modifier.height(28.dp))
            StepRail(step = step, total = 3)
            Spacer(Modifier.height(10.dp))
            Text(
                "Step $step of 3",
                color = Muted,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(28.dp))

            when (state.phase) {
                AuthPhase.ReturningEmail -> EmailStep(state, viewModel)
                AuthPhase.ReturningOtp -> OtpStep(state, viewModel)
                else -> FingerprintStep(state, viewModel, activity)
            }

            if (!state.error.isNullOrBlank()) {
                Spacer(Modifier.height(16.dp))
                Text(state.error, color = Color(0xFFA11D3A), textAlign = TextAlign.Center, fontSize = 13.sp)
            }
            if (!state.message.isNullOrBlank() && !state.message.startsWith("Fingerprint")) {
                Spacer(Modifier.height(10.dp))
                Text(state.message, color = AttendifyPurple, textAlign = TextAlign.Center, fontSize = 13.sp)
            }
            if (state.busy) {
                Spacer(Modifier.height(16.dp))
                CircularProgressIndicator(color = AttendifyPurple, modifier = Modifier.size(28.dp))
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun FingerprintStep(
    state: UiState,
    viewModel: AttendifyViewModel,
    activity: FragmentActivity,
) {
    Text(
        "Verify fingerprint",
        color = Navy,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(8.dp))
    Text(
        "Email verified. Use your fingerprint to finish signing in.",
        color = Muted,
        fontSize = 15.sp,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(40.dp))
    Box(
        modifier = Modifier
            .size(180.dp)
            .clip(CircleShape)
            .background(AttendifyPurpleSoft),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Default.Fingerprint,
            contentDescription = null,
            tint = AttendifyPurple,
            modifier = Modifier.size(96.dp),
        )
    }
    Spacer(Modifier.height(48.dp))
    PrimaryCta(
        label = if (state.canUseBiometric) "Verify fingerprint" else "Continue",
        enabled = !state.busy,
        onClick = { viewModel.finishReturningLogin(activity) },
    )
    Spacer(Modifier.height(18.dp))
    HelpLink(onClick = viewModel::requestRecovery, enabled = !state.busy)
}

@Composable
private fun EmailStep(state: UiState, viewModel: AttendifyViewModel) {
    Text(
        "Enter work email",
        color = Navy,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(8.dp))
    Text(
        "We'll send a verification code to your email. Fingerprint is required after that.",
        color = Muted,
        fontSize = 15.sp,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(28.dp))
    EmailField(
        value = state.email,
        onValueChange = viewModel::updateEmail,
        enabled = !state.busy,
    )
    Spacer(Modifier.height(28.dp))
    PrimaryCta(
        label = "Send OTP",
        enabled = !state.busy && state.email.isNotBlank(),
        onClick = viewModel::requestLoginOtp,
    )
    Spacer(Modifier.height(18.dp))
    Text(
        "Using a new phone?",
        color = AttendifyPurple,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier.clickable(enabled = !state.busy, onClick = viewModel::useDifferentPhone),
    )
    Spacer(Modifier.height(12.dp))
    HelpLink(onClick = viewModel::requestRecovery, enabled = !state.busy)
}

@Composable
private fun OtpStep(state: UiState, viewModel: AttendifyViewModel) {
    var secondsLeft by remember(state.phase, state.message) { mutableIntStateOf(30) }
    LaunchedEffect(state.phase, state.message) {
        secondsLeft = 30
        while (secondsLeft > 0) {
            delay(1_000)
            secondsLeft--
        }
    }

    Text(
        "Verify your email",
        color = Navy,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(8.dp))
    Text(
        buildAnnotatedString {
            append("Enter the 6-digit code sent to ")
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Navy)) {
                append(state.email.ifBlank { "your email" })
            }
        },
        color = Muted,
        fontSize = 15.sp,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(28.dp))
    OtpBoxes(
        value = state.otp,
        onValueChange = viewModel::updateOtp,
        enabled = !state.busy,
    )
    Spacer(Modifier.height(16.dp))
    if (secondsLeft > 0) {
        Text(
            "Resend OTP in %02d:%02d".format(secondsLeft / 60, secondsLeft % 60),
            color = Muted,
            fontSize = 13.sp,
        )
    } else {
        Text(
            "Resend OTP",
            color = AttendifyPurple,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            modifier = Modifier.clickable(enabled = !state.busy, onClick = viewModel::requestLoginOtp),
        )
    }
    Spacer(Modifier.height(12.dp))
    Text(
        "Change email",
        color = AttendifyPurple,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier.clickable(enabled = !state.busy, onClick = viewModel::changeEmailFromLogin),
    )
    Spacer(Modifier.height(28.dp))
    PrimaryCta(
        label = "Verify & sign in",
        enabled = !state.busy && state.otp.length == 6,
        onClick = viewModel::verifyLoginOtp,
    )
}

@Composable
fun AttendifyLogo() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(AttendifyPurple),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.size(20.dp)) {
                val stroke = 2.6.dp.toPx()
                val path = Path().apply {
                    moveTo(size.width * 0.22f, size.height * 0.52f)
                    lineTo(size.width * 0.42f, size.height * 0.72f)
                    lineTo(size.width * 0.78f, size.height * 0.30f)
                }
                drawPath(
                    path = path,
                    color = Color.White,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
                drawCircle(
                    color = Color.White,
                    radius = 2.2.dp.toPx(),
                    center = Offset(size.width * 0.78f, size.height * 0.30f),
                )
            }
        }
        Text(
            "Attendify",
            color = AttendifyPurple,
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp,
        )
    }
}

@Composable
fun StepRail(step: Int, total: Int = 3) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxWidth(),
    ) {
        for (index in 1..total) {
            val active = index <= step
            Box(
                modifier = Modifier
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(if (active) AttendifyPurple else StepInactive),
            )
            if (index < total) {
                Box(
                    modifier = Modifier
                        .width(56.dp)
                        .height(3.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (index < step) AttendifyPurple else StepInactive),
                )
            }
        }
    }
}

@Composable
fun PrimaryCta(label: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (enabled) AttendifyPurple else AttendifyPurple.copy(alpha = 0.45f))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = Color.White,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.Center,
        )
        Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = Color.White)
    }
}

@Composable
private fun HelpLink(onClick: () -> Unit, enabled: Boolean) {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = Muted, fontWeight = FontWeight.Normal)) {
                append("Need help? ")
            }
            withStyle(SpanStyle(color = AttendifyPurple, fontWeight = FontWeight.Bold)) {
                append("Contact HR")
            }
        },
        fontSize = 14.sp,
        modifier = Modifier.clickable(enabled = enabled, onClick = onClick),
    )
}

@Composable
private fun EmailField(value: String, onValueChange: (String) -> Unit, enabled: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(1.5.dp, FieldBorder, RoundedCornerShape(14.dp))
            .background(Color.White)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.Email, contentDescription = null, tint = AttendifyPurple, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Work email", color = Muted, fontSize = 11.sp)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                singleLine = true,
                textStyle = TextStyle(color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Medium),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                cursorBrush = SolidColor(AttendifyPurple),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun OtpBoxes(value: String, onValueChange: (String) -> Unit, enabled: Boolean) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        BasicTextField(
            value = value,
            onValueChange = { incoming ->
                onValueChange(incoming.filter { it.isDigit() }.take(6))
            },
            enabled = enabled,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            cursorBrush = SolidColor(Color.Transparent),
            textStyle = TextStyle(color = Color.Transparent),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .focusRequester(focusRequester),
            decorationBox = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    repeat(6) { index ->
                        val char = value.getOrNull(index)?.toString().orEmpty()
                        val focused = value.length == index || (value.length == 6 && index == 5)
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(56.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .border(
                                    width = 1.5.dp,
                                    color = if (focused) AttendifyPurple else FieldBorder,
                                    shape = RoundedCornerShape(12.dp),
                                )
                                .background(Color.White),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                char,
                                color = Navy,
                                fontWeight = FontWeight.Bold,
                                fontSize = 22.sp,
                            )
                        }
                    }
                }
            },
        )
    }
}
