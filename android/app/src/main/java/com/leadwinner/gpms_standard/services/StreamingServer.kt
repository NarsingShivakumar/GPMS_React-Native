package com.leadwinner.gpms_standard.services

import android.util.Base64
import android.util.Log
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * WebSocket server on the HOST device.
 *
 * SERVER → CLIENT:
 *   { type:"hello",          width, height, deviceName }   ← sent immediately on connect
 *   { type:"connecting_ack"                             }   ← after client sends "ready"
 *   { type:"frame",          data, ts, w, h             }   ← JPEG stream frames
 *   { type:"pong",           ts                         }   ← reply to client ping
 *   { type:"server_ping",    ts                         }   ← proactive health check
 *
 * CLIENT → SERVER:
 *   { type:"ping",      ts }
 *   { type:"ready"         }   ← client finished loading, ready to receive stream
 *   { type:"touch",     action, x, y [,duration] }
 *   { type:"swipe",     startX, startY, endX, endY, duration }
 *   { type:"longpress", x, y }
 *   { type:"pinch",     cx, cy, scale, duration }
 *   { type:"key",       action }
 *   { type:"client_pong", ts }
 */
class StreamingServer(port: Int) : WebSocketServer(InetSocketAddress(port)) {

    companion object {
        private const val TAG              = "StreamingServer"
        const val DEFAULT_PORT             = 8765
        private const val PING_TIMEOUT_MS  = 15_000L
        private const val PING_INTERVAL_MS = 5_000L
    }

    private val clients   = CopyOnWriteArrayList<WebSocket>()
    private val isRunning = AtomicBoolean(false)
    private val lastSeen  = HashMap<WebSocket, Long>()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var pingJob: ScheduledFuture<*>? = null

    // ── Callbacks ─────────────────────────────────────────────────────────
    var onControlCommand:     ((JSONObject) -> Unit)? = null
    var onClientConnected:    ((String) -> Unit)?     = null
    var onClientDisconnected: ((String) -> Unit)?     = null
    var onClientAcknowledged: ((String) -> Unit)?     = null
    var onServerStarted:      (() -> Unit)?           = null
    var onServerError:        ((Exception) -> Unit)?  = null

    // ── Screen info ───────────────────────────────────────────────────────
    private var screenWidth  = 0
    private var screenHeight = 0
    private var deviceName   = ""

    // ── Frame buffer ──────────────────────────────────────────────────────
    // Caches the last valid JPEG so a newly-connected viewer gets an
    // immediate frame instead of a black screen while waiting for the
    // next capture tick.
    @Volatile private var lastValidFrame: ByteArray? = null

    // ── WebSocketServer overrides ─────────────────────────────────────────

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        clients.add(conn)
        lastSeen[conn] = System.currentTimeMillis()
        val addr = conn.remoteSocketAddress?.address?.hostAddress ?: "unknown"
        Log.d(TAG, "Client connected: $addr (total ${clients.size})")

