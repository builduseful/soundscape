plugins {
    `kotlin-dsl`
}

dependencies {
    // Gradle's own copy of Groovy, for its JSON parser: no new dependency.
    implementation(localGroovy())
}

gradlePlugin {
    plugins {
        register("sharedContract") {
            id = "soundscape.shared-contract"
            implementationClass = "soundscape.build.SharedContractPlugin"
        }
    }
}
