package com.attendify.employee.data

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

class DeviceVault(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "attendify_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var sessionToken: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) {
            prefs.edit().putString(KEY_TOKEN, value).apply()
        }

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) {
            prefs.edit().putString(KEY_DEVICE_ID, value).apply()
        }

    var email: String?
        get() = prefs.getString(KEY_EMAIL, null)
        set(value) {
            prefs.edit().putString(KEY_EMAIL, value).apply()
        }

    var biometricBound: Boolean
        get() = prefs.getBoolean(KEY_BIOMETRIC, false)
        set(value) {
            prefs.edit().putBoolean(KEY_BIOMETRIC, value).apply()
        }

    var setupReady: Boolean
        get() = prefs.getBoolean(KEY_SETUP_READY, false)
        set(value) {
            prefs.edit().putBoolean(KEY_SETUP_READY, value).apply()
        }

    fun clearSession() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    fun isRegisteredReady(): Boolean =
        !deviceId.isNullOrBlank() && hasDeviceKey() && biometricBound && setupReady

    fun clearAll() {
        prefs.edit().clear().apply()
        deleteKey()
    }

    fun hasDeviceKey(): Boolean {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        return keyStore.containsAlias(KEY_ALIAS)
    }

    /** Creates a new device key. Biometric-bound keys require a fingerprint for every CryptoObject use. */
    fun createDeviceKey(requireUserAuth: Boolean): String {
        deleteKey()
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(requireUserAuth)
            .setInvalidatedByBiometricEnrollment(true)

        if (requireUserAuth) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            }
            // No validity window: signing only works through BiometricPrompt CryptoObject.
        }

        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
            .apply { initialize(builder.build()) }
            .generateKeyPair()

        return publicKeySpki()
    }

    fun publicKeySpki(): String {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val publicKey = keyStore.getCertificate(KEY_ALIAS)?.publicKey as? ECPublicKey
            ?: error("Device key is missing")
        return Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
    }

    /**
     * Prepares a Signature for BiometricPrompt.CryptoObject.
     * After a successful fingerprint, call [signNonce] with the unlocked Signature.
     */
    fun prepareCryptoSignature(): Signature {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as? PrivateKey
            ?: error("Device key is missing")
        val signature = Signature.getInstance(SIGNATURE_ALGORITHM)
        try {
            signature.initSign(privateKey)
        } catch (error: KeyPermanentlyInvalidatedException) {
            throw DeviceKeyInvalidatedException()
        }
        return signature
    }

    fun signNonce(signature: Signature, nonceBase64Url: String): String {
        val payload = Base64.decode(nonceBase64Url, Base64.URL_SAFE or Base64.NO_WRAP)
        signature.update(payload)
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    /** Used only when the phone has no strong biometric hardware. */
    fun signNonceWithoutBiometric(nonceBase64Url: String): String {
        if (biometricBound) {
            error("This phone key requires fingerprint verification.")
        }
        val signature = prepareCryptoSignature()
        return signNonce(signature, nonceBase64Url)
    }

    private fun deleteKey() {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "attendify_device_key_v2"
        private const val SIGNATURE_ALGORITHM = "SHA256withECDSA"
        private const val KEY_TOKEN = "token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_EMAIL = "email"
        private const val KEY_BIOMETRIC = "biometric"
        private const val KEY_SETUP_READY = "setup_ready"
    }
}

class DeviceKeyInvalidatedException :
    Exception("Fingerprint settings changed on this phone. Ask HR to reset the device, then activate again.")
