package com.attendify.employee

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.attendify.employee.data.ApiException
import com.attendify.employee.data.AttendifyApi
import com.attendify.employee.data.DeviceKeyInvalidatedException
import com.attendify.employee.data.DeviceVault
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.Signature
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

enum class AuthPhase {
    Checking,
    SetupEmail,
    SetupOtp,
    SetupFingerprint,
    SetupBlocked,
    SetupPasscodePending,
    LockedFingerprint,
    LockedPasscode,
    ForgotEmail,
    ForgotOtp,
    /** @deprecated Keep aliases for any residual call sites during migration */
    ActivationEmail,
    ActivationOtp,
    ActivationFingerprint,
    ReturningFingerprint,
    ReturningEmail,
    ReturningOtp,
    Recovery,
    Home,
}

data class PunchPlace(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val addressLine: String,
    val mapsUrl: String,
    val streetViewUrl: String,
)

data class ActivityItem(
    val timeLabel: String,
    val title: String,
    val badge: String? = null,
)

data class HistoryDay(
    val workDate: String,
    val workDateLabel: String,
    val attendanceKind: String,
    val status: String,
    val workplaceName: String? = null,
    val shiftName: String? = null,
    val checkInLabel: String? = null,
    val checkOutLabel: String? = null,
    val hoursLabel: String? = null,
    val breaksLabel: String? = null,
)

data class HistorySummary(
    val present: Int = 0,
    val absent: Int = 0,
    val leave: Int = 0,
)

data class LeaveTypeOption(
    val value: String,
    val label: String,
)

data class RequestItem(
    val id: String,
    val requestType: String,
    val title: String,
    val dateLabel: String,
    val summary: String,
    val status: String,
    val statusLabel: String,
)

data class TeamRequestItem(
    val id: String,
    val employeeName: String,
    val employeeInitials: String,
    val title: String,
    val dateLabel: String,
    val daysText: String,
    val reason: String?,
    val status: String,
    val statusLabel: String,
    val roleLabel: String,
    val workplaceName: String,
    val balanceDays: Int,
    val reviewNote: String?,
)

data class RosterDay(
    val workDate: String,
    val dayLabel: String,
    val isOff: Boolean,
    val isToday: Boolean,
    val shiftName: String?,
    val shiftWindow: String?,
    val offLabel: String?,
)

data class AttendanceUi(
    val status: String? = null,
    val shiftName: String? = null,
    val shiftWindow: String? = null,
    val shiftStart: String? = null,
    val shiftEnd: String? = null,
    val workplaceName: String? = null,
    val workDateLabel: String? = null,
    val checkInAt: String? = null,
    val checkInLabel: String? = null,
    val checkOutLabel: String? = null,
    val hoursLabel: String? = null,
    val netMinutes: Int? = null,
    val arrival: String? = null,
    val checkInAddress: String? = null,
    val checkOutAddress: String? = null,
    val checkInStreetViewUrl: String? = null,
    val checkOutStreetViewUrl: String? = null,
)

data class UiState(
    val phase: AuthPhase = AuthPhase.Checking,
    val email: String = "",
    val otp: String = "",
    val firstName: String = "",
    val greeting: String = "Hello",
    val message: String? = null,
    val error: String? = null,
    val busy: Boolean = false,
    val locationReady: Boolean = false,
    val locationAddress: String? = null,
    val locationLatitude: Double? = null,
    val locationLongitude: Double? = null,
    val attendance: AttendanceUi = AttendanceUi(),
    val onBreak: Boolean = false,
    val breakStartedAtMs: Long? = null,
    val breakPlannedEndMs: Long? = null,
    val breakDurationMinutes: Int = 30,
    val breakType: String = "Lunch",
    val breakNote: String = "",
    val totalBreakMs: Long = 0L,
    val activity: List<ActivityItem> = emptyList(),
    val historyMonth: String? = null,
    val historyDays: List<HistoryDay> = emptyList(),
    val historySummary: HistorySummary? = null,
    val historyBusy: Boolean = false,
    val historyError: String? = null,
    val historyMessage: String? = null,
    val requests: List<RequestItem> = emptyList(),
    val leaveTypes: List<LeaveTypeOption> = emptyList(),
    val leaveBalanceDays: Int = 8,
    val requestsBusy: Boolean = false,
    val requestsError: String? = null,
    val requestsMessage: String? = null,
    val isManager: Boolean = false,
    val accessRole: String = "EMPLOYEE",
    val teamRequests: List<TeamRequestItem> = emptyList(),
    val teamPendingCount: Int = 0,
    val teamBusy: Boolean = false,
    val teamError: String? = null,
    val teamMessage: String? = null,
    val fullName: String = "",
    val profileInitials: String = "",
    val employeeCode: String? = null,
    val department: String? = null,
    val workplaceName: String? = null,
    val reportingManager: String? = null,
    val rosterWeekStart: String? = null,
    val rosterWeekLabel: String? = null,
    val rosterSummaryLabel: String? = null,
    val rosterDays: List<RosterDay> = emptyList(),
    val rosterBusy: Boolean = false,
    val rosterError: String? = null,
    val canUseBiometric: Boolean = false,
    val fingerprintVerified: Boolean = false,
    val loginStep: Int = 1,
    val passcode: String = "",
    val changeCurrentPasscode: String = "",
    val changeNewPasscode: String = "",
    val changeConfirmPasscode: String = "",
    val biometricFailCount: Int = 0,
    val unlockedThisProcess: Boolean = false,
    val biometricStatusMessage: String? = null,
    val pmWebUrl: String? = null,
    val workListReminderVisible: Boolean = false,
    val workListReminderMessage: String? = null,
    val checkoutGateBusy: Boolean = false,
)

