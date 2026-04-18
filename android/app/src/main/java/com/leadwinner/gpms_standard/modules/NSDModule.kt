package com.leadwinner.gpms_standard.modules

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.ConcurrentHashMap

class NSDModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val TAG = "NSDModule"
        const val MODULE_NAME = "NSDModule"
        const val SERVICE_TYPE = "_medimirror._tcp."
        const val TXT_SHARE_CODE = "shareCode"
        const val TXT_VERSION = "version"
        const val APP_VERSION = "1"
    }

    private val nsdManager: NsdManager by lazy {
        reactContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    }

    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private var isResolving = false
    private val discoveredDevices = ConcurrentHashMap<String, WritableMap>()
    private var isDiscovering = false

    override fun getName() = MODULE_NAME

    @ReactMethod
    fun registerService(serviceName: String, port: Int, shareCode: String, promise: Promise) {
        try {
            unregisterService(null) // Clean up previous

            val serviceInfo = NsdServiceInfo().apply {
                this.serviceName = "MediMirror_${serviceName}"
                serviceType = SERVICE_TYPE
                this.port = port
                // Note: setAttribute is API 21+
                try {
                    setAttribute(TXT_SHARE_CODE, shareCode)
                    setAttribute(TXT_VERSION, APP_VERSION)
                } catch (e: Exception) {
                    Log.w(TAG, "Could not set TXT attributes: ${e.message}")
                }
            }

            registrationListener = object : NsdManager.RegistrationListener {
                override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                    Log.e(TAG, "NSD registration failed: $errorCode")
                    promise.reject("NSD_REG_FAILED", "Registration failed: $errorCode")
                }

                override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                    Log.e(TAG, "NSD unregistration failed: $errorCode")
                }

                override fun onServiceRegistered(info: NsdServiceInfo) {
                    Log.d(TAG, "NSD service registered: ${info.serviceName}")
                    promise.resolve(info.serviceName)
                }

                override fun onServiceUnregistered(info: NsdServiceInfo) {
                    Log.d(TAG, "NSD service unregistered: ${info.serviceName}")
                }
            }

            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
        } catch (e: Exception) {
            Log.e(TAG, "Error registering NSD service", e)
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun unregisterService(promise: Promise?) {
        registrationListener?.let {
            try {
                nsdManager.unregisterService(it)
            } catch (e: Exception) {
                Log.w(TAG, "Error unregistering NSD service", e)
            }
            registrationListener = null
        }
        promise?.resolve(null)
    }

    @ReactMethod
    fun startDiscovery(promise: Promise) {
        if (isDiscovering) {
            promise.resolve(null)
            return
        }

        discoveredDevices.clear()
        isDiscovering = true

        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                Log.d(TAG, "NSD discovery started for $serviceType")
                promise.resolve(null)
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "NSD service found: ${serviceInfo.serviceName}")
                if (serviceInfo.serviceType.contains("medimirror", ignoreCase = true) ||
                    serviceInfo.serviceName.contains("MediMirror", ignoreCase = true)) {
                    resolveDevice(serviceInfo)
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "NSD service lost: ${serviceInfo.serviceName}")
                val key = serviceInfo.serviceName
                discoveredDevices.remove(key)

                val lostDevice = WritableNativeMap().apply {
                    putString("serviceName", serviceInfo.serviceName)
                }
                sendEvent("onDeviceLost", lostDevice)
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "NSD discovery stopped")
                isDiscovering = false
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "NSD discovery start failed: $errorCode")
                isDiscovering = false
                promise.reject("DISCOVERY_FAILED", "Discovery start failed: $errorCode")
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "NSD discovery stop failed: $errorCode")
                isDiscovering = false
            }
        }

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        } catch (e: Exception) {
            isDiscovering = false
            Log.e(TAG, "Error starting discovery", e)
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopDiscovery(promise: Promise) {
        discoveryListener?.let {
            try {
                nsdManager.stopServiceDiscovery(it)
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping NSD discovery", e)
            }
            discoveryListener = null
        }
        isDiscovering = false
        discoveredDevices.clear()
        promise?.resolve(null)
    }

    @ReactMethod
    fun getDiscoveredDevices(promise: Promise) {
        val devices = WritableNativeArray()
        discoveredDevices.values.forEach { device ->
            devices.pushMap(device)
        }
        promise.resolve(devices)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun resolveDevice(serviceInfo: NsdServiceInfo) {
        synchronized(resolveQueue) {
            if (isResolving) {
                resolveQueue.add(serviceInfo)
                return
            }
            isResolving = true
        }
        doResolve(serviceInfo)
    }

    private fun doResolve(serviceInfo: NsdServiceInfo) {
        try {
            nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                    Log.e(TAG, "Resolve failed for ${info.serviceName}: $errorCode")
                    resolveNext()
                }

                override fun onServiceResolved(info: NsdServiceInfo) {
                    Log.d(TAG, "Service resolved: ${info.serviceName} @ ${info.host?.hostAddress}:${info.port}")

                    val ipAddress = info.host?.hostAddress ?: "unknown"
                    val shareCode = try {
                        info.attributes[TXT_SHARE_CODE]?.let { String(it) } ?: extractCodeFromName(info.serviceName)
                    } catch (e: Exception) {
                        extractCodeFromName(info.serviceName)
                    }

                    val device = WritableNativeMap().apply {
                        putString("serviceName", info.serviceName)
                        putString("host", ipAddress)
                        putInt("port", info.port)
                        putString("shareCode", shareCode)
                        putString("displayName", info.serviceName.replace("MediMirror_", ""))
                        putDouble("discoveredAt", System.currentTimeMillis().toDouble())
                    }

                    discoveredDevices[info.serviceName] = device
                    sendEvent("onDeviceFound", device)
                    resolveNext()
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error resolving service", e)
            resolveNext()
        }
    }

    private fun resolveNext() {
        synchronized(resolveQueue) {
            val next = resolveQueue.removeFirstOrNull()
            if (next != null) {
                doResolve(next)
            } else {
                isResolving = false
            }
        }
    }

    private fun extractCodeFromName(serviceName: String): String {
        // MediMirror_ABCD12 -> ABCD12
        return serviceName.substringAfterLast("_", "")
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (e: Exception) {
            Log.e(TAG, "Error sending event $eventName", e)
        }
    }
}
