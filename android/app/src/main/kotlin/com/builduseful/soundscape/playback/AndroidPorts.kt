package com.builduseful.soundscape.playback

import android.content.Context
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import com.builduseful.soundscape.audio.mediaAttributes
import com.builduseful.soundscape.core.playback.AudioFocus
import com.builduseful.soundscape.core.playback.Cancellable
import com.builduseful.soundscape.core.playback.PreferenceStore
import com.builduseful.soundscape.core.playback.Scheduler

internal class SharedPreferenceStore(context: Context, file: String) : PreferenceStore {
    private val preferences = context.getSharedPreferences(file, Context.MODE_PRIVATE)

    override fun read(key: String): String? = preferences.getString(key, null)

    override fun write(key: String, value: String) = preferences.edit().putString(key, value).apply()
}

internal class HandlerScheduler(private val handler: Handler) : Scheduler {
    override fun schedule(delayMillis: Long, action: () -> Unit): Cancellable {
        val runnable = Runnable(action)
        handler.postDelayed(runnable, delayMillis)
        return Cancellable { handler.removeCallbacks(runnable) }
    }
}

/** Focus changes arrive on [handler]'s thread as [AudioManager]'s `AUDIOFOCUS_*` values. */
internal class SystemAudioFocus(context: Context, handler: Handler, onChange: (Int) -> Unit) : AudioFocus {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(mediaAttributes)
        .setOnAudioFocusChangeListener(onChange, handler)
        .build()

    override fun request() = audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED

    override fun abandon() {
        audio.abandonAudioFocusRequest(request)
    }
}
