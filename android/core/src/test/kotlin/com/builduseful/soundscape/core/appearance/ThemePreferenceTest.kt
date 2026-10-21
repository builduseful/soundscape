package com.builduseful.soundscape.core.appearance

import com.builduseful.soundscape.core.playback.PreferenceStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemePreferenceTest {
    private class Store : PreferenceStore {
        val values = mutableMapOf<String, String>()
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) {
            values[key] = value
        }
    }

    @Test
    fun systemFollowsTheOsAndAnExplicitChoiceDoesNot() {
        assertTrue(ThemePreference.System.isDark(systemDark = true))
        assertFalse(ThemePreference.System.isDark(systemDark = false))
        assertFalse(ThemePreference.Light.isDark(systemDark = true))
        assertTrue(ThemePreference.Dark.isDark(systemDark = false))
    }

    // The saved values are the web's, so the two read alike.
    @Test
    fun aChoiceIsSavedAsTheWebSavesIt() {
        val store = Store()
        ThemePreference.save(store, ThemePreference.Dark)
        assertEquals(mapOf("theme" to "dark"), store.values)
        assertEquals(ThemePreference.Dark, ThemePreference.load(store))
    }

    @Test
    fun nothingSavedOrAnythingUnknownIsSystem() {
        val store = Store()
        assertEquals(ThemePreference.System, ThemePreference.load(store))
        store.values["theme"] = "sepia"
        assertEquals(ThemePreference.System, ThemePreference.load(store))
    }
}
