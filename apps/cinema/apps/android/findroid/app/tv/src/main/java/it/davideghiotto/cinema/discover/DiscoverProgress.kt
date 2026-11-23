package it.davideghiotto.cinema.discover

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import it.davideghiotto.cinema.design.CinemaColors
import it.davideghiotto.cinema.design.CinemaTokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/**
 * A requested title on its way: four steps (requested, download, copy to the NAS, library), the one
 * in progress with its bar and time left, and when it should be watchable. Without a report from
 * the mini PC the steps still follow Seerr's status, just with no times. apps/web draws the same
 * panel in src/components/discover/PipelineProgress.tsx.
 */
private enum class Step(val label: String) {
    REQUEST("Requested"),
    DOWNLOAD("Download"),
    NAS("Copy to NAS"),
    LIBRARY("Library"),
}

private fun stepOf(stage: String) =
    when (stage) {
        "settling",
        "waiting",
        "sending",
        "verifying" -> Step.NAS
        "arrived" -> Step.LIBRARY
        else -> Step.DOWNLOAD
    }

@Composable
fun PipelineProgress(standing: Standing, progress: TitleProgress?, modifier: Modifier = Modifier) {
    val now by
        produceState(System.currentTimeMillis()) {
            while (true) {
                delay(30_000)
                value = System.currentTimeMillis()
            }
        }
    val step =
        progress?.let { stepOf(it.stage) }
            ?: if (standing == Standing.PENDING) Step.REQUEST else Step.DOWNLOAD
    val stalled = progress?.stage == "stalled"
    val line = describe(standing, progress, now)
    val eta = progress?.takeIf { it.stage != "arrived" }?.eta?.let(::millis)

    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier =
            modifier
                .width(560.dp)
                .clip(RoundedCornerShape(CinemaTokens.Radius.lg))
                .background(CinemaColors.canvas.copy(alpha = 0.7f))
                .padding(16.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (s in Step.entries) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    Box(
                        modifier =
                            Modifier.fillMaxWidth()
                                .height(4.dp)
                                .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                                .background(
                                    when {
                                        s < step -> CinemaColors.match
                                        s == step && stalled -> CinemaColors.amber
                                        s == step -> CinemaColors.primary
                                        else -> CinemaColors.foreground.copy(alpha = 0.15f)
                                    }
                                )
                    )
                    Text(
                        text = s.label.uppercase(Locale.ROOT),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 1.sp,
                        color =
                            if (s == step) CinemaColors.foreground
                            else CinemaColors.mutedForeground,
                    )
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = line.title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                line.percent?.let {
                    Text(
                        text = "$it%",
                        style = MaterialTheme.typography.labelLarge,
                        color = CinemaColors.mutedForeground,
                    )
                }
            }
            line.percent?.let { percent ->
                Box(
                    modifier =
                        Modifier.fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                            .background(CinemaColors.foreground.copy(alpha = 0.1f))
                ) {
                    Bar(percent, if (stalled) CinemaColors.amber else CinemaColors.primary)
                }
            }
            line.detail?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = CinemaColors.mutedForeground,
                )
            }
            progress
                ?.message
                ?.takeIf { stalled }
                ?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = CinemaColors.amber,
                    )
                }
        }

        eta?.let {
            Text(
                text = "Ready to watch around ${clock(it)} · ${until(it, now)}",
                style = MaterialTheme.typography.bodyMedium,
                color = CinemaColors.foreground.copy(alpha = 0.8f),
            )
        }
    }
}

/** A slim bar along the bottom of a poster card, only while something is actually moving. */
@Composable
fun BoxScope.ProgressSliver(progress: TitleProgress?) {
    if (progress == null || progress.stage == "arrived") return
    Box(
        modifier =
            Modifier.align(Alignment.BottomCenter)
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth()
                .height(4.dp)
                .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                .background(CinemaColors.foreground.copy(alpha = 0.15f))
    ) {
        Bar(
            percentOf(progress) ?: 0,
            when {
                progress.stage == "stalled" -> CinemaColors.amber
                progress.transfer != null -> CinemaColors.match
                else -> CinemaColors.primary
            },
        )
    }
}

