package com.leadwinner.gpms_standard.modules

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.leadwinner.gpms_standard.services.MirrorAccessibilityService
import com.leadwinner.gpms_standard.services.ScreenCaptureService
import java.net.NetworkInterface
import java.util.Collections
import kotlin.math.abs
import kotlin.random.Random

class MirrorModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val TAG                    = "MirrorModule"
        const val MODULE_NAME            = "MirrorModule"
        const val REQUEST_MEDIA_PROJECTION = 1001
        const val SERVER_PORT            = 8765

        // In-process MediaProjection token storage (avoids Android 10+ IPC invalidation)
        @Volatile var pendingResultCode: Int     = -1
        @Volatile var pendingResultData: Intent? = null
    }

    private var pendingPromise: Promise? = null
    private var shareCode: String = ""

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?
        ) {
            if (requestCode == REQUEST_MEDIA_PROJECTION) {
                if (resultCode == Activity.RESULT_OK && data != null) {
                    pendingResultCode = resultCode
                    pendingResultData = data
                    launchCaptureService()
                } else {
                    pendingPromise?.reject("PERMISSION_DENIED", "Screen capture permission denied")
                    pendingPromise = null
                }
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
        startEventPolling()
    }

    override fun getName() = MODULE_NAME

    // ── React Methods ─────────────────────────────────────────────────────

    @ReactMethod
    fun startScreenCapture(promise: Promise) {
        val activity = reactApplicationContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "No activity available")
            return
        }

        // FIX #1 & #2: ScreenCaptureService.isRunning() now exists as a companion fun
        if (ScreenCaptureService.isRunning()) {
            promise.reject("ALREADY_RUNNING", "Screen capture is already running")
            return
        }

        shareCode      = generateShareCode()
        pendingPromise = promise

        try {
            val mgr = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                    as MediaProjectionManager
            activity.startActivityForResult(
                mgr.createScreenCaptureIntent(),
                REQUEST_MEDIA_PROJECTION
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error requesting screen capture permission", e)
            pendingPromise?.reject("ERROR", e.message)
            pendingPromise = null
        }
    }

    @ReactMethod
    fun stopScreenCapture(promise: Promise) {
        try {
            reactApplicationContext.stopService(
                Intent(reactApplicationContext, ScreenCaptureService::class.java).apply {
                    action = ScreenCaptureService.ACTION_STOP
                }
            )
            pendingResultCode = -1
            pendingResultData = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getCaptureInfo(promise: Promise) {
        promise.resolve(WritableNativeMap().apply {
            // FIX #1: isRunning() now resolves correctly
            putBoolean("isRunning",            ScreenCaptureService.isRunning())
            putString("shareCode",             shareCode)
            putString("ipAddress",             getLocalIpAddress())
            putInt("port",                     SERVER_PORT)
            putBoolean("accessibilityEnabled", MirrorAccessibilityService.isEnabled())
        })
    }

    @ReactMethod fun getLocalIp(promise: Promise)  = promise.resolve(getLocalIpAddress())

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) =
        promise.resolve(MirrorAccessibilityService.isEnabled())

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            reactApplicationContext.startActivity(
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
            promise.resolve(null)
        } catch (e: Exception) { promise.reject("ERROR", e.message) }
    }

    @ReactMethod fun getServerPort(promise: Promise)      = promise.resolve(SERVER_PORT)
    @ReactMethod fun addListener(eventName: String)       {}
    @ReactMethod fun removeListeners(count: Int)          {}

    // ── Internal helpers ──────────────────────────────────────────────────

    private fun launchCaptureService() {
        val ip = getLocalIpAddress()

        val intent = Intent(reactApplicationContext, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_START
            putExtra(ScreenCaptureService.EXTRA_SHARE_CODE, shareCode)
            putExtra(ScreenCaptureService.EXTRA_PORT, SERVER_PORT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactApplicationContext.startForegroundService(intent)
        } else {
            reactApplicationContext.startService(intent)
        }

        val qrData = "medimirror://$ip:$SERVER_PORT?code=$shareCode"

        pendingPromise?.resolve(WritableNativeMap().apply {
            putString("shareCode",        shareCode)
            putString("ipAddress",        ip)
            putInt("port",                SERVER_PORT)
            putString("connectionString", "$ip:$SERVER_PORT")
            putString("qrData",           qrData)
        })
        pendingPromise = null

        sendEvent("onCaptureStarted", WritableNativeMap().apply {
            putString("shareCode",        shareCode)
            putString("ipAddress",        ip)
            putInt("port",                SERVER_PORT)
            putString("connectionString", "$ip:$SERVER_PORT")
            putString("qrData",           qrData)
        })
    }

    private fun generateShareCode(): String {
        val chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return (1..6).map { chars[abs(Random.nextInt()) % chars.length] }.joinToString("")
    }

    private fun getLocalIpAddress(): String {
        try {
            @Suppress("DEPRECATION")
            val wm = reactApplicationContext.applicationContext
                .getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            val ipInt = wm.connectionInfo.ipAddress
            if (ipInt != 0) return String.format(
                "%d.%d.%d.%d",
                ipInt and 0xff, ipInt shr 8 and 0xff,
                ipInt shr 16 and 0xff, ipInt shr 24 and 0xff
            )
        } catch (e: Exception) { Log.w(TAG, "WiFi IP unavailable", e) }
        try {
            Collections.list(NetworkInterface.getNetworkInterfaces()).forEach { intf ->
                if (intf.isLoopback || !intf.isUp) return@forEach
                Collections.list(intf.inetAddresses).forEach { addr ->
                    if (!addr.isLoopbackAddress && addr.hostAddress?.contains(':') == false)
                        return addr.hostAddress ?: "0.0.0.0"
                }
            }
        } catch (e: Exception) { Log.e(TAG, "Error getting IP", e) }
        return "0.0.0.0"
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (e: Exception) { Log.e(TAG, "Error sending event $eventName", e) }
    }

    private fun sendStringEvent(eventName: String, data: String) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, data)
        } catch (e: Exception) { Log.e(TAG, "Error sending event $eventName", e) }
    }

    // ── Event polling ─────────────────────────────────────────────────────
    // ScreenCaptureService runs on a background thread and cannot safely call
    // into ReactContext directly. It instead enqueues events in the companion
    // pendingEvents list; this daemon thread drains it every 500 ms.

    private fun startEventPolling() {
        Thread {
            while (true) {
                try {
                    Thread.sleep(500)

                    // FIX #3 & #4: ScreenCaptureService.pendingEvents now exists
                    // as a companion CopyOnWriteArrayList<Pair<String,String>>
                    val snapshot = ScreenCaptureService.pendingEvents.toList()
                    ScreenCaptureService.pendingEvents.removeAll(snapshot.toSet())

                    snapshot.forEach { (event, data) ->
                        sendStringEvent(event, data)
                    }
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    Log.e(TAG, "Event polling error", e)
                }
            }
        }.apply { isDaemon = true; start() }
    }
}