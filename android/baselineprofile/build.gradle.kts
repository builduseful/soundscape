// Records which of the app's code runs as it starts and first plays, as the
// startup profile the app ships (app/src/release/generated/baselineProfiles),
// and times a cold start with and without it. Run on a device: see
// android/AGENTS.md.
plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.baselineprofile)
}

android {
    namespace = "com.builduseful.soundscape.baselineprofile"
    compileSdk = 37
    targetProjectPath = ":app"
    experimentalProperties["android.experimental.self-instrumenting"] = true

    defaultConfig {
        // Recording a profile needs Android 9; without root, Android 13.
        minSdk = 28
        targetSdk = 37
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // The wording of the play button, from the contract rather than the app's resources.
    sourceSets["main"].assets.directories += "../../shared"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    // A deprecation is a warning: fail on it, as lint does on its own.
    compilerOptions.allWarningsAsErrors = true
}

baselineProfile {
    // The emulator or phone already connected, as for the other device suites.
    useConnectedDevices = true
}

dependencies {
    implementation(libs.androidx.test.ext.junit)
    implementation(libs.uiautomator)
    implementation(libs.benchmark.macro.junit4)
}
