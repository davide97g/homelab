package it.davideghiotto.jarvistv

import android.content.Context

/**
 * Everything that might differ between this TV and the next one. Set from adb without
 * rebuilding:
 *
 *   adb shell am start -n it.davideghiotto.jarvistv/.HomeActivity \
 *       -e server_host 192.168.15.126 --ei server_port 8787
 */
class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("jarvis", Context.MODE_PRIVATE)

    /**
     * Defaults to the router's own name for the mini PC. The Fritz!Box re-points
     * that name when the DHCP lease moves, so it survives the address change that
     * has broken every config with an IP baked into it — and unlike a .local name,
     * the TV can actually resolve it.
     *
     * Set it to [MDNS] to discover the server instead. That path works only as far
     * as NsdManager does, which on this set is "finds the service, never resolves
     * it", so it is opt-in rather than the default.
     */
    var serverHost: String
        get() = sp.getString("server_host", DEFAULT_HOST) ?: DEFAULT_HOST
        set(v) = sp.edit().putString("server_host", v).apply()

    var serverPort: Int
        get() = sp.getInt("server_port", DEFAULT_PORT)
        set(v) = sp.edit().putInt("server_port", v).apply()

    var ambilightEnabled: Boolean
        get() = sp.getBoolean("ambilight", true)
        set(v) = sp.edit().putBoolean("ambilight", v).apply()

    companion object {
        const val DEFAULT_PORT = 8787
        const val DEFAULT_HOST = "debian.fritz.box"
        const val MDNS = "mdns"
        const val MDNS_TYPE = "_jarvis._tcp"
    }
}