class AttendifyViewModel(
    application: Application,
    private val savedState: SavedStateHandle,
    private val api: AttendifyApi = AttendifyApi(),
    private val vault: DeviceVault = DeviceVault(application),
) : AndroidViewModel(application) {
    private val _state = MutableStateFlow(
        UiState(biometricFailCount = savedState.get<Int>(KEY_BIO_FAIL) ?: 0),
    )
    val state: StateFlow<UiState> = _state

    private var activationToken: String? = null
    private var deviceProof: String? = null

    init {
        bootstrap()
    }

    fun updateEmail(value: String) = _state.update { it.copy(email = value, error = null) }
    fun updateOtp(value: String) = _state.update { it.copy(otp = value.filter { ch -> ch.isDigit() }.take(6), error = null) }
    fun updatePasscode(value: String) = _state.update {
        it.copy(passcode = value.filter { ch -> ch.isLetterOrDigit() || ch == '-' }.take(16).uppercase(), error = null)
    }

    fun updateChangeCurrentPasscode(value: String) = _state.update {
        it.copy(
            changeCurrentPasscode = value.filter { ch -> ch.isLetterOrDigit() || ch == '-' }.take(16),
            error = null,
        )
    }

    fun updateChangeNewPasscode(value: String) = _state.update {
        it.copy(
            changeNewPasscode = value.filter { ch -> ch.isLetterOrDigit() || ch == '-' }.take(16),
            error = null,
        )
    }

    fun updateChangeConfirmPasscode(value: String) = _state.update {
        it.copy(
            changeConfirmPasscode = value.filter { ch -> ch.isLetterOrDigit() || ch == '-' }.take(16),
            error = null,
        )
    }

    fun clearChangePasscodeFields(clearFeedback: Boolean = false) = _state.update {
        it.copy(
            changeCurrentPasscode = "",
            changeNewPasscode = "",
            changeConfirmPasscode = "",
            error = if (clearFeedback) null else it.error,
            message = if (clearFeedback) null else it.message,
        )
    }

    fun submitChangePasscode() = runAction {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        val current = normalizePasscodeInput(_state.value.changeCurrentPasscode)
        val next = normalizePasscodeInput(_state.value.changeNewPasscode)
        val confirm = normalizePasscodeInput(_state.value.changeConfirmPasscode)
        if (current.length < 4) throw ApiException("Enter your current app passcode.")
        if (next.length < 6 || next.length > 16) {
            throw ApiException("Choose a new passcode with 6 to 16 letters or digits.")
        }
        if (next != confirm) throw ApiException("New passcode and confirmation do not match.")
        if (next == current) throw ApiException("Choose a new passcode that is different from the current one.")
        val result = api.changePasscode(token, current, next)
        _state.update {
            it.copy(
                changeCurrentPasscode = "",
                changeNewPasscode = "",
                changeConfirmPasscode = "",
                message = result.optString(
                    "message",
                    "Your app passcode was updated. Use the new passcode next time fingerprint unlock fails.",
                ),
                error = null,
            )
        }
    }

    private fun normalizePasscodeInput(raw: String): String =
        raw.trim().uppercase().replace(Regex("[^A-Z0-9]"), "")

    private fun setBiometricFailCount(count: Int) {
        savedState[KEY_BIO_FAIL] = count
        _state.update { it.copy(biometricFailCount = count) }
    }

    /** Safety net if UI somehow lands on Home without an in-process unlock. */
    fun reassertLockGate() {
        if (_state.value.unlockedThisProcess) return
        val canBio = biometricAvailable()
        if (vault.isRegisteredReady()) {
            _state.update {
                it.copy(
                    phase = if (canBio) AuthPhase.LockedFingerprint else AuthPhase.LockedPasscode,
                    email = vault.email.orEmpty(),
                    canUseBiometric = canBio,
                    busy = false,
                    unlockedThisProcess = false,
                )
            }
        } else {
            _state.update {
                it.copy(
                    phase = AuthPhase.SetupEmail,
                    email = vault.email.orEmpty(),
                    canUseBiometric = canBio,
                    busy = false,
                    unlockedThisProcess = false,
                    message = "Complete fingerprint and passcode setup on this phone.",
                )
            }
        }
    }

    private fun bootstrap() {
        viewModelScope.launch {
            val canBio = biometricAvailable()
            val bioStatus = biometricStatusCode()
            // Migration: old installs without setupReady must complete revised setup once.
            if (!vault.deviceId.isNullOrBlank() && vault.hasDeviceKey() && !vault.setupReady) {
                _state.update {
                    it.copy(
                        phase = AuthPhase.SetupEmail,
                        email = vault.email.orEmpty(),
                        canUseBiometric = canBio,
                        busy = false,
                        message = "Update required: verify your work email and set up fingerprint unlock once.",
                        error = null,
                        unlockedThisProcess = false,
                    )
                }
                return@launch
            }
            if (vault.isRegisteredReady()) {
                // Optional server check: ACTIVE device without READY passcode → force re-setup (history kept).
                val deviceId = vault.deviceId
                val email = vault.email
                if (!deviceId.isNullOrBlank() && !email.isNullOrBlank()) {
                    try {
                        val status = api.deviceStatus(deviceId, email)
                        if (status.optBoolean("needsSetup", false)) {
                            vault.setupReady = false
                            _state.update {
                                it.copy(
                                    phase = AuthPhase.SetupEmail,
                                    email = email,
                                    canUseBiometric = canBio,
                                    busy = false,
                                    message = "Update required: verify your work email and set up fingerprint unlock once.",
                                    error = null,
                                    unlockedThisProcess = false,
                                )
                            }
                            return@launch
                        }
                    } catch (_: Exception) {
                        // Offline: keep local READY gate and unlock when network returns.
                    }
                }
                _state.update {
                    it.copy(
                        phase = AuthPhase.LockedFingerprint,
                        email = vault.email.orEmpty(),
                        canUseBiometric = canBio,
                        busy = false,
                        message = null,
                        error = null,
                        unlockedThisProcess = false,
                        biometricStatusMessage = when (bioStatus) {
                            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
                                "No fingerprint enrolled. Open Android Settings, add a fingerprint, then return."
                            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
                            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE,
                            BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED,
                            -> "Fingerprint is not available. Use your app passcode."
                            else -> null
                        },
                    )
                }
                if (bioStatus != BiometricManager.BIOMETRIC_SUCCESS &&
                    bioStatus != BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
                ) {
                    _state.update { it.copy(phase = AuthPhase.LockedPasscode) }
                }
                return@launch
            }
            _state.update {
                it.copy(
                    phase = AuthPhase.SetupEmail,
                    email = vault.email.orEmpty(),
                    canUseBiometric = canBio,
                    busy = false,
                    message = null,
                    error = null,
                    unlockedThisProcess = false,
                )
            }
        }
    }

    fun requestActivationOtp() = runAction {
        val email = _state.value.email.trim()
        val result = api.requestOtp(email, "ACTIVATION")
        vault.email = email
        _state.update {
            it.copy(
                phase = AuthPhase.SetupOtp,
                message = if (result != null) "Development code: $result" else "Enter the code sent to your work email.",
            )
        }
    }

    fun verifyActivationOtp() = runAction {
        val email = _state.value.email.trim()
        val verified = api.verifyOtp(email, "ACTIVATION", _state.value.otp)
        activationToken = verified.getString("activationToken")
        val status = biometricStatusCode()
        when (status) {
            BiometricManager.BIOMETRIC_SUCCESS -> {
                _state.update {
                    it.copy(
                        phase = AuthPhase.SetupFingerprint,
                        canUseBiometric = true,
                        otp = "",
                        message = "Email verified. Set up fingerprint unlock.",
                        error = null,
                    )
                }
            }
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> {
                _state.update {
                    it.copy(
                        phase = AuthPhase.SetupBlocked,
                        canUseBiometric = false,
                        otp = "",
                        message = "Add a fingerprint in Android Settings, then return to Attendify to continue.",
                        error = null,
                    )
                }
            }
            else -> {
                _state.update {
                    it.copy(
                        phase = AuthPhase.SetupBlocked,
                        canUseBiometric = false,
                        otp = "",
                        error = "This phone cannot meet Attendify’s fingerprint requirement.",
                        message = null,
                    )
                }
            }
        }
    }

    fun resumeFingerprintSetupAfterSettings() {
        val status = biometricStatusCode()
        if (status == BiometricManager.BIOMETRIC_SUCCESS && !activationToken.isNullOrBlank()) {
            _state.update {
                it.copy(
                    phase = AuthPhase.SetupFingerprint,
                    canUseBiometric = true,
                    message = "Fingerprint enrolled. Continue setup.",
                    error = null,
                )
            }
        } else if (status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) {
            _state.update {
                it.copy(
                    phase = AuthPhase.SetupBlocked,
                    message = "Still no fingerprint enrolled. Open Settings, add one, then return.",
                )
            }
        }
    }

    fun finishActivation(activity: FragmentActivity) {
        val token = activationToken
        if (token.isNullOrBlank()) {
            _state.update { it.copy(error = "Setup expired. Start again with your work email.") }
            return
        }
        if (biometricStatusCode() != BiometricManager.BIOMETRIC_SUCCESS) {
            _state.update {
                it.copy(
                    phase = AuthPhase.SetupBlocked,
                    error = "Fingerprint is required before this phone can be registered.",
                )
            }
            return
        }
        runAction {
            val email = vault.email ?: _state.value.email.trim()
            vault.createDeviceKey(requireUserAuth = true)
            val cryptoSignature = vault.prepareCryptoSignature()
            val unlocked = authenticateCrypto(
                activity = activity,
                title = "Set up fingerprint unlock",
                subtitle = "Confirm your fingerprint. Your phone screen-lock PIN is not used as the Attendify passcode.",
                signature = cryptoSignature,
            )
            vault.signNonce(unlocked, localActivationNonce())

            val deviceId = api.registerDevice(
                activationToken = token,
                publicKeySpki = vault.publicKeySpki(),
                label = "${Build.MANUFACTURER} ${Build.MODEL}",
                biometricBound = true,
            )
            vault.deviceId = deviceId
            vault.email = email
            vault.biometricBound = true
            vault.setupReady = false
            finalizeSetupAfterRegister(token, deviceId)
        }
    }

    fun retryPasscodeEmail() = runAction {
        val token = activationToken ?: throw ApiException("Setup expired. Start again with your work email.")
        val deviceId = vault.deviceId ?: throw ApiException("Register this phone first.")
        finalizeSetupAfterRegister(token, deviceId)
    }

    private suspend fun finalizeSetupAfterRegister(token: String, deviceId: String) {
        try {
            val session = api.finalizeSetup(token, deviceId)
            vault.sessionToken = session.getString("token")
            vault.setupReady = true
            activationToken = null
            val devPass = session.optString("devPasscode").ifBlank { null }
            setBiometricFailCount(0)
            _state.update {
                it.copy(
                    unlockedThisProcess = true,
                    message = if (devPass != null) {
                        "Dev passcode: $devPass (also emailed when SMTP is configured)."
                    } else {
                        session.optString("message", "Your app passcode was emailed.")
                    },
                )
            }
            loadHome(vault.sessionToken!!)
        } catch (error: ApiException) {
            if (error.statusCode == 502 ||
                error.message?.contains("passcode email", ignoreCase = true) == true ||
                error.message?.contains("MAIL", ignoreCase = true) == true
            ) {
                _state.update {
                    it.copy(
                        phase = AuthPhase.SetupPasscodePending,
                        error = error.message,
                        message = "Registration saved. Retry sending your app passcode email.",
                    )
                }
                return
            }
            throw error
        }
    }

    fun unlockWithFingerprint(activity: FragmentActivity) {
        val deviceId = vault.deviceId
        val email = vault.email
        if (!vault.isRegisteredReady() || deviceId.isNullOrBlank() || email.isNullOrBlank()) {
            _state.update { it.copy(phase = AuthPhase.SetupEmail, error = "Complete setup on this phone first.") }
            return
        }
        runAction {
            val challenge = api.createDeviceChallenge(deviceId, email)
            val cryptoSignature = try {
                vault.prepareCryptoSignature()
            } catch (error: DeviceKeyInvalidatedException) {
                vault.setupReady = false
                _state.update {
                    it.copy(
                        phase = AuthPhase.SetupEmail,
                        unlockedThisProcess = false,
                        message = "Fingerprint settings changed. Verify your work email and set up fingerprint again.",
                        error = null,
                    )
                }
                return@runAction
            }
            val unlocked = authenticateCryptoForUnlock(
                activity = activity,
                title = "Unlock Attendify",
                subtitle = "Use your fingerprint. After 3 mismatches you can enter your app passcode.",
                signature = cryptoSignature,
            ) ?: return@runAction // cancelled or switched to passcode
            val signature = vault.signNonce(unlocked, challenge.getString("nonce"))
            val proof = api.verifyDeviceChallenge(challenge.getString("challengeId"), signature)
            val session = try {
                api.unlockBiometric(proof)
            } catch (error: ApiException) {
                if (error.statusCode == 409 || error.message?.contains("setup", ignoreCase = true) == true) {
                    vault.setupReady = false
                    _state.update {
                        it.copy(
                            phase = AuthPhase.SetupEmail,
                            unlockedThisProcess = false,
                            message = "Update required: verify your work email and set up fingerprint unlock once.",
                        )
                    }
                    return@runAction
                }
                throw error
            }
            vault.sessionToken = session.getString("token")
            setBiometricFailCount(0)
            _state.update { it.copy(unlockedThisProcess = true, error = null) }
            loadHome(vault.sessionToken!!)
        }
    }

    fun unlockWithPasscode() = runAction {
        val deviceId = vault.deviceId ?: throw ApiException("This phone is not registered.")
        val passcode = _state.value.passcode.trim()
        if (passcode.length < 4) throw ApiException("Enter the app passcode from your email.")
        val session = try {
            api.unlockPasscode(deviceId, passcode)
        } catch (error: ApiException) {
            if (error.statusCode == 409 || error.message?.contains("Complete setup", ignoreCase = true) == true) {
                vault.setupReady = false
                _state.update {
                    it.copy(
                        phase = AuthPhase.SetupEmail,
                        unlockedThisProcess = false,
                        message = "Update required: verify your work email and set up fingerprint unlock once.",
                    )
                }
                return@runAction
            }
            throw error
        }
        vault.sessionToken = session.getString("token")
        setBiometricFailCount(0)
        _state.update {
            it.copy(
                passcode = "",
                unlockedThisProcess = true,
                error = null,
                message = null,
            )
        }
        loadHome(vault.sessionToken!!)
    }

    fun showPasscodeUnlock() {
        _state.update {
            it.copy(phase = AuthPhase.LockedPasscode, error = null, message = "Enter the app passcode emailed to you.")
        }
    }

    fun showForgotPasscode() {
        _state.update {
            it.copy(
                phase = AuthPhase.ForgotEmail,
                otp = "",
                email = vault.email.orEmpty().ifBlank { it.email },
                message = "Enter the work email registered on this phone.",
                error = null,
            )
        }
    }

    fun requestForgotOtp() = runAction {
        val deviceId = vault.deviceId ?: throw ApiException("This phone is not registered.")
        val email = _state.value.email.trim()
        if (email.isBlank()) throw ApiException("Enter your work email.")
        val code = api.requestPasscodeReset(email, deviceId)
        _state.update {
            it.copy(
                phase = AuthPhase.ForgotOtp,
                message = if (code != null) "Development code: $code" else "Enter the recovery code sent to your email.",
            )
        }
    }

    fun verifyForgotOtp() = runAction {
        val deviceId = vault.deviceId ?: throw ApiException("This phone is not registered.")
        val result = api.verifyPasscodeReset(_state.value.email.trim(), deviceId, _state.value.otp)
        val devPass = result.optString("devPasscode").ifBlank { null }
        _state.update {
            it.copy(
                phase = AuthPhase.LockedPasscode,
                otp = "",
                passcode = "",
                message = if (devPass != null) {
                    "Dev passcode: $devPass. Enter it to unlock."
                } else {
                    result.optString(
                        "message",
                        "A new app passcode was emailed. Enter it to unlock. The recovery code alone cannot unlock the app.",
                    )
                },
                error = null,
            )
        }
    }

    fun backToFingerprintUnlock() {
        _state.update {
            it.copy(
                phase = AuthPhase.LockedFingerprint,
                passcode = "",
                error = null,
                message = null,
            )
        }
    }

    fun beginReturningLogin(activity: FragmentActivity) = unlockWithFingerprint(activity)
    fun finishReturningLogin(activity: FragmentActivity) = unlockWithFingerprint(activity)
    fun requestLoginOtp() = showPasscodeUnlock()
    fun verifyLoginOtp() = unlockWithPasscode()
    fun changeEmailFromLogin() = showForgotPasscode()

    fun useDifferentPhone() {
        deviceProof = null
        activationToken = null
        vault.clearAll()
        _state.update {
            it.copy(
                phase = AuthPhase.SetupEmail,
                email = it.email,
                otp = "",
                passcode = "",
                fingerprintVerified = false,
                unlockedThisProcess = false,
                message = "New phone setup: verify email, fingerprint, then your app passcode is emailed.",
                error = null,
            )
        }
        setBiometricFailCount(0)
    }

    fun requestRecovery() = showForgotPasscode()
    fun verifyRecovery() = verifyForgotOtp()

    fun refreshHome() = runAction {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        loadHome(token)
    }

    fun loadAttendanceHistory(month: String) = runAction(showBusy = false) {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        _state.update { it.copy(historyBusy = true, historyError = null, historyMessage = null) }
        try {
            val payload = api.attendanceHistory(token, month)
            val summary = payload.optJSONObject("summary")
            val daysJson = payload.optJSONArray("days")
            val days = buildList {
                if (daysJson != null) {
                    for (i in 0 until daysJson.length()) {
                        val row = daysJson.getJSONObject(i)
                        add(
                            HistoryDay(
                                workDate = row.optString("workDate"),
                                workDateLabel = row.optString("workDateLabel"),
                                attendanceKind = row.optString("attendanceKind"),
                                status = row.optString("status"),
                                workplaceName = row.optString("workplaceName").ifBlank { null },
                                shiftName = row.optString("shiftName").ifBlank { null },
                                checkInLabel = row.optString("checkInLabel").ifBlank { null },
                                checkOutLabel = row.optString("checkOutLabel").ifBlank { null },
                                hoursLabel = row.optString("hoursLabel").ifBlank { null },
                                breaksLabel = row.optString("breaksLabel").ifBlank { null },
                            ),
                        )
                    }
                }
            }
            _state.update {
                it.copy(
                    historyMonth = month,
                    historyDays = days,
                    historySummary = HistorySummary(
                        present = summary?.optInt("present") ?: 0,
                        absent = summary?.optInt("absent") ?: 0,
                        leave = summary?.optInt("leave") ?: 0,
                    ),
                    historyBusy = false,
                    historyError = null,
                )
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(
                    historyBusy = false,
                    historyError = error.message ?: "Could not load attendance history.",
                )
            }
        }
    }

    fun loadShiftRoster(weekStart: String?) = runAction(showBusy = false) {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        _state.update { it.copy(rosterBusy = true, rosterError = null) }
        try {
            val payload = api.shiftRoster(token, weekStart)
            val daysJson = payload.optJSONArray("days")
            val days = buildList {
                if (daysJson != null) {
                    for (i in 0 until daysJson.length()) {
                        val row = daysJson.getJSONObject(i)
                        add(
                            RosterDay(
                                workDate = row.optString("workDate"),
                                dayLabel = row.optString("dayLabel"),
                                isOff = row.optBoolean("isOff"),
                                isToday = row.optBoolean("isToday"),
                                shiftName = row.optString("shiftName").ifBlank { null },
                                shiftWindow = row.optString("shiftWindow").ifBlank { null },
                                offLabel = row.optString("offLabel").ifBlank { null },
                            ),
                        )
                    }
                }
            }
            _state.update {
                it.copy(
                    rosterWeekStart = payload.optString("weekStart").ifBlank { weekStart },
                    rosterWeekLabel = payload.optString("weekLabel").ifBlank { null },
                    rosterSummaryLabel = payload.optString("summaryLabel").ifBlank { null },
                    rosterDays = days,
                    rosterBusy = false,
                    rosterError = null,
                )
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(rosterBusy = false, rosterError = error.message ?: "Could not load shift roster.")
            }
        }
    }

    fun loadRequests() = runAction(showBusy = false) {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        _state.update { it.copy(requestsBusy = true, requestsError = null, requestsMessage = null) }
        try {
            val payload = api.listRequests(token)
            val typesJson = payload.optJSONArray("leaveTypes")
            val leaveTypes = buildList {
                if (typesJson != null) {
                    for (i in 0 until typesJson.length()) {
                        val row = typesJson.getJSONObject(i)
                        add(LeaveTypeOption(row.optString("value"), row.optString("label")))
                    }
                }
            }
            val reqJson = payload.optJSONArray("requests")
            val requests = buildList {
                if (reqJson != null) {
                    for (i in 0 until reqJson.length()) {
                        val row = reqJson.getJSONObject(i)
                        add(
                            RequestItem(
                                id = row.optString("id"),
                                requestType = row.optString("requestType"),
                                title = row.optString("title"),
                                dateLabel = row.optString("dateLabel"),
                                summary = row.optString("summary"),
                                status = row.optString("status"),
                                statusLabel = row.optString("statusLabel"),
                            ),
                        )
                    }
                }
            }
            _state.update {
                it.copy(
                    requests = requests,
                    leaveTypes = leaveTypes,
                    leaveBalanceDays = payload.optInt("balanceDays", 8),
                    requestsBusy = false,
                    requestsError = null,
                )
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(requestsBusy = false, requestsError = error.message ?: "Could not load requests.")
            }
        }
    }

    fun loadTeamRequests() = runAction(showBusy = false) {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        _state.update { it.copy(teamBusy = true, teamError = null, teamMessage = null) }
        try {
            val payload = api.listTeamRequests(token)
            val reqJson = payload.optJSONArray("requests")
            val requests = buildList {
                if (reqJson != null) {
                    for (i in 0 until reqJson.length()) {
                        val row = reqJson.getJSONObject(i)
                        add(
                            TeamRequestItem(
                                id = row.optString("id"),
                                employeeName = row.optString("employeeName"),
                                employeeInitials = row.optString("employeeInitials"),
                                title = row.optString("title"),
                                dateLabel = row.optString("dateLabel"),
                                daysText = row.optString("daysText"),
                                reason = row.optString("reason").ifBlank { null },
                                status = row.optString("status"),
                                statusLabel = row.optString("statusLabel"),
                                roleLabel = row.optString("roleLabel"),
                                workplaceName = row.optString("workplaceName").ifBlank { "Head Office" },
                                balanceDays = row.optInt("balanceDays", 8),
                                reviewNote = row.optString("reviewNote").ifBlank { null },
                            ),
                        )
                    }
                }
            }
            _state.update {
                it.copy(
                    teamRequests = requests,
                    teamPendingCount = payload.optInt("pendingCount"),
                    teamBusy = false,
                    teamError = null,
                )
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(teamBusy = false, teamError = error.message ?: "Could not load team requests.")
            }
        }
    }

    fun reviewTeamRequest(requestId: String, decision: String, reviewNote: String) = runAction(showBusy = false) {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        _state.update { it.copy(teamBusy = true, teamError = null, teamMessage = null) }
        try {
            api.reviewTeamRequest(token, requestId, decision, reviewNote.ifBlank { null })
            _state.update { it.copy(teamBusy = false, teamMessage = "reviewed", teamError = null) }
            loadTeamRequests()
        } catch (error: Exception) {
            _state.update {
                it.copy(teamBusy = false, teamError = error.message ?: "Could not review request.")
            }
        }
    }

    fun submitLeaveRequest(
        leaveType: String,
        startDate: String,
        endDate: String,
        duration: String,
        reason: String,
        attachmentName: String?,
    ) = runAction(showBusy = false) {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        _state.update { it.copy(requestsBusy = true, requestsError = null, requestsMessage = null) }
        try {
            api.createLeaveRequest(
                token = token,
                leaveType = leaveType,
                startDate = startDate,
                endDate = endDate,
                duration = duration,
                reason = reason.ifBlank { null },
                attachmentName = attachmentName,
            )
            _state.update { it.copy(requestsBusy = false, requestsMessage = "submitted", requestsError = null) }
        } catch (error: Exception) {
            _state.update {
                it.copy(requestsBusy = false, requestsError = error.message ?: "Could not submit leave request.")
            }
        }
    }

    fun exportAttendanceHistory() {
        val days = _state.value.historyDays
        if (days.isEmpty()) {
            _state.update { it.copy(historyMessage = "No attendance rows to export for this month.") }
            return
        }
        val csv = buildString {
            appendLine("Date,Status,Check-in,Check-out,Work time,Workplace,Shift")
            days.forEach { day ->
                appendLine(
                    listOf(
                        day.workDateLabel,
                        day.attendanceKind,
                        day.checkInLabel.orEmpty(),
                        day.checkOutLabel.orEmpty(),
                        day.hoursLabel.orEmpty(),
                        day.workplaceName.orEmpty(),
                        day.shiftName.orEmpty(),
                    ).joinToString(",") { cell ->
                        if (cell.contains(',') || cell.contains('"')) "\"${cell.replace("\"", "\"\"")}\"" else cell
                    },
                )
            }
        }
        val dir = getApplication<Application>().getExternalFilesDir(null) ?: getApplication<Application>().filesDir
        val file = java.io.File(dir, "attendance-${_state.value.historyMonth ?: "export"}.csv")
        file.writeText(csv)
        _state.update { it.copy(historyMessage = "Saved ${file.name} in app files.") }
    }

    fun checkIn() = runAction {
        val token = vault.sessionToken ?: throw ApiException("Sign in again.")
        val place = resolvePunchPlace()
        val result = api.checkIn(
            token = token,
            requestId = UUID.randomUUID().toString(),
            latitude = place.latitude,
            longitude = place.longitude,
            accuracyMeters = place.accuracyMeters,
            addressLine = place.addressLine,
            mapsUrl = place.mapsUrl,
            streetViewUrl = place.streetViewUrl,
        )
        applyAttendance(result, keepShiftFromState = true)
        val checkInLabel = _state.value.attendance.checkInLabel ?: currentClockLabel()
        val arrivalBadge = when (_state.value.attendance.arrival) {
            "LATE" -> "Late"
            "ON_TIME", "EARLY" -> "On time"
            else -> "On time"
        }
        _state.update {
            it.copy(
                message = null,
                error = null,
                locationReady = true,
                locationAddress = place.addressLine,
                onBreak = false,
                breakStartedAtMs = null,
                breakPlannedEndMs = null,
                totalBreakMs = 0L,
                activity = listOf(ActivityItem(checkInLabel, "Checked in", arrivalBadge)),
            )
        }
    }

    fun startBreak(durationMinutes: Int, type: String, note: String) {
        val now = System.currentTimeMillis()
        val nowLabel = currentClockLabel()
        val minutes = durationMinutes.coerceIn(1, 240)
        _state.update { state ->
            if (state.attendance.status != "OPEN" || state.onBreak) return@update state
            state.copy(
                onBreak = true,
                breakStartedAtMs = now,
                breakPlannedEndMs = now + minutes * 60_000L,
                breakDurationMinutes = minutes,
                breakType = type.ifBlank { "Break" },
                breakNote = note.trim(),
                activity = state.activity + ActivityItem(nowLabel, "Break started"),
            )
        }
    }

    fun endBreak() {
        val nowLabel = currentClockLabel()
        _state.update { state ->
            if (!state.onBreak) return@update state
            val started = state.breakStartedAtMs ?: System.currentTimeMillis()
            val added = (System.currentTimeMillis() - started).coerceAtLeast(0L)
            state.copy(
                onBreak = false,
                breakStartedAtMs = null,
                breakPlannedEndMs = null,
                totalBreakMs = state.totalBreakMs + added,
                activity = state.activity + ActivityItem(nowLabel, "Back to work"),
            )
        }
    }

    /** Called from Check out confirm: may show work-list reminder before punching out. */
    fun beginCheckOut() {
        if (_state.value.busy || _state.value.checkoutGateBusy) return
        runAction {
            _state.update { it.copy(checkoutGateBusy = true, workListReminderVisible = false) }
            try {
                val token = vault.sessionToken ?: throw ApiException("Sign in again.")
                val status = try {
                    api.workListStatus(token)
                } catch (_: Exception) {
                    // Bounded timeout / unavailable: allow clock out without false reminder.
                    null
                }
                if (
                    status != null &&
                    status.optBoolean("reminderDue", false) &&
                    status.optString("status") == "PENDING"
                ) {
                    val message = status.optString("message").ifBlank {
                        AttendifyApplication.WORK_LIST_MESSAGE
                    }
                    val pmUrl = status.optString("pmWebUrl").ifBlank { null }
                        ?: _state.value.pmWebUrl
                    _state.update {
                        it.copy(
                            workListReminderVisible = true,
                            workListReminderMessage = message,
                            pmWebUrl = pmUrl ?: it.pmWebUrl,
                            checkoutGateBusy = false,
                            busy = false,
                        )
                    }
                    return@runAction
                }
                performCheckOut(token)
            } finally {
                _state.update { it.copy(checkoutGateBusy = false) }
            }
        }
    }

    fun continueCheckOutDespiteWorkList() {
        if (_state.value.busy || _state.value.checkoutGateBusy) return
        runAction {
            val token = vault.sessionToken ?: throw ApiException("Sign in again.")
            _state.update {
                it.copy(
                    workListReminderVisible = false,
                    workListReminderMessage = null,
                )
            }
            performCheckOut(token)
        }
    }

    fun dismissWorkListReminder() {
        _state.update {
            it.copy(
                workListReminderVisible = false,
                workListReminderMessage = null,
                checkoutGateBusy = false,
            )
        }
    }

    fun checkOut() = beginCheckOut()

    private suspend fun performCheckOut(token: String) {
        // Close an open break before checking out so break totals stay accurate.
        if (_state.value.onBreak) endBreak()
        val place = resolvePunchPlace()
        val result = api.checkOut(
            token = token,
            requestId = UUID.randomUUID().toString(),
            latitude = place.latitude,
            longitude = place.longitude,
            accuracyMeters = place.accuracyMeters,
            addressLine = place.addressLine,
            mapsUrl = place.mapsUrl,
            streetViewUrl = place.streetViewUrl,
        )
        applyAttendance(result, keepShiftFromState = true)
        val outLabel = _state.value.attendance.checkOutLabel ?: currentClockLabel()
        _state.update {
            it.copy(
                message = null,
                workListReminderVisible = false,
                workListReminderMessage = null,
                error = null,
                locationReady = true,
                locationAddress = place.addressLine,
                onBreak = false,
                breakStartedAtMs = null,
                breakPlannedEndMs = null,
                activity = it.activity + ActivityItem(outLabel, "Checked out"),
            )
        }
    }

    fun signOut() = runAction {
        vault.sessionToken?.let { runCatching { api.logout(it) } }
        vault.clearSession()
        deviceProof = null
        activationToken = null
        setBiometricFailCount(0)
        _state.update {
            UiState(
                phase = when {
                    vault.isRegisteredReady() -> AuthPhase.LockedFingerprint
                    else -> AuthPhase.SetupEmail
                },
                email = vault.email.orEmpty(),
                canUseBiometric = biometricAvailable(),
                fingerprintVerified = false,
                loginStep = 1,
                unlockedThisProcess = false,
                biometricFailCount = 0,
                message = null,
                error = null,
            )
        }
    }

    private suspend fun loadHome(token: String) {
        val me = api.me(token)
        val attendance = api.attendance(token)
        val shift = attendance.optJSONObject("shift")
        val record = attendance.optJSONObject("attendance")
        val workplace = shift?.optJSONObject("workplace")
        val ui = attendanceFrom(record, shift, workplace)
        val seededActivity = if (ui.status == "OPEN" || ui.status == "CLOSED") {
            buildList {
                val inLabel = ui.checkInLabel
                if (!inLabel.isNullOrBlank()) {
                    add(
                        ActivityItem(
                            timeLabel = inLabel,
                            title = "Checked in",
                            badge = when (ui.arrival) {
                                "LATE" -> "Late"
                                null, "" -> null
                                else -> "On time"
                            },
                        ),
                    )
                }
                val outLabel = ui.checkOutLabel
                if (!outLabel.isNullOrBlank()) add(ActivityItem(outLabel, "Checked out"))
            }
        } else {
            emptyList()
        }
        _state.update {
            it.copy(
                phase = AuthPhase.Home,
                firstName = me.optString("firstName", "there"),
                greeting = me.optString("greeting", "Hello"),
                email = me.optString("email", vault.email.orEmpty()),
                fullName = me.optString("fullName").ifBlank {
                    me.optJSONObject("employee")?.optString("fullName").orEmpty()
                }.ifBlank { me.optString("firstName", "there") },
                profileInitials = me.optString("initials").ifBlank { "" },
                employeeCode = me.optString("employeeCode").ifBlank {
                    me.optJSONObject("employee")?.optString("employeeCode")
                }?.ifBlank { null },
                department = me.optString("department").ifBlank {
                    me.optJSONObject("employee")?.optString("department")
                }?.ifBlank { null },
                workplaceName = me.optString("workplaceName").ifBlank { null },
                reportingManager = me.optString("reportingManager").ifBlank { null },
                isManager = me.optBoolean("isManager", me.optJSONObject("employee")?.optBoolean("isManager") == true),
                accessRole = me.optString("accessRole").ifBlank {
                    me.optJSONObject("employee")?.optString("accessRole")
                }?.ifBlank { null } ?: if (
                    me.optBoolean("isManager", me.optJSONObject("employee")?.optBoolean("isManager") == true)
                ) "MANAGER" else "EMPLOYEE",
                busy = false,
                error = null,
                message = it.message,
                fingerprintVerified = false,
                loginStep = 1,
                unlockedThisProcess = true,
                attendance = ui,
                onBreak = if (ui.status == "OPEN") it.onBreak else false,
                breakStartedAtMs = if (ui.status == "OPEN") it.breakStartedAtMs else null,
                breakPlannedEndMs = if (ui.status == "OPEN") it.breakPlannedEndMs else null,
                totalBreakMs = if (ui.status == "OPEN") it.totalBreakMs else 0L,
                activity = if (ui.status == "OPEN" && it.activity.isNotEmpty()) it.activity else seededActivity,
                locationReady = false,
                locationAddress = null,
                locationLatitude = null,
                locationLongitude = null,
                pmWebUrl = me.optString("pmWebUrl").ifBlank { it.pmWebUrl },
            )
        }
        registerFcmToken(token)
        refreshLocationStatus()
    }

    private fun registerFcmToken(sessionToken: String) {
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val task = com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                val fcmToken = suspendCancellableCoroutine<String?> { cont ->
                    task.addOnSuccessListener { cont.resume(it) }
                    task.addOnFailureListener { cont.resume(null) }
                }
                if (!fcmToken.isNullOrBlank()) {
                    api.registerPushToken(sessionToken, fcmToken)
                }
            }
        }
    }

    fun refreshLocationStatus() = runAction(showBusy = false) {
        val place = resolvePunchPlace()
        _state.update {
            it.copy(
                locationReady = true,
                locationAddress = place.addressLine,
                locationLatitude = place.latitude,
                locationLongitude = place.longitude,
                error = null,
            )
        }
    }

    fun hasLocationPermission(): Boolean {
        val context = getApplication<Application>()
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    private fun applyAttendance(record: JSONObject, keepShiftFromState: Boolean) {
        val current = _state.value.attendance
        val parsed = attendanceFrom(record, shift = null, workplace = null)
        _state.update {
            it.copy(
                attendance = if (keepShiftFromState) {
                    parsed.copy(
                        shiftName = current.shiftName ?: parsed.shiftName,
                        shiftWindow = current.shiftWindow ?: parsed.shiftWindow,
                        shiftStart = current.shiftStart ?: parsed.shiftStart,
                        shiftEnd = current.shiftEnd ?: parsed.shiftEnd,
                        workplaceName = current.workplaceName ?: parsed.workplaceName,
                    )
                } else {
                    parsed
                },
            )
        }
    }

    private fun attendanceFrom(
        record: JSONObject?,
        shift: JSONObject?,
        workplace: JSONObject?,
    ): AttendanceUi {
        if (record == null && shift == null) return AttendanceUi()
        val shiftStart = shift?.optString("shiftStart")?.ifBlank { null }
            ?: record?.optString("shiftStart")?.ifBlank { null }
        val shiftEnd = shift?.optString("shiftEnd")?.ifBlank { null }
            ?: record?.optString("shiftEnd")?.ifBlank { null }
        val window = when {
            shiftStart != null && shiftEnd != null -> "$shiftStart - $shiftEnd"
            else -> null
        }
        val checkInLocation = record?.optJSONObject("checkInLocation")
        val checkOutLocation = record?.optJSONObject("checkOutLocation")
        return AttendanceUi(
            status = record?.optString("status")?.ifBlank { null },
            shiftName = shift?.optString("shiftName")?.ifBlank { null } ?: record?.optString("shiftName")?.ifBlank { null },
            shiftWindow = window,
            shiftStart = shiftStart,
            shiftEnd = shiftEnd,
            workplaceName = workplace?.optString("name")?.ifBlank { null }
                ?: record?.optString("workplaceName")?.ifBlank { null },
            workDateLabel = shift?.optString("workDateLabel")?.ifBlank { null }
                ?: record?.optString("workDateLabel")?.ifBlank { null },
            checkInAt = record?.optString("checkInAt")?.ifBlank { null },
            checkInLabel = record?.optString("checkInLabel")?.ifBlank { null },
            checkOutLabel = record?.optString("checkOutLabel")?.takeIf { it.isNotBlank() && it != "null" },
            hoursLabel = record?.optString("hoursLabel")?.ifBlank { null },
            netMinutes = if (record?.has("netMinutes") == true) record.optInt("netMinutes") else null,
            arrival = record?.optString("arrival")?.ifBlank { null },
            checkInAddress = checkInLocation?.optString("addressLine")?.ifBlank { null },
            checkOutAddress = checkOutLocation?.optString("addressLine")?.ifBlank { null },
            checkInStreetViewUrl = checkInLocation?.optString("streetViewUrl")?.ifBlank { null },
            checkOutStreetViewUrl = checkOutLocation?.optString("streetViewUrl")?.ifBlank { null },
        )
    }

    private fun currentClockLabel(): String =
        SimpleDateFormat("hh:mm a", Locale.US).format(Date()).uppercase(Locale.US)

    private fun runAction(showBusy: Boolean = true, block: suspend () -> Unit) {
        viewModelScope.launch {
            if (showBusy) _state.update { it.copy(busy = true, error = null) }
            try {
                withContext(Dispatchers.IO) { block() }
            } catch (error: Exception) {
                val message = when (error) {
                    is DeviceKeyInvalidatedException -> error.message
                    is ApiException -> error.message
                    is ConnectException, is UnknownHostException ->
                        "Cannot reach the Attendify server. Check that the API is running."
                    is SocketTimeoutException -> "The server took too long to respond. Try again."
                    is IOException -> error.message?.takeIf { it.isNotBlank() } ?: "Network error. Try again."
                    else -> error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong."
                }
                _state.update { it.copy(error = message, busy = false) }
            } finally {
                if (showBusy) _state.update { it.copy(busy = false) }
            }
        }
    }

    private fun biometricAvailable(): Boolean =
        biometricStatusCode() == BiometricManager.BIOMETRIC_SUCCESS

    private fun biometricStatusCode(): Int {
        val manager = BiometricManager.from(getApplication())
        return manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
    }

    private suspend fun authenticateCrypto(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        signature: Signature,
    ): Signature = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { continuation ->
            val executor: Executor = ContextCompat.getMainExecutor(activity)
            val prompt = BiometricPrompt(
                activity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        val unlocked = result.cryptoObject?.signature
                        if (unlocked == null) {
                            continuation.resumeWithException(ApiException("Fingerprint succeeded, but the phone key stayed locked. Try again."))
                            return
                        }
                        continuation.resume(unlocked)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        val message = when (errorCode) {
                            BiometricPrompt.ERROR_LOCKOUT,
                            BiometricPrompt.ERROR_LOCKOUT_PERMANENT,
                            -> "Fingerprint is locked by Android. Enter your Attendify app passcode."
                            BiometricPrompt.ERROR_HW_UNAVAILABLE,
                            BiometricPrompt.ERROR_NO_BIOMETRICS,
                            BiometricPrompt.ERROR_HW_NOT_PRESENT,
                            -> "Fingerprint is not available. Enter your Attendify app passcode."
                            BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                            BiometricPrompt.ERROR_USER_CANCELED,
                            BiometricPrompt.ERROR_CANCELED,
                            -> "Fingerprint cancelled."
                            else -> errString.toString()
                        }
                        continuation.resumeWithException(ApiException(message))
                    }

                    override fun onAuthenticationFailed() {
                        // Keep the prompt open for another attempt.
                    }
                },
            )
            prompt.authenticate(
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText("Cancel")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setConfirmationRequired(true)
                    .build(),
                BiometricPrompt.CryptoObject(signature),
            )
            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
        }
    }

    /** Returns null when the flow should stop (cancelled or switched to passcode). */
    private suspend fun authenticateCryptoForUnlock(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        signature: Signature,
    ): Signature? = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { continuation ->
            val executor: Executor = ContextCompat.getMainExecutor(activity)
            lateinit var prompt: BiometricPrompt
            prompt = BiometricPrompt(
                activity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        val unlocked = result.cryptoObject?.signature
                        if (unlocked == null) {
                            continuation.resumeWithException(ApiException("Fingerprint succeeded, but the phone key stayed locked. Try again."))
                            return
                        }
                        setBiometricFailCount(0)
                        continuation.resume(unlocked)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        when (errorCode) {
                            BiometricPrompt.ERROR_LOCKOUT,
                            BiometricPrompt.ERROR_LOCKOUT_PERMANENT,
                            BiometricPrompt.ERROR_HW_UNAVAILABLE,
                            BiometricPrompt.ERROR_NO_BIOMETRICS,
                            BiometricPrompt.ERROR_HW_NOT_PRESENT,
                            -> {
                                _state.update {
                                    it.copy(
                                        phase = AuthPhase.LockedPasscode,
                                        busy = false,
                                        message = "Use your Attendify app passcode.",
                                        error = null,
                                    )
                                }
                                continuation.resume(null)
                            }
                            BiometricPrompt.ERROR_NEGATIVE_BUTTON -> {
                                _state.update {
                                    it.copy(
                                        phase = AuthPhase.LockedPasscode,
                                        busy = false,
                                        message = "Enter your Attendify app passcode.",
                                        error = null,
                                    )
                                }
                                continuation.resume(null)
                            }
                            BiometricPrompt.ERROR_USER_CANCELED,
                            BiometricPrompt.ERROR_CANCELED,
                            -> {
                                _state.update {
                                    it.copy(
                                        phase = AuthPhase.LockedFingerprint,
                                        busy = false,
                                        error = "App stays locked until fingerprint or passcode succeeds.",
                                    )
                                }
                                continuation.resume(null)
                            }
                            else -> continuation.resumeWithException(ApiException(errString.toString()))
                        }
                    }

                    override fun onAuthenticationFailed() {
                        val next = _state.value.biometricFailCount + 1
                        setBiometricFailCount(next)
                        if (next >= 3) {
                            prompt.cancelAuthentication()
                            _state.update {
                                it.copy(
                                    phase = AuthPhase.LockedPasscode,
                                    busy = false,
                                    message = "Too many fingerprint mismatches. Enter your app passcode.",
                                    error = null,
                                )
                            }
                            if (continuation.isActive) continuation.resume(null)
                        }
                    }
                },
            )
            prompt.authenticate(
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText("Use passcode")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setConfirmationRequired(true)
                    .build(),
                BiometricPrompt.CryptoObject(signature),
            )
            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
        }
    }

    private fun localActivationNonce(): String {
        // Local proof only: confirms the biometric-bound key can sign after fingerprint unlock.
        return Base64Url.encode("attendify-activate-${System.currentTimeMillis()}".toByteArray())
    }

    private suspend fun resolvePunchPlace(): PunchPlace {
        val coords = currentCoordinates()
        if (coords.third > 100f) {
            throw ApiException("The location is not accurate enough. Move near a window or outdoors and try again.")
        }
        val addressLine = reverseGeocode(coords.first, coords.second)
        val mapsUrl = "https://www.google.com/maps?q=${coords.first},${coords.second}"
        val streetViewUrl =
            "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coords.first},${coords.second}"
        return PunchPlace(
            latitude = coords.first,
            longitude = coords.second,
            accuracyMeters = coords.third,
            addressLine = addressLine,
            mapsUrl = mapsUrl,
            streetViewUrl = streetViewUrl,
        )
    }

    private suspend fun currentCoordinates(): Triple<Double, Double, Float> {
        val context = getApplication<Application>()
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) throw ApiException("Allow location access to check in.")
        val client = LocationServices.getFusedLocationProviderClient(context)
        val priority = if (fine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val fresh = try {
            suspendCancellableCoroutine<android.location.Location?> { continuation ->
                val source = CancellationTokenSource()
                client.getCurrentLocation(priority, source.token)
                    .addOnSuccessListener { location -> continuation.resume(location) }
                    .addOnFailureListener { continuation.resume(null) }
                continuation.invokeOnCancellation { source.cancel() }
            }
        } catch (_: SecurityException) {
            throw ApiException("Allow location access to check in.")
        }
        if (fresh != null) {
            return Triple(fresh.latitude, fresh.longitude, fresh.accuracy)
        }
        val last = try {
            suspendCancellableCoroutine<android.location.Location?> { continuation ->
                client.lastLocation
                    .addOnSuccessListener { location -> continuation.resume(location) }
                    .addOnFailureListener { continuation.resume(null) }
            }
        } catch (_: SecurityException) {
            throw ApiException("Allow location access to check in.")
        }
        if (last != null) {
            return Triple(last.latitude, last.longitude, last.accuracy.coerceAtLeast(1f))
        }
        throw ApiException("Could not read your location. Turn on GPS and try again near a window.")
    }

    private fun reverseGeocode(latitude: Double, longitude: Double): String {
        val context = getApplication<Application>()
        if (!Geocoder.isPresent()) {
            throw ApiException("Street address lookup is not available on this phone.")
        }
        return try {
            val geocoder = Geocoder(context, Locale.getDefault())
            @Suppress("DEPRECATION")
            val results = geocoder.getFromLocation(latitude, longitude, 1)
            val address = results?.firstOrNull()
                ?: throw ApiException("Could not resolve a full street address for this location.")
            val parts = listOfNotNull(
                address.getAddressLine(0),
                address.locality,
                address.adminArea,
                address.postalCode,
                address.countryName,
            ).map { it.trim() }.filter { it.isNotEmpty() }.distinct()
            val line = parts.joinToString(", ")
            if (line.length < 8) {
                throw ApiException("Could not resolve a full street address for this location.")
            }
            line
        } catch (error: ApiException) {
            throw error
        } catch (error: Exception) {
            throw ApiException(error.message ?: "Could not resolve a full street address for this location.")
        }
    }

    companion object {
        private const val KEY_BIO_FAIL = "biometric_fail_count"

        fun factory(context: Context): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                return AttendifyViewModel(
                    application = context.applicationContext as Application,
                    savedState = extras.createSavedStateHandle(),
                ) as T
            }
        }
    }
}

private object Base64Url {
    fun encode(bytes: ByteArray): String {
        return android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)
    }
}
