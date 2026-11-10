package com.attendify.employee.data

import com.attendify.employee.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiException(message: String, val statusCode: Int? = null) : Exception(message)

class AttendifyApi(
    private val baseUrl: String = BuildConfig.API_BASE,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    fun requestOtp(
        email: String,
        purpose: String,
        deviceProof: String? = null,
        deviceId: String? = null,
    ): String? {
        val body = JSONObject().put("email", email).put("purpose", purpose)
        if (deviceProof != null) body.put("deviceProof", deviceProof)
        if (deviceId != null) body.put("deviceId", deviceId)
        val response = post("/auth/otp/request", body)
        return response.optString("devCode").ifBlank { null }
    }

    fun verifyOtp(
        email: String,
        purpose: String,
        code: String,
        deviceProof: String? = null,
        deviceId: String? = null,
    ): JSONObject {
        val body = JSONObject()
            .put("email", email)
            .put("purpose", purpose)
            .put("code", code)
        if (deviceProof != null) body.put("deviceProof", deviceProof)
        if (deviceId != null) body.put("deviceId", deviceId)
        return post("/auth/otp/verify", body)
    }

    fun registerDevice(activationToken: String, publicKeySpki: String, label: String, biometricBound: Boolean): String {
        val body = JSONObject()
            .put("publicKeySpki", publicKeySpki)
            .put("label", label)
            .put("biometricBound", biometricBound)
        return post("/auth/devices/register", body, activationToken).getString("deviceId")
    }

    fun completeActivation(activationToken: String, deviceId: String): JSONObject {
        return post(
            "/auth/activation/complete",
            JSONObject().put("deviceId", deviceId),
            activationToken,
        )
    }

    fun finalizeSetup(activationToken: String, deviceId: String): JSONObject {
        return post(
            "/auth/setup/finalize",
            JSONObject().put("deviceId", deviceId),
            activationToken,
        )
    }

    fun unlockBiometric(deviceProof: String): JSONObject {
        return post("/auth/unlock/biometric", JSONObject().put("deviceProof", deviceProof))
    }

    fun unlockPasscode(deviceId: String, passcode: String): JSONObject {
        return post(
            "/auth/unlock/passcode",
            JSONObject().put("deviceId", deviceId).put("passcode", passcode),
        )
    }

    fun changePasscode(token: String, currentPasscode: String, newPasscode: String): JSONObject {
        return post(
            "/auth/passcode/change",
            JSONObject()
                .put("currentPasscode", currentPasscode)
                .put("newPasscode", newPasscode),
            token,
        )
    }

    fun requestPasscodeReset(email: String, deviceId: String): String? {
        val response = post(
            "/auth/passcode/forgot/request",
            JSONObject().put("email", email).put("deviceId", deviceId),
        )
        return response.optString("devCode").ifBlank { null }
    }

    fun verifyPasscodeReset(email: String, deviceId: String, code: String): JSONObject {
        return post(
            "/auth/passcode/forgot/verify",
            JSONObject()
                .put("email", email)
                .put("deviceId", deviceId)
                .put("code", code),
        )
    }

    fun deviceStatus(deviceId: String, email: String): JSONObject {
        val encodedEmail = java.net.URLEncoder.encode(email, Charsets.UTF_8.name())
        return get("/auth/device/status?deviceId=$deviceId&email=$encodedEmail")
    }

    fun createDeviceChallenge(deviceId: String, email: String): JSONObject {
        return post(
            "/auth/device/challenge",
            JSONObject().put("deviceId", deviceId).put("email", email),
        )
    }

    fun verifyDeviceChallenge(challengeId: String, signature: String): String {
        return post(
            "/auth/device/verify",
            JSONObject().put("challengeId", challengeId).put("signature", signature),
        ).getString("deviceProof")
    }

    fun me(token: String): JSONObject = get("/me", token)

    fun attendance(token: String): JSONObject = get("/me/attendance", token)

    fun shiftRoster(token: String, weekStart: String?): JSONObject {
        val query = if (weekStart.isNullOrBlank()) "" else "?weekStart=$weekStart"
        return get("/me/shift/roster$query", token)
    }

    fun attendanceHistory(token: String, month: String): JSONObject =
        get("/me/attendance/history?month=$month", token)

    fun listRequests(token: String): JSONObject = get("/me/requests", token)

    fun createLeaveRequest(
        token: String,
        leaveType: String,
        startDate: String,
        endDate: String,
        duration: String,
        reason: String?,
        attachmentName: String?,
    ): JSONObject {
        val body = JSONObject()
            .put("leaveType", leaveType)
            .put("startDate", startDate)
            .put("endDate", endDate)
            .put("duration", duration)
        if (reason != null) body.put("reason", reason)
        if (attachmentName != null) body.put("attachmentName", attachmentName)
        return post("/me/requests/leave", body, token)
    }

    fun listTeamRequests(token: String): JSONObject = get("/me/team/requests", token)

    fun reviewTeamRequest(
        token: String,
        requestId: String,
        decision: String,
        reviewNote: String?,
    ): JSONObject {
        val body = JSONObject().put("decision", decision)
        if (reviewNote != null) body.put("reviewNote", reviewNote)
        return post("/me/team/requests/$requestId/review", body, token)
    }

    fun checkIn(
        token: String,
        requestId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        addressLine: String,
        mapsUrl: String,
        streetViewUrl: String,
    ): JSONObject {
        return post(
            "/attendance/check-in",
            punchBody(requestId, latitude, longitude, accuracyMeters, addressLine, mapsUrl, streetViewUrl),
            token,
        )
    }

    fun checkOut(
        token: String,
        requestId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        addressLine: String,
        mapsUrl: String,
        streetViewUrl: String,
    ): JSONObject {
        return post(
            "/attendance/check-out",
            punchBody(requestId, latitude, longitude, accuracyMeters, addressLine, mapsUrl, streetViewUrl),
            token,
        )
    }

    fun workListStatus(token: String): JSONObject = get("/me/work-list/status", token)

    fun registerPushToken(token: String, fcmToken: String): JSONObject {
        return post("/me/devices/push-token", JSONObject().put("token", fcmToken), token)
    }

    fun logout(token: String) {
        post("/auth/logout", JSONObject(), token)
    }

    private fun punchBody(
        requestId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        addressLine: String,
        mapsUrl: String,
        streetViewUrl: String,
    ): JSONObject {
        return JSONObject()
            .put("requestId", requestId)
            .put("latitude", latitude)
            .put("longitude", longitude)
            .put("accuracyMeters", accuracyMeters.toDouble())
            .put("addressLine", addressLine)
            .put("mapsUrl", mapsUrl)
            .put("streetViewUrl", streetViewUrl)
    }

    private fun get(path: String, token: String? = null): JSONObject {
        val builder = Request.Builder().url(baseUrl + path).get()
        if (token != null) builder.header("Authorization", "Bearer $token")
        return execute(builder.build())
    }

    private fun post(path: String, body: JSONObject, token: String? = null): JSONObject {
        val builder = Request.Builder()
            .url(baseUrl + path)
            .post(body.toString().toRequestBody(jsonMedia))
        if (token != null) builder.header("Authorization", "Bearer $token")
        return execute(builder.build())
    }

    private fun execute(request: Request): JSONObject {
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!response.isSuccessful) {
                throw ApiException(
                    json.optString("message", "The request could not be completed."),
                    statusCode = response.code,
                )
            }
            return json
        }
    }
}
