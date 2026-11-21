plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.ksp)
}

android {
    namespace = "dev.jdtech.jellyfin.setup"
    compileSdk = Versions.COMPILE_SDK
    buildToolsVersion = Versions.BUILD_TOOLS

    defaultConfig {
        minSdk = Versions.MIN_SDK
        // Cinema: the sign-in service. `-PaccountsUrl=http://10.0.2.2:3190` for a local one.
        val accountsUrl = providers.gradleProperty("accountsUrl").orNull
        buildConfigField(
            "String",
            "ACCOUNTS_URL",
            "\"${accountsUrl ?: "https://accounts.davideghiotto.it"}\"",
        )
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        named("release") { isMinifyEnabled = false }
        register("staging") { initWith(getByName("release")) }
    }

    compileOptions {
        sourceCompatibility = Versions.JAVA
        targetCompatibility = Versions.JAVA
    }
}

dependencies {
    implementation(projects.core)
    implementation(projects.data)
    implementation(projects.settings)
    implementation(libs.timber)

    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.lifecycle.viewmodel)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.jellyfin.core)
}
