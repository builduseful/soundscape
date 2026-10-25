package com.builduseful.soundscape.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

// Writes the profile the app ships: ./gradlew :app:generateBaselineProfile.
// Run it again when what starts the app changes.
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun generate() = rule.collect(packageName = APP, includeInStartupProfile = true) {
        startAndPlay()
    }
}
