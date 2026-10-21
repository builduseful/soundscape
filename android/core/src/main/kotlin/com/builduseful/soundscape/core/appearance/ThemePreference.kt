package com.builduseful.soundscape.core.appearance

import com.builduseful.soundscape.core.playback.PreferenceStore

/** The listener's choice of theme. The web's `theme-utils.js` is the reference. */
enum class ThemePreference(private val saved: String) {
    System("system"),
    Light("light"),
    Dark("dark"),
    ;

    /** Whether the page is dark, given whether the OS is. */
    fun isDark(systemDark: Boolean): Boolean = when (this) {
        System -> systemDark
        Light -> false
        Dark -> true
    }

    companion object {
        private const val KEY = "theme"

        /** What was saved; nothing, or anything unknown, is [System]. */
        fun load(preferences: PreferenceStore): ThemePreference {
            val saved = preferences.read(KEY)
            return entries.firstOrNull { it.saved == saved } ?: System
        }

        fun save(preferences: PreferenceStore, preference: ThemePreference) = preferences.write(KEY, preference.saved)
    }
}
