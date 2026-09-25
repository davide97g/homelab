package it.davideghiotto.jarvistv

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

/**
 * The link to the JARVIS server on the mini PC.
 *
 * Finding the box is the awkward part. Its LAN address is a DHCP lease that has moved
 * before and broke every config with an IP baked into it, and its Tailscale name does
 * not resolve from here because the TV is not on the tailnet. The answer is the name
 * the router already keeps current, [Prefs.DEFAULT_HOST], which this TV resolves in
 * about a millisecond. mDNS discovery of [Prefs.MDNS_TYPE] is kept as an opt-in for
 * networks without that, but NsdManager on this set finds the service and then never
 * fires the resolve callback, so it is not something to rely on.
 */
class JarvisClient(
    private val ctx: Context,
    private val prefs: Prefs,
    private val onLink: (Boolean) -> Unit,
    private val onSnapshot: (Snapshot) -> Unit,
    private val onTranscript: (String) -> Unit,
    private val onSay: (String, String) -> Unit,
    private val onLaunch: (String) -> Unit,
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)   // a dead TCP link on a TV can hang for minutes
        .build()

    private val nsd by lazy { ctx.getSystemService(Context.NSD_SERVICE) as NsdManager }

    private var socket: WebSocket? = null
    private var attempt = 0
    private var stopped = false
    private var discovery: NsdManager.DiscoveryListener? = null
    private val resolving = AtomicBoolean(false)

    fun start() {
        stopped = false
        val host = prefs.serverHost
        if (host == Prefs.MDNS) discover() else connect(host, prefs.serverPort)
    }

    fun stop() {
        stopped = true
        socket?.close(1000, null)
        socket = null
        stopDiscovery()
    }

    // ── discovery ────────────────────────────────────────────────────────────────

    private fun discover() {
        if (discovery != null) return
        val listener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(info: NsdServiceInfo) {
                Log.i(TAG, "mDNS found ${info.serviceName}")
                // NsdManager will not resolve reliably while a discovery is running:
                // the resolve callback simply never fires. Stop discovering first,
                // then resolve the one service we came for.
                stopDiscovery()
                resolve(info)
            }

            override fun onServiceLost(info: NsdServiceInfo) = Unit
            override fun onDiscoveryStarted(type: String) = Unit
            override fun onDiscoveryStopped(type: String) = Unit

            override fun onStartDiscoveryFailed(type: String, err: Int) {
                Log.e(TAG, "mDNS discovery failed: $err")
                discovery = null
                retry()
            }

            override fun onStopDiscoveryFailed(type: String, err: Int) = Unit
        }
        discovery = listener
        runCatching {
            nsd.discoverServices(Prefs.MDNS_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        }.onFailure {
            Log.e(TAG, "mDNS unavailable: $it")
            discovery = null
            retry()
        }
    }

    private fun stopDiscovery() {
        discovery?.let { runCatching { nsd.stopServiceDiscovery(it) } }
        discovery = null
    }

    @Suppress("DEPRECATION") // the Executor-based resolve arrived in API 34; this set is 31
    private fun resolve(info: NsdServiceInfo) {
        if (!resolving.compareAndSet(false, true)) return   // one resolve at a time, or it errors out
        nsd.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, err: Int) {
                Log.w(TAG, "mDNS resolve failed: $err")
                resolving.set(false)
                retry()
            }

            override fun onServiceResolved(info: NsdServiceInfo) {
                resolving.set(false)
                val addr = info.host?.hostAddress ?: return retry()
                Log.i(TAG, "mDNS resolved to $addr:${info.port}")
                connect(addr, info.port)
            }
        })
    }

    // ── socket ───────────────────────────────────────────────────────────────────

    private fun connect(host: String, port: Int) {
        if (stopped) return
        socket?.close(1000, null)
        val url = "ws://$host:$port/ws"
        Log.i(TAG, "connecting to $url")
        socket = http.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    attempt = 0
                    onLink(true)
                    ws.send(
                        JSONObject()
                            .put("type", "hello")
                            .put("device", "tv")
                            .put("model", Build.MODEL)
                            .toString()
                    )
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    runCatching { JSONObject(text) }.onSuccess { handle(it) }
                        .onFailure { Log.w(TAG, "bad frame: $text") }
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    Log.w(TAG, "socket failed: ${t.message}")
                    onLink(false)
                    retry()
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    onLink(false)
                    if (!stopped) retry()
                }
            }
        )
    }

    private fun handle(o: JSONObject) {
        when (o.optString("type")) {
            "status" -> onSnapshot(Snapshot.parse(o))
            "transcript" -> onTranscript(o.optString("text"))
            "say" -> onSay(o.optString("text"), o.optString("lang", "it-IT"))
            // The server can drive Jellyfin over its own API, but only once the app
            // is running and has registered a session. Starting it is the one part
            // that has to happen on this side.
            "launch" -> onLaunch(o.optString("package"))
            else -> Log.d(TAG, "ignored frame: $o")
        }
    }

    /** Back off to 30 s and stay there. The TV is on all evening; hammering helps nobody. */
    private fun retry() {
        if (stopped) return
        val delayMs = min(30_000L, 1_000L shl min(attempt, 5))
        attempt++
        http.dispatcher.executorService.execute {
            Thread.sleep(delayMs)
            if (!stopped) start()
        }
    }

    private companion object {
        const val TAG = "JarvisClient"
    }
}
