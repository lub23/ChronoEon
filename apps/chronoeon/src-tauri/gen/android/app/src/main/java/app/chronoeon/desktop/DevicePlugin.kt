package app.chronoeon.desktop

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class LocateArgs { var timeoutMs: Long = 12000 }
@InvokeArg
class GeocodeArgs { var latitude: Double = Double.NaN; var longitude: Double = Double.NaN; var language: String = "en" }
@InvokeArg
class BackgroundArgs { var action: String = ""; var database: String = ""; var language: String = "en"; var remindersEnabled: Boolean = false; var keys: Array<String> = emptyArray() }

@TauriPlugin(permissions = [
    Permission(alias = "location", strings = [Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION])
])
class DevicePlugin(private val activity: Activity) : Plugin(activity) {
    // Tauri has loaded the Rust library before constructing this plugin. Set
    // up Android system TLS before any webview/network commands can run.
    private external fun initializeTls(context: Context): Boolean
    init { initializeTls(activity.applicationContext) }

    private val main = Handler(Looper.getMainLooper())
    private val backgroundWorker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val geocoder = PlaceGeocoder(activity.applicationContext)
    private var cancelLocation: (() -> Unit)? = null
    private fun granted(permission: String) = ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
    private fun canLocate() = granted(Manifest.permission.ACCESS_COARSE_LOCATION) || granted(Manifest.permission.ACCESS_FINE_LOCATION)

    @Command
    fun locate(invoke: Invoke) = activity.runOnUiThread {
        if (canLocate()) acquireLocation(invoke)
        else requestPermissionForAlias("location", invoke, "locationPermissionResult")
    }

    @PermissionCallback
    private fun locationPermissionResult(invoke: Invoke) {
        if (canLocate()) acquireLocation(invoke) else invoke.reject("location-permission-denied")
    }

    private fun acquireLocation(invoke: Invoke) {
        if (cancelLocation != null) { invoke.reject("location-busy"); return }
        val manager = activity.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        if (manager == null || !LocationManagerCompat.isLocationEnabled(manager)) { invoke.reject("location-disabled"); return }
        val signals = mutableListOf<CancellationSignal>()
        var settled = false
        var timeout: Runnable? = null
        fun finish(location: Location?, error: String = "location-unavailable") {
            if (settled) return
            settled = true
            timeout?.let { main.removeCallbacks(it) }
            signals.forEach { it.cancel() }
            cancelLocation = null
            if (location == null) invoke.reject(error)
            else invoke.resolve(JSObject().put("latitude", location.latitude).put("longitude", location.longitude))
        }
        cancelLocation = { finish(null, "location-cancelled") }
        try {
            val precise = granted(Manifest.permission.ACCESS_FINE_LOCATION)
            val providers = manager.getProviders(true).filter {
                it != LocationManager.PASSIVE_PROVIDER && (precise || it != LocationManager.GPS_PROVIDER)
            }
            if (providers.isEmpty()) { finish(null); return }
            // A fresh cached fix saves battery. Never return hours-old coordinates.
            val recent = providers.mapNotNull { provider ->
                try { manager.getLastKnownLocation(provider) } catch (_: SecurityException) { null }
            }.filter { SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos <= 60_000_000_000L }
                .maxByOrNull { it.elapsedRealtimeNanos }
            if (recent != null) { finish(recent); return }
            timeout = Runnable { finish(null, "location-timeout") }
            main.postDelayed(timeout!!, invoke.parseArgs(LocateArgs::class.java).timeoutMs.coerceIn(1000, 30000))
            var pending = providers.size
            for (provider in providers) {
                if (settled) break
                val signal = CancellationSignal()
                signals.add(signal)
                try {
                    LocationManagerCompat.getCurrentLocation(manager, provider, signal, ContextCompat.getMainExecutor(activity)) { location ->
                        if (location != null) finish(location)
                        else if (--pending == 0) finish(null)
                    }
                } catch (_: Exception) { if (--pending == 0) finish(null) }
            }
        } catch (_: Exception) { finish(null) }
    }

    @Command
    fun reverseGeocode(invoke: Invoke) = activity.runOnUiThread {
        val args = invoke.parseArgs(GeocodeArgs::class.java)
        geocoder.resolve(args.latitude, args.longitude, args.language, invoke)
    }

    @Command
    fun background(invoke: Invoke) {
        val args = invoke.parseArgs(BackgroundArgs::class.java)
        if (args.action == "alarmSettings" || args.action == "batterySettings") {
            activity.runOnUiThread {
                try {
                    val intent = if (args.action == "alarmSettings" && android.os.Build.VERSION.SDK_INT >= 31)
                        android.content.Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:" + activity.packageName))
                    else android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    activity.startActivity(intent); invoke.resolve(JSObject())
                } catch (_: Exception) { invoke.reject("timing-settings-unavailable") }
            }
            return
        }
        backgroundWorker.execute {
            try {
                val extras = android.os.Bundle().apply {
                    putString("database", args.database); putString("language", args.language); putBoolean("reminders", args.remindersEnabled); putStringArrayList("keys", ArrayList(args.keys.toList()))
                }
                val result = activity.contentResolver.call(android.net.Uri.parse("content://" + activity.packageName + ".timing"), args.action, null, extras)
                    ?.getString("result") ?: error("timing-no-response")
                val value = org.json.JSONObject(result); val output = JSObject()
                value.keys().forEach { key -> output.put(key, value.get(key)) }
                invoke.resolve(output)
            } catch (_: Exception) { invoke.reject("timing-service-unavailable") }
        }
    }

    override fun onPause() {
        cancelLocation?.invoke()
        geocoder.pause()
    }

    override fun onStop() {
    }

    override fun onDestroy() {
        cancelLocation?.invoke()
        geocoder.close()
        backgroundWorker.shutdown()
    }
}
