# DTOs serialized by kotlinx-serialization — keep classes + generated
# $$serializer companions, otherwise R8 strips them and decode fails at runtime.
-keep class com.familyguardian.data.** { *; }
-keep class com.familyguardian.events.** { *; }
-keep,includedescriptorclasses class com.familyguardian.**$$serializer { *; }
-keepclassmembers class com.familyguardian.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

# kotlinx-serialization core
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit + OkHttp — required keeps from upstream consumer rules
-keepattributes RuntimeVisibleAnnotations, RuntimeInvisibleAnnotations
-keep class kotlin.Metadata { *; }
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * { @retrofit2.http.* <methods>; }

# osmdroid + Play services location
-dontwarn org.osmdroid.**
-keep class org.osmdroid.** { *; }
-dontwarn com.google.android.gms.**
