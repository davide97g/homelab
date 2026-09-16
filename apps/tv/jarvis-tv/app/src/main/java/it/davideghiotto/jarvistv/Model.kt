package it.davideghiotto.jarvistv

import org.json.JSONObject

data class Service(val name: String, val up: Boolean)

data class HostStatus(
    val name: String,
    val cpuPercent: Int,
    val memUsedGb: Int,
    val memTotalGb: Int,
    val uptime: String,
) {
    /** One monospace line, so the columns stay put as the numbers change. */
    fun line() = "%-8s  CPU %3d%%   RAM %2d/%d G   up %s"
        .format(name, cpuPercent, memUsedGb, memTotalGb, uptime)
}

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
                    add(Service(s.optString("name"), s.optBoolean("up")))
                }
            }
            return Snapshot(host, services)
        }
    }
}
