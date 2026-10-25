// The installed app driven from outside its process, as a person would: through
// the screen, the notification and the launcher. Self-instrumenting, so a test
// can kill the app and launch it again without killing itself.
plugins {
    alias(libs.plugins.android.test)
}

android {
    namespace = "com.builduseful.soundscape.e2e"
    compileSdk = 37
    targetProjectPath = ":app"
    experimentalProperties["android.experimental.self-instrumenting"] = true

    defaultConfig {
        minSdk = 26
        targetSdk = 37
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        // The app as it ships, minified by R8 (made by the baselineprofile
        // plugin): :e2e:connectedBenchmarkReleaseAndroidTest.
        create("benchmarkRelease") {
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += "release"
        }
    }

    // The wording the app must show, from the contract rather than the app's resources.
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

dependencies {
    implementation(project(":core"))
    implementation(libs.androidx.test.runner)
    implementation(libs.androidx.test.ext.junit)
    implementation(libs.uiautomator)
    implementation(libs.junit)
}
