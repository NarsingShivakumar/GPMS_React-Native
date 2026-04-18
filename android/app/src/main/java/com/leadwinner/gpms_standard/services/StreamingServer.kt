package com.leadwinner.gpms_standard.services

import android.util.Base64
import android.util.Log
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

class StreamingServer(port: Int) : WebSocketServer(InetSocketAddress(port)) {

    companion object {
        private const val TAG = "StreamingServer"
        const val DEFAULT_PORT = 8765
    }

    private val clients = CopyOnWriteArrayList<WebSocket>()
    private val isRunning = AtomicBoolean(false)

    var onControlCommand: ((JSONObject) -> Unit)? = null
    var onClientConnected: ((String) -> Unit)? = null
    var onClientDisconnected: ((String) -> Unit)? = null
    var onServerStarted: (() -> Unit)? = null
    var onServerError: ((Exception) -> Unit)? = null

    private var screenWidth: Int = 0
    private var screenHeight: Int = 0
    private var deviceName: String = ""

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        clients.add(conn)
        val remoteAddr = conn.remoteSocketAddress?.address?.hostAddress ?: "unknown"
        Log.d(TAG, "Client connected: $remoteAddr. Total: ${clients.size}")
        onClientConnected?.invoke(remoteAddr)

        // Send device info to newly connected client
        if (screenWidth > 0 && screenHeight > 0) {
            try {
                val hello = JSONObject().apply {
                    put("type", "hello")
                    put("width", screenWidth)
                    put("height", screenHeight)
                    put("deviceName", deviceName)
                }
                conn.send(hello.toString())
            } catch (e: Exception) {
                Log.e(TAG, "Error sending hello", e)
            }
        }
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        clients.remove(conn)
        val remoteAddr = conn.remoteSocketAddress?.address?.hostAddress ?: "unknown"
        Log.d(TAG, "Client disconnected: $remoteAddr. Remaining: ${clients.size}")
        onClientDisconnected?.invoke(remoteAddr)
    }

    override fun onMessage(conn: WebSocket, message: String) {
        try {
            val json = JSONObject(message)
            onControlCommand?.invoke(json)
        } catch (e: Exception) {
            Log.e(TAG, "Invalid message: $message", e)
        }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        Log.e(TAG, "WebSocket error: ${ex.message}", ex)
        if (conn == null) {
            onServerError?.invoke(ex)
        }
    }

    override fun onStart() {
        isRunning.set(true)
        connectionLostTimeout = 60
        Log.d(TAG, "WebSocket server started on port ${port}")
        onServerStarted?.invoke()
    }

    fun setDeviceInfo(width: Int, height: Int, name: String) {
        screenWidth = width
        screenHeight = height
        deviceName = name
    }

    fun broadcastFrame(jpegBytes: ByteArray) {
        if (clients.isEmpty() || !isRunning.get()) return
        try {
            val base64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
            val message = JSONObject().apply {
                put("type", "frame")
                put("data", base64)
                put("ts", System.currentTimeMillis())
                put("w", screenWidth)
                put("h", screenHeight)
            }.toString()
            broadcast(message)
        } catch (e: Exception) {
            Log.e(TAG, "Broadcast error", e)
        }
    }

    fun broadcastSystemMessage(type: String, payload: JSONObject? = null) {
        try {
            val msg = JSONObject().apply {
                put("type", type)
                payload?.keys()?.forEach { key -> put(key, payload.get(key)) }
            }
            broadcast(msg.toString())
        } catch (e: Exception) {
            Log.e(TAG, "System message broadcast error", e)
        }
    }

    fun getClientCount() = clients.size

    fun isServerRunning() = isRunning.get()

    fun stopServer() {
        isRunning.set(false)
        try {
            stop(1000)
            Log.d(TAG, "Server stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping server", e)
        }
    }
}
