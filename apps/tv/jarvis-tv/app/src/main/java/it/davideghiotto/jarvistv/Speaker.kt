package it.davideghiotto.jarvistv

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Speaks JARVIS's replies with com.google.android.tts, which ships on this set, and
 * hands the Ambilight pulse its start and stop cues.
 *
 * The TV has no microphone — `android.hardware.microphone` is absent from its feature
 * list and the remote's mic is wired straight into Google's own search app — so this
 * is output only. Listening happens on the phone.
 */
class Speaker(ctx: Context, private val onSpeaking: (Boolean) -> Unit) {

    private var ready = false
    private var pending: Pair<String, String>? = null

    private val tts = TextToSpeech(ctx.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (!ready) {
            Log.e(TAG, "TTS init failed: $status")
            return@TextToSpeech
        }
        pending?.let { (text, lang) -> pending = null; say(text, lang) }
    }

    init {
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = onSpeaking(true)
            override fun onDone(utteranceId: String?) = onSpeaking(false)

            @Deprecated("Kept because the non-deprecated overload is not called on API 31")
            override fun onError(utteranceId: String?) = onSpeaking(false)

            override fun onError(utteranceId: String?, errorCode: Int) = onSpeaking(false)
        })
    }

    /** @param lang a BCP-47 tag from the server, e.g. "it-IT". Falls back to the set's own locale. */
    fun say(text: String, lang: String = Locale.getDefault().toLanguageTag()) {
        if (!ready) {
            // Init is asynchronous and the first reply can beat it; hold one utterance.
            pending = text to lang
            return
        }
        val locale = Locale.forLanguageTag(lang)
        if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) {
            tts.setLanguage(locale)
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, text.hashCode().toString())
    }

    fun shutdown() {
        runCatching { tts.stop(); tts.shutdown() }
    }

    private companion object {
        const val TAG = "Speaker"
    }
}
