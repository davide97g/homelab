package it.davideghiotto.jarvistv

import org.json.JSONArray
import org.json.JSONObject

/** One TCP probe the server ran, with the port it knocked on and how long it took. */
data class Service(val name: String, val up: Boolean, val port: Int, val ms: Int)

data class HostStatus(
    val name: String,
    val cpuPercent: Int,
    val memUsedGb: Int,
    val memTotalGb: Int,
    val uptime: String,
)

data class Snapshot(val host: HostStatus?, val services: List<Service>) {
    companion object {
        fun parse(o: JSONObject): Snapshot {
            val host = o.optJSONObject("host")?.let {
                HostStatus(
                    name = it.optString("name", "debian"),
                    cpuPercent = it.optInt("cpu"),
                    memUsedGb = it.optInt("memUsed"),
                    memTotalGb = it.optInt("memTotal"),
                    uptime = it.optString("uptime", "?"),
                )
            }
            val arr = o.optJSONArray("services")
            val services = buildList {
                for (i in 0 until (arr?.length() ?: 0)) {
                    val s = arr!!.getJSONObject(i)
                    add(
                        Service(
                            name = s.optString("name"),
                            up = s.optBoolean("up"),
                            port = s.optInt("port"),
                            ms = s.optInt("ms"),
                        )
                    )
                }
            }
            return Snapshot(host, services)
        }
    }
}

/**
 * A film the viewer is part way through, as the server reads it out of Jellyfin.
 *
 * [imagePath] is a path on the JARVIS server, not on Jellyfin: the TV has no route to
 * that server at all — it lives on the NAS and the mini PC reaches it over Tailscale —
 * so the artwork is proxied, already resized.
 */
data class ShowcaseItem(
    val id: String,
    val pkg: String,
    val title: String,
    val kicker: String,
    val year: Int?,
    val durationSeconds: Int?,
    val positionSeconds: Int?,
    val imagePath: String?,
) {
    val progress: Float
        get() {
            val d = durationSeconds ?: return 0f
            val p = positionSeconds ?: return 0f
            return if (d > 0) (p.toFloat() / d).coerceIn(0f, 1f) else 0f
        }

    /** "1h 42m rimanenti", or the runtime when nothing has been watched yet. */
    fun remaining(): String? {
        val d = durationSeconds ?: return null
        val left = d - (positionSeconds ?: 0)
        if (left <= 0) return null
        val h = left / 3600
        val m = (left % 3600) / 60
        val time = if (h > 0) "${h}h ${m}m" else "${m}m"
        return if (positionSeconds != null && positionSeconds > 0) "$time rimanenti" else time
    }

    fun meta(): List<String> = buildList {
        year?.let { add(it.toString()) }
        durationSeconds?.let { add("${it / 3600}h ${(it % 3600) / 60}m") }
        add("Jellyfin")
    }

    companion object {
        fun parseAll(o: JSONObject): List<ShowcaseItem> {
            val arr: JSONArray = o.optJSONArray("items") ?: return emptyList()
            return buildList {
                for (i in 0 until arr.length()) {
                    val it = arr.getJSONObject(i)
                    add(
                        ShowcaseItem(
                            id = it.optString("id"),
                            pkg = it.optString("package"),
                            title = it.optString("title"),
                            kicker = it.optString("kicker"),
                            year = it.optInt("year").takeIf { y -> y > 0 },
                            durationSeconds = it.optInt("durationSeconds").takeIf { d -> d > 0 },
                            positionSeconds = it.optInt("positionSeconds").takeIf { p -> p > 0 },
                            imagePath = it.optString("image").takeIf { s -> s.isNotBlank() && s != "null" },
                        )
                    )
                }
            }
        }
    }
}
