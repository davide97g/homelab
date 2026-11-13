plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "it.davideghiotto.jarvistv"
    compileSdk = 34

    defaultConfig {
        applicationId = "it.davideghiotto.jarvistv"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.2"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key on purpose: this is sideloaded over adb onto
            // one TV, never published, and a release key would only be one more secret
            // to keep. Swap in a real signingConfig the day that stops being true.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    // Artwork that is fine on our own TV but not ours to publish (the screensaver's
    // painting). Git-ignored; see src/private/README.md. Missing is fine: the dream
    // falls back to plain cream.
    sourceSets["main"].assets.srcDirs("src/private/assets")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
