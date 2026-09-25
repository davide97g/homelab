package it.davideghiotto.jarvistv

import android.animation.ValueAnimator
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.RectF
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewTreeObserver
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import it.davideghiotto.jarvistv.databinding.ActivityHomeBinding
import it.davideghiotto.jarvistv.databinding.ItemGaugeBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.random.Random

/**
 * Three screens on one reel: the apps, the orb, the homelab. Down goes deeper in, up
 * comes back out, and the reel is the only thing that moves.
 */
class HomeActivity : AppCompatActivity() {

    private enum class Zone { RAIL, GEAR, JARVIS, HOMELAB }

    private companion object {
        const val TAG = "JarvisHome"
        const val JELLYFIN = "org.jellyfin.androidtv"
        const val LEAD = 2          // the picked card never scrolls past the third slot
    }

    private lateinit var ui: ActivityHomeBinding
    private lateinit var prefs: Prefs
    private lateinit var ambilight: Ambilight
    private lateinit var speaker: Speaker

    private var client: JarvisClient? = null
    private var clockJob: Job? = null
    private var voiceJob: Job? = null
    private var showcaseJob: Job? = null

    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private var apps: List<LaunchableApp> = emptyList()
    private var adapter: AppsAdapter? = null
    private val services = ServicesAdapter()
    private var zone = Zone.RAIL
    private var picked = 0
    private var railScroll = 0
    private var launching = false
    private var houseAwake = false
    private var houseHeld = false
    private var housePeaked = false
    private var lastSnap: Snapshot? = null
    private var showcase: List<ShowcaseItem> = emptyList()
    private val backdrops = mutableMapOf<String, Bitmap>()

    private val itLocale = Locale("it", "IT")
    private val timeFmt = SimpleDateFormat("HH:mm", itLocale)
    private val dateFmt = SimpleDateFormat("EEEE d MMMM", itLocale)

