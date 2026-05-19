plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.familyguardian"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.familyguardian"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    // Reads keystore details from ~/.gradle/gradle.properties so the keystore
    // itself never lands in the repo. Set FG_RELEASE_KEYSTORE et al locally.
    // If unset, ./gradlew assembleDebug still works; assembleRelease will need
    // -PFG_RELEASE_KEYSTORE=... or the props on disk.
    signingConfigs {
        create("release") {
            val keystorePath = providers.gradleProperty("FG_RELEASE_KEYSTORE").orNull
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = providers.gradleProperty("FG_RELEASE_STORE_PASSWORD").orNull
                keyAlias = providers.gradleProperty("FG_RELEASE_KEY_ALIAS").orNull
                keyPassword = providers.gradleProperty("FG_RELEASE_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Only apply the release config if a keystore is actually configured;
            // otherwise leave unsigned so devs get a clear error rather than a
            // silently-debug-signed APK.
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) {
                signingConfig = releaseSigning
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.navigation:navigation-compose:2.8.1")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("com.google.android.gms:play-services-location:21.3.0")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    implementation("org.osmdroid:osmdroid-android:6.1.20")

    implementation("io.coil-kt:coil-compose:2.7.0")

    implementation(platform("com.google.firebase:firebase-bom:33.1.0"))
    implementation("com.google.firebase:firebase-messaging")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