@Composable
private fun BoxScope.Bar(percent: Int, color: Color) {
    Box(
        modifier =
            Modifier.align(Alignment.CenterStart)
                .fillMaxWidth(percent.coerceIn(0, 100) / 100f)
                .height(6.dp)
                .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                .background(color)
    )
}

private fun percentOf(p: TitleProgress): Int? {
    val t = p.transfer
    if (stepOf(p.stage) == Step.NAS && t != null && t.total > 0) {
        return (t.bytes * 100 / t.total).toInt()
    }
    val d = p.download
    if (d != null && d.size > 0) return ((d.size - d.left) * 100 / d.size).toInt()
    return null
}

private data class Line(val title: String, val percent: Int?, val detail: String?)

private fun describe(standing: Standing, p: TitleProgress?, now: Long): Line {
    if (p == null) {
        return if (standing == Standing.PENDING) {
            Line("Waiting for an admin to approve it", null, null)
        } else {
            Line("Looking for a good copy", null, "It starts downloading as soon as one turns up.")
        }
    }
    val files = if (p.files > 1) " · ${p.filesArrived} of ${p.files} files there" else ""
    val d = p.download
    val t = p.transfer
    val got = d?.let { "${bytes(it.size - it.left)} of ${bytes(it.size)}" }
    return when (p.stage) {
        "queued" -> Line("Queued for download", percentOf(p), got)
        "downloading" ->
            Line(
                "Downloading",
                percentOf(p),
                got?.let { g ->
                    g + (d?.eta?.let(::millis)?.let { " · ${until(it, now)} left" } ?: "")
                },
            )
        "stalled" -> Line("Download stuck", percentOf(p), got)
        "importing" -> Line("Downloaded, moving it into place", 100, null)
        "settling" ->
            Line(
                "Waiting for subtitles",
                null,
                t?.startsAt?.let(::millis)?.let {
                    "The copy to the NAS starts around ${clock(it)}$files"
                },
            )
        "waiting" ->
            if (t?.paused == true) {
                Line(
                    "Copy to the NAS is paused",
                    null,
                    "It resumes when NAS sync is switched back on.",
                )
            } else {
                Line(
                    "Next in line for the NAS",
                    null,
                    t?.startsAt?.let(::millis)?.let { "Starts around ${clock(it)}$files" },
                )
            }
        "sending" ->
            Line(
                if (t?.paused == true) "Copy to the NAS is paused" else "Copying to the NAS",
                percentOf(p),
                t?.let { x ->
                    val eta = x.eta?.takeIf { !x.paused }?.let(::millis)
                    val left = eta?.let { " · ${until(it, now)} left" } ?: ""
                    "${bytes(x.bytes)} of ${bytes(x.total)}$left$files"
                },
            )
        "verifying" -> Line("Checking the copy", 100, "Comparing checksums on both ends.")
        "arrived" ->
            Line(
                "On the NAS, adding it to the library",
                null,
                "The Watch button appears in a minute or two.",
            )
        else -> Line("On its way", percentOf(p), null)
    }
}

private fun millis(iso: String): Long? = runCatching {
    Instant.parse(iso).toEpochMilli()
}
    .getOrNull()

private val CLOCK = DateTimeFormatter.ofPattern("HH:mm")

private fun clock(ms: Long): String =
    CLOCK.format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))

private fun until(ms: Long, now: Long): String {
    val min = maxOf(1, ((ms - now) / 60_000.0).roundToInt())
    if (min < 60) return "~$min min"
    val h = min / 60
    val m = min % 60
    return if (h < 24) "~$h h" + (if (m > 0) " $m min" else "") else "~${(h / 24.0).roundToInt()} d"
}

private fun bytes(n: Long): String =
    when {
        n >= 1_000_000_000 -> String.format(Locale.ROOT, "%.1f GB", n / 1e9)
        n >= 1_000_000 -> "${(n / 1e6).roundToInt()} MB"
        else -> "${maxOf(0, (n / 1e3).roundToInt())} KB"
    }