    /** One turn of the sweep every 5.5 s while a card is picked, as in the preview. */
    private val sweep = ValueAnimator.ofFloat(0f, 360f).apply {
        duration = 5_500
        repeatCount = ValueAnimator.INFINITE
        interpolator = null
        addUpdateListener { a ->
            val angle = a.animatedValue as Float
            adapter?.sweepAngle = angle
            currentCard()?.sweepAngle = angle
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(ui.root)

        prefs = Prefs(this)
        applyOverrides(intent)

        ambilight = Ambilight(lifecycleScope)
        if (prefs.ambilightEnabled) ambilight.capture()

        speaker = Speaker(this) { speaking ->
            runOnUiThread { onSpeaking(speaking) }
        }

        ui.apps.rail.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        ui.apps.rail.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) { railScroll += dx }
        })

        ui.homelab.services.layoutManager = GridLayoutManager(this, 3)
        ui.homelab.services.adapter = services
        ui.homelab.services.addItemDecoration(
            ServicesAdapter.Gaps(Ui.px(this, 18f).toInt(), 3)
        )
        ui.homelab.services.post {
            val gaps = Ui.px(this, 18f).toInt() * 2
            services.rowHeight = max(Ui.px(this, 72f).toInt(), (ui.homelab.services.height - gaps) / 3)
        }

        ui.jarvis.orb.onColour = { colour -> if (zone == Zone.JARVIS) tintAmbilight(colour) }

        buildGauges()
        setJarvisState(OrbView.State.IDLE)
        watchHouse()

        ui.reel.post {
            for (i in 0 until ui.reel.childCount) {
                val c = ui.reel.getChildAt(i)
                Log.i(TAG, "reel child $i: ${c.javaClass.simpleName} " +
                    "${c.left},${c.top}-${c.right},${c.bottom} vis=${c.visibility} " +
                    "children=${(c as? android.view.ViewGroup)?.childCount}")
            }
            Log.i(TAG, "orb: ${ui.jarvis.orb.width}x${ui.jarvis.orb.height} " +
                "at ${ui.jarvis.orb.left},${ui.jarvis.orb.top} vis=${ui.jarvis.orb.visibility}")
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // HOME is singleTask, so pressing the home key re-enters here rather than
        // recreating; re-read any adb-supplied overrides. onResume always follows and
        // opens the socket, so connecting here too would just open a second one.
        applyOverrides(intent)
    }

    override fun onResume() {
        super.onResume()
        loadApps()
        startClock()
        startClient()
        fetchShowcase()
        if (launching) {
            // coming back from an app the takeover opened
            launching = false
            ui.takeover.close { }
        }
        sweep.start()
        if (zone == Zone.JARVIS) ui.jarvis.orb.start()
        if (houseAwake) ui.apps.house.startWalker()
    }

    override fun onPause() {
        super.onPause()
        clockJob?.cancel()
        sweep.cancel()
        ui.jarvis.orb.stop()
        if (ui.apps.house.acquiring) ui.apps.house.finish()
        ui.apps.house.stopWalker()
        // Hand Ambilight back before whatever the viewer launched takes the screen,
        // otherwise a manual-mode pulse would freeze over their film.
        ambilight.stopPulse()
    }

    override fun onDestroy() {
        super.onDestroy()
        client?.stop()
        speaker.shutdown()
    }

    /** A launcher swallows BACK when it is already at the top. */
    override fun onBackPressed() {
        when (zone) {
            Zone.RAIL -> Unit
            Zone.GEAR -> goTo(Zone.RAIL)
            Zone.JARVIS -> goTo(Zone.RAIL)
            Zone.HOMELAB -> goTo(Zone.JARVIS)
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            openSettings(); return true
        }
        if (launching) return true
        if (ui.apps.house.acquiring) ui.apps.house.finish()
        return when (zone) {
            Zone.RAIL -> when (keyCode) {
                KeyEvent.KEYCODE_DPAD_RIGHT -> { pick(picked + 1); true }
                KeyEvent.KEYCODE_DPAD_LEFT -> { pick(picked - 1); true }
                KeyEvent.KEYCODE_DPAD_UP -> { goTo(Zone.GEAR); true }
                KeyEvent.KEYCODE_DPAD_DOWN -> { goTo(Zone.JARVIS); true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { openPicked(); true }
                else -> super.onKeyDown(keyCode, event)
            }
            Zone.GEAR -> when (keyCode) {
                KeyEvent.KEYCODE_DPAD_DOWN -> { goTo(Zone.RAIL); true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { openSettings(); true }
                else -> super.onKeyDown(keyCode, event)
            }
            Zone.JARVIS -> when (keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> { goTo(Zone.RAIL); true }
                KeyEvent.KEYCODE_DPAD_DOWN -> { goTo(Zone.HOMELAB); true }
                else -> super.onKeyDown(keyCode, event)
            }
            Zone.HOMELAB -> when (keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> { goTo(Zone.JARVIS); true }
                else -> super.onKeyDown(keyCode, event)
            }
        }
    }

    private fun openSettings() = startActivity(Intent(this, SettingsActivity::class.java))

    // ── navigation ───────────────────────────────────────────────────────────────

    private fun goTo(next: Zone) {
        zone = next
        ui.reel.goTo(
            when (next) {
                Zone.RAIL, Zone.GEAR -> 0
                Zone.JARVIS -> 1
                Zone.HOMELAB -> 2
            }
        )
        // the showcase steps back off the apps screen and all but disappears behind
        // the orb, which is the only lit thing on its screen
        ui.showcase.dim = when (next) {
            Zone.RAIL, Zone.GEAR -> 1f
            Zone.JARVIS -> .06f
            Zone.HOMELAB -> .12f
        }
        ui.apps.scrollHint.animate().alpha(if (next == Zone.JARVIS || next == Zone.HOMELAB) 0f else 1f)
            .setDuration(340).start()

        val gearOn = next == Zone.GEAR
        ui.apps.gear.animate().scaleX(if (gearOn) 1.15f else 1f).scaleY(if (gearOn) 1.15f else 1f)
            .setDuration(180).start()
        ui.apps.gear.alpha = if (gearOn) 1f else .7f

        // the orb costs a frame of canvas work, so it only runs while it is on screen
        if (next == Zone.JARVIS) ui.jarvis.orb.start() else ui.jarvis.orb.stop()
        if (next == Zone.RAIL || next == Zone.GEAR) ui.apps.house.startWalker() else ui.apps.house.stopWalker()
        if (next == Zone.JARVIS) tintAmbilight(orbColour()) else tintAmbilight(pickedAccent())
    }

    private fun pick(index: Int) {
        if (apps.isEmpty()) return
        picked = index.coerceIn(0, apps.size - 1)
        adapter?.selected = picked
        scrollRail()
        renderHero()
        renderShowcase()
        tintAmbilight(pickedAccent())
    }

    private fun scrollRail() {
        val card = resources.getDimensionPixelSize(R.dimen.card_w)
        val gap = resources.getDimensionPixelSize(R.dimen.card_gap)
        val target = max(0, picked - LEAD) * (card + gap)
        ui.apps.rail.smoothScrollBy(target - railScroll, 0)
    }

    private fun currentCard(): AppCardView? =
        (ui.apps.rail.findViewHolderForAdapterPosition(picked) as? AppsAdapter.VH)?.card

    private fun pickedAccent(): Int =
        apps.getOrNull(picked)?.accent ?: ContextCompat.getColor(this, R.color.accent)

    // ── apps ─────────────────────────────────────────────────────────────────────

    private fun loadApps() {
        lifecycleScope.launch {
            val loaded = withContext(Dispatchers.IO) { Apps.load(this@HomeActivity) }
            if (loaded.map { it.pkg } == apps.map { it.pkg }) return@launch
            apps = loaded
            adapter = AppsAdapter(apps).also {
                it.selected = picked.coerceIn(0, max(0, apps.size - 1))
                it.art = backdrops
                it.progress = resumeProgress()
                ui.apps.rail.adapter = it
            }
            railScroll = 0
            pick(picked)
        }
    }

    private fun resumeProgress(): Map<String, Float> =
        showcase.firstOrNull()?.takeIf { it.progress > 0f }?.let { mapOf(it.pkg to it.progress) }
            ?: emptyMap()

    /**
     * Opening an app: the takeover grows out of the card and the activity starts
     * underneath it. The animation is the loading state — a cold start on this set is
     * 300–900 ms — so the app is asked for part way through rather than at the end.
     */
    private fun openPicked() {
        val app = apps.getOrNull(picked) ?: return
        val card = currentCard() ?: return
        if (card.width == 0 || card.height == 0) return
        if (launching) return
        launching = true

        val root = IntArray(2).also { ui.root.getLocationInWindow(it) }
        val at = IntArray(2).also { card.getLocationInWindow(it) }
        val w = card.width * card.scaleX
        val h = card.height * card.scaleY
        val left = at[0] - root[0] + (card.width - w) / 2f
        val top = at[1] - root[1] + (card.height - h) / 2f

        ui.takeover.open(
            RectF(left, top, left + w, top + h),
            card.art, app.icon, app.accent, app.label,
        )
        ui.takeover.postDelayed({
            if (!Apps.launch(this, app)) {
                Log.w(TAG, "cannot launch ${app.pkg}")
                launching = false
                ui.takeover.close { }
            }
        }, 900)
    }

    // ── showcase ─────────────────────────────────────────────────────────────────

    /**
     * What the TV is part way through, from Jellyfin by way of the server. The TV has
     * no route to that Jellyfin — it is on the NAS, reached over Tailscale from the
     * mini PC — so both the list and the artwork come through the JARVIS server.
     */
    private fun fetchShowcase() {
        showcaseJob?.cancel()
        showcaseJob = lifecycleScope.launch {
            val base = "http://${prefs.serverHost}:${prefs.serverPort}"
            val json = withContext(Dispatchers.IO) {
                runCatching {
                    http.newCall(Request.Builder().url("$base/api/showcase").build()).execute()
                        .use { res -> res.body?.string()?.let { JSONObject(it) } }
                }.onFailure { Log.w(TAG, "showcase failed: $it") }.getOrNull()
            } ?: return@launch

            showcase = ShowcaseItem.parseAll(json)
            val first = showcase.firstOrNull() ?: return@launch
            first.imagePath?.let { path ->
                Images.load(base + path)?.let { backdrops[first.pkg] = it }
            }
            adapter?.art = backdrops
            adapter?.progress = resumeProgress()
            adapter?.notifyDataSetChanged()
            renderHero()
            renderShowcase()
        }
    }

    private fun showcaseFor(pkg: String): ShowcaseItem? =
        showcase.firstOrNull { it.pkg == pkg }

    private fun renderShowcase() {
        val app = apps.getOrNull(picked) ?: return
        ui.showcase.show(backdrops[app.pkg], app.accent)
    }

    private fun renderHero() {
        val app = apps.getOrNull(picked) ?: return
        val item = showcaseFor(app.pkg)
        val hero = ui.apps

        if (item != null) {
            hero.heroKicker.text = item.kicker
            hero.heroTitle.text = item.title
            setChips(hero.heroMeta, item.meta())
            val remaining = item.remaining()
            if (item.progress > 0f && remaining != null) {
                hero.heroProgressRow.visibility = View.VISIBLE
                hero.heroProgress.progress = (item.progress * 1000).toInt()
                hero.heroProgressText.text = remaining
                hero.heroCtaText.setText(R.string.resume)
            } else {
                hero.heroProgressRow.visibility = View.GONE
                hero.heroCtaText.setText(R.string.open)
            }
        } else {
            hero.heroKicker.text = app.label.uppercase(itLocale)
            hero.heroTitle.text = app.label
            setChips(hero.heroMeta, emptyList())
            hero.heroProgressRow.visibility = View.GONE
            hero.heroCtaText.setText(R.string.open)
        }

        // fade the hero down and back rather than sliding it: sideways reads as a page
        // change, and nothing has changed page
        listOf(hero.heroKicker, hero.heroTitle, hero.heroMeta, hero.heroProgressRow, hero.heroCta)
            .forEachIndexed { i, v ->
                v.alpha = 0f
                v.translationY = Ui.px(this, 14f)
                v.animate().alpha(1f).translationY(0f).setStartDelay(i * 30L).setDuration(340).start()
            }
    }

    private fun setChips(row: android.widget.LinearLayout, chips: List<String>) {
        row.removeAllViews()
        chips.forEach { chip ->
            val tv = TextView(this).apply {
                text = chip
                setBackgroundResource(R.drawable.chip_bg)
                setTextColor(ContextCompat.getColor(this@HomeActivity, R.color.text_secondary))
                textSize = 8f
                val padH = Ui.px(this@HomeActivity, 13f).toInt()
                val padV = Ui.px(this@HomeActivity, 5f).toInt()
                setPadding(padH, padV, padH, padV)
            }
            val lp = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { marginEnd = Ui.px(this@HomeActivity, 14f).toInt() }
            row.addView(tv, lp)
        }
    }

    // ── clock ────────────────────────────────────────────────────────────────────

    private fun startClock() {
        clockJob?.cancel()
        clockJob = lifecycleScope.launch {
            while (isActive) {
                val now = Date()
                ui.apps.clock.text = timeFmt.format(now)
                ui.apps.dateLine.text = dateFmt.format(now).replaceFirstChar { it.uppercase() }
                ui.apps.greeting.text = greeting()
                delay(10_000)
            }
        }
    }

    private fun greeting(): String {
        val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val part = when (h) {
            in 5..12 -> "Buongiorno"
            in 13..17 -> "Buon pomeriggio"
            else -> "Buonasera"
        }
        return "$part, Davide"
    }

    // ── jarvis ───────────────────────────────────────────────────────────────────

    private fun startClient() {
        client?.stop()
        client = JarvisClient(
            ctx = this,
            prefs = prefs,
            onLink = { up -> runOnUiThread { renderLink(up) } },
            onSnapshot = { snap -> runOnUiThread { renderHomelab(snap) } },
            onTranscript = { text -> runOnUiThread { onTranscript(text) } },
            onSay = { text, lang ->
                runOnUiThread { onReply(text) }
                speaker.say(text, lang)
            },
            onLaunch = { pkg ->
                runOnUiThread {
                    if (!Apps.launch(this, pkg)) Log.w(TAG, "cannot launch $pkg")
                }
            },
        ).also { it.start() }
    }

    private fun setJarvisState(state: OrbView.State) {
        ui.jarvis.orb.state = state
        if (state == OrbView.State.IDLE && ui.jarvis.jarvisReply.text.isNullOrBlank()) {
            ui.jarvis.jarvisPrompt.setText(R.string.jarvis_hint_phone)
        }
        ui.jarvis.orbState.setText(
            when (state) {
                OrbView.State.IDLE -> R.string.orb_idle
                OrbView.State.LISTENING -> R.string.orb_listening
                OrbView.State.THINKING -> R.string.orb_thinking
                OrbView.State.SPEAKING -> R.string.orb_speaking
                OrbView.State.ERROR -> R.string.orb_error
            }
        )
    }

    private fun orbColour(): Int = when (ui.jarvis.orb.state) {
        OrbView.State.THINKING -> 0xFFC9B6FD.toInt()
        OrbView.State.SPEAKING -> 0xFFFBBF24.toInt()
        OrbView.State.ERROR -> 0xFFF87171.toInt()
        else -> 0xFFE8A87C.toInt()
    }

    private fun onTranscript(text: String) {
        ui.jarvis.jarvisPrompt.text = "“$text”"
        ui.jarvis.jarvisReply.text = ""
        setJarvisState(OrbView.State.THINKING)
        // the question was asked on the phone, so the answer belongs on the screen
        // that is about answering it
        if (zone != Zone.JARVIS) goTo(Zone.JARVIS)
    }

    private fun onReply(text: String) {
        ui.jarvis.jarvisReply.text = text
        setJarvisState(OrbView.State.SPEAKING)
    }

    private fun onSpeaking(speaking: Boolean) {
        if (speaking) {
            setJarvisState(OrbView.State.SPEAKING)
            startEnvelope()
            if (prefs.ambilightEnabled) ambilight.startPulse(0xFB, 0xBF, 0x24)
        } else {
            stopEnvelope()
            // the question stays on screen under the answer it produced; the phone
            // hint only comes back once there is no answer to read
            setJarvisState(OrbView.State.IDLE)
            if (prefs.ambilightEnabled) ambilight.stopPulse()
        }
    }

    /**
     * A stand-in envelope. Android's TTS gives no level while it speaks — the nearest
     * real signal is `onRangeStart`, which arrives per word — so the orb is driven by a
     * smoothed random walk at speech tempo rather than pretending to a waveform.
     */
    private fun startEnvelope() {
        stopEnvelope()
        voiceJob = lifecycleScope.launch {
            var level = .5f
            while (isActive) {
                level = (level * .6f + Random.nextFloat() * .4f + .12f).coerceIn(0f, 1f)
                ui.jarvis.orb.amplitude = level
                delay(90)
            }
        }
    }

    private fun stopEnvelope() {
        voiceJob?.cancel()
        voiceJob = null
        ui.jarvis.orb.amplitude = 0f
    }

    private fun tintAmbilight(colour: Int) {
        if (!prefs.ambilightEnabled) return
        ambilight.setColour(colour)
    }

    // ── homelab ──────────────────────────────────────────────────────────────────

    private class Gauge(val ui: ItemGaugeBinding)

    private val gauges = mutableListOf<Gauge>()

    private fun buildGauges() {
        val labels = listOf(R.string.metric_cpu, R.string.metric_ram, R.string.metric_uptime, R.string.metric_services)
        labels.forEach { label ->
            val g = ItemGaugeBinding.inflate(layoutInflater, ui.homelab.gauges, false)
            g.gaugeLabel.setText(label)
            g.gaugeValue.text = "—"
            val lp = g.root.layoutParams as android.widget.LinearLayout.LayoutParams
            lp.marginEnd = Ui.px(this, 24f).toInt()
            ui.homelab.gauges.addView(g.root, lp)
            gauges += Gauge(g)
        }
    }

    private fun renderLink(up: Boolean) {
        val colour = ContextCompat.getColor(this, if (up) R.color.ok else R.color.err)
        ui.apps.linkDot.background.mutate().setTint(colour)
        ui.apps.linkText.setText(if (up) R.string.status_online else R.string.status_offline)
        ui.apps.house.bind(up, if (up) lastSnap?.host else null, if (up) lastSnap?.services.orEmpty() else emptyList())
        if (!up) {
            ui.jarvis.jarvisPrompt.setText(R.string.jarvis_offline)
            ui.jarvis.jarvisReply.text = ""
            setJarvisState(OrbView.State.ERROR)
            services.items = emptyList()
            gauges.forEach { it.ui.gaugeValue.text = "—"; it.ui.gaugeBar.progress = 0 }
            ui.homelab.hostName.setText(R.string.homelab_unreachable)
        } else if (ui.jarvis.orb.state == OrbView.State.ERROR) {
            setJarvisState(OrbView.State.IDLE)
            ui.jarvis.jarvisPrompt.setText(R.string.jarvis_hint_phone)
        }
    }

    private fun renderHomelab(snap: Snapshot) {
        val host = snap.host
        lastSnap = snap
        ui.apps.house.bind(true, host, snap.services)
        ui.homelab.hostName.text = host?.name ?: getString(R.string.homelab_unreachable)
        services.items = snap.services

        val upCount = snap.services.count { it.up }
        fun set(i: Int, value: String, unit: String, fraction: Float) {
            val g = gauges.getOrNull(i) ?: return
            g.ui.gaugeValue.text = value
            g.ui.gaugeBar.progress = (fraction.coerceIn(0f, 1f) * 1000).toInt()
            g.ui.gaugeLabel.text = g.ui.gaugeLabel.text.toString().substringBefore(" ·") +
                if (unit.isEmpty()) "" else " · $unit"
        }
        if (host != null) {
            set(0, "${host.cpuPercent}%", "", host.cpuPercent / 100f)
            set(1, "${host.memUsedGb}/${host.memTotalGb} G", "",
                if (host.memTotalGb > 0) host.memUsedGb.toFloat() / host.memTotalGb else 0f)
            set(2, host.uptime, "", 1f)
        }
        set(3, "$upCount/${snap.services.size}", "", 
            if (snap.services.isNotEmpty()) upCount.toFloat() / snap.services.size else 0f)
    }

    /**
     * The house reports in once, the first time the launcher is drawn. Any key
     * docks it immediately — the remote stays in charge.
     */
    private fun watchHouse() {
        ui.apps.house.onFrame = { word, acquiring ->
            ui.apps.houseWord.alpha = word
            if (acquiring && !houseHeld && !housePeaked) {
                houseHeld = true
                fadeChrome(0f, 180)
                ui.showcase.dim = .5f
                if (prefs.ambilightEnabled) ambilight.startPulse(0x9E, 0xEA, 0xF2)
            }
            if (word > .5f) housePeaked = true
            if (acquiring && housePeaked && prefs.ambilightEnabled && word > .85f) {
                ambilight.stopPulse(restore = false)
                ambilight.setColour(0xFFF4EDE2.toInt())
            }
            // chrome comes back as the line starts home, not after it has arrived
            if (houseHeld && (!acquiring || (housePeaked && word < .2f))) {
                houseHeld = false
                housePeaked = false
                fadeChrome(1f, 560)
                ui.showcase.dim = when (zone) {
                    Zone.JARVIS -> .06f
                    Zone.HOMELAB -> .12f
                    else -> 1f
                }
                ambilight.stopPulse(restore = false)
                tintAmbilight(if (zone == Zone.JARVIS) orbColour() else pickedAccent())
            }
        }
        ui.apps.houseWrap.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (ui.apps.houseWrap.height == 0) return true
                if (!ui.apps.houseWrap.viewTreeObserver.isAlive) return true
                ui.apps.houseWrap.viewTreeObserver.removeOnPreDrawListener(this)
                if (!houseAwake) {
                    houseAwake = true
                    ui.apps.house.play()
                }
                return true
            }
        })
    }

    private fun fadeChrome(alpha: Float, ms: Long) {
        listOf(
            ui.apps.avatar, ui.apps.greeting, ui.apps.dateLine, ui.apps.linkPill,
            ui.apps.clock, ui.apps.gear,
            ui.apps.heroKicker, ui.apps.heroTitle, ui.apps.heroMeta,
            ui.apps.heroProgressRow, ui.apps.heroCta,
            ui.apps.rail, ui.apps.scrollHint,
        ).forEach { it.animate().alpha(alpha).setDuration(ms).start() }
    }

    // ── wiring ───────────────────────────────────────────────────────────────────

    private fun applyOverrides(intent: Intent?) {
        intent?.getStringExtra("server_host")
            ?.takeIf { it.isNotBlank() }
            ?.let { prefs.serverHost = it }
        intent?.getIntExtra("server_port", -1)?.takeIf { it > 0 }?.let { prefs.serverPort = it }
        if (intent?.hasExtra("ambilight") == true) {
            prefs.ambilightEnabled = intent.getBooleanExtra("ambilight", true)
        }
    }
}