        // Send screen dimensions immediately — viewer needs these to
        // render the correct aspect ratio before the first frame arrives.
        if (screenWidth > 0 && screenHeight > 0) {
            runCatching {
                conn.send(JSONObject().apply {
                    put("type",       "hello")
                    put("width",      screenWidth)
                    put("height",     screenHeight)
                    put("deviceName", deviceName)
                }.toString())
            }
        }
        onClientConnected?.invoke(addr)
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        clients.remove(conn)
        lastSeen.remove(conn)
        val addr = conn.remoteSocketAddress?.address?.hostAddress ?: "unknown"
        Log.d(TAG, "Client disconnected: $addr (remaining ${clients.size})")
        onClientDisconnected?.invoke(addr)
    }

    override fun onMessage(conn: WebSocket, message: String) {
        runCatching {
            val json = JSONObject(message)
            lastSeen[conn] = System.currentTimeMillis()

            when (json.optString("type")) {

                // ── Ping → Pong ───────────────────────────────────────────
                "ping" -> {
                    runCatching {
                        conn.send(JSONObject().apply {
                            put("type", "pong")
                            put("ts", json.optLong("ts", System.currentTimeMillis()))
                        }.toString())
                    }
                }

                // ── Handshake completion ──────────────────────────────────
                // Sequence:
                //   1. Server sends "hello" (in onOpen)
                //   2. Client sends "ready"
                //   3. Server sends "connecting_ack"  ← loading screen hides on BOTH devices
                //   4. Server immediately replays lastValidFrame ← no black wait
                "ready" -> {
                    // Step 3 — confirm handshake
                    runCatching {
                        conn.send(JSONObject().apply {
                            put("type", "connecting_ack")
                        }.toString())
                    }

                    // Step 4 — replay last valid frame immediately so the viewer
                    // never sees a black screen while waiting for the next capture tick.
                    // Without this, on a static host screen the viewer could wait
                    // hundreds of ms (or forever if the host screen is idle).
                    lastValidFrame?.let { frame ->
                        runCatching {
                            conn.send(JSONObject().apply {
                                put("type", "frame")
                                put("data", Base64.encodeToString(frame, Base64.NO_WRAP))
                                put("ts",   System.currentTimeMillis())
                                put("w",    screenWidth)
                                put("h",    screenHeight)
                            }.toString())
                        }.onFailure { Log.w(TAG, "Failed to replay last frame: ${it.message}") }
                    }

                    val addr = conn.remoteSocketAddress?.address?.hostAddress ?: "unknown"
                    onClientAcknowledged?.invoke(addr)
                    Log.d(TAG, "Client ready — sent connecting_ack + frame replay to $addr")
                }

                // ── Health-check pong from client ─────────────────────────
                // lastSeen already updated at the top — nothing else to do.
                "client_pong" -> { /* no-op */ }

                // ── All control commands → AccessibilityService ───────────
                // Covers: touch, swipe, longpress, pinch, key
                else -> onControlCommand?.invoke(json)
            }
        }.onFailure { Log.e(TAG, "Bad message: $message", it) }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        Log.e(TAG, "WS error: ${ex.message}", ex)
        if (conn == null) onServerError?.invoke(ex)
    }

    override fun onStart() {
        isRunning.set(true)
        connectionLostTimeout = 30
        Log.d(TAG, "WebSocket server started on port $port")
        onServerStarted?.invoke()

        // Proactive ping loop — detects dead clients within PING_TIMEOUT_MS
        // without waiting for a TCP RST that may never arrive on LAN.
        pingJob = scheduler.scheduleAtFixedRate({
            val now = System.currentTimeMillis()
            clients.forEach { ws ->
                if (!ws.isOpen) return@forEach
                val seen = lastSeen[ws] ?: now
                if (now - seen > PING_TIMEOUT_MS) {
                    Log.w(TAG, "Stale client — closing ${ws.remoteSocketAddress}")
                    runCatching { ws.close(1001, "ping timeout") }
                } else {
                    runCatching {
                        ws.send(JSONObject().apply {
                            put("type", "server_ping")
                            put("ts",   now)
                        }.toString())
                    }
                }
            }
        }, PING_INTERVAL_MS, PING_INTERVAL_MS, TimeUnit.MILLISECONDS)
    }

    // ── Public API ────────────────────────────────────────────────────────

    fun setDeviceInfo(width: Int, height: Int, name: String) {
        screenWidth  = width
        screenHeight = height
        deviceName   = name
    }

    /**
     * Broadcast a validated JPEG frame to all connected viewers.
     * Also caches it as [lastValidFrame] so newly-connected viewers
     * receive an instant frame on handshake (see "ready" handler above).
     */
    fun broadcastFrame(jpegBytes: ByteArray) {
        if (clients.isEmpty() || !isRunning.get()) return
        lastValidFrame = jpegBytes          // ← cache before broadcast
        runCatching {
            broadcast(JSONObject().apply {
                put("type", "frame")
                put("data", Base64.encodeToString(jpegBytes, Base64.NO_WRAP))
                put("ts",   System.currentTimeMillis())
                put("w",    screenWidth)
                put("h",    screenHeight)
            }.toString())
        }.onFailure { Log.e(TAG, "Broadcast error", it) }
    }

    fun broadcastSystemMessage(type: String, payload: JSONObject? = null) {
        runCatching {
            broadcast(JSONObject().apply {
                put("type", type)
                payload?.keys()?.forEach { key -> put(key, payload.get(key)) }
            }.toString())
        }.onFailure { Log.e(TAG, "System message error", it) }
    }

    fun getClientCount()   = clients.size
    fun isServerRunning()  = isRunning.get()

    fun stopServer() {
        isRunning.set(false)
        lastValidFrame = null               // free memory on stop
        pingJob?.cancel(false)
        scheduler.shutdownNow()
        runCatching { stop(1000) }
        Log.d(TAG, "Server stopped")
    }
}