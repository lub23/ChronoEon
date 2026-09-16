package app.chronoeon.desktop

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import android.os.Handler
import android.os.Looper
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.util.Locale
import java.util.concurrent.Executors

/** The phone vendor's geocoder has local road/POI data. Never turn a failed
 * lookup into a fake coordinate address or block the activity's UI thread. */
class PlaceGeocoder(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var cancel: (() -> Unit)? = null

    fun resolve(latitude: Double, longitude: Double, language: String, invoke: Invoke) {
        if (cancel != null) { invoke.reject("geocoder-busy"); return }
        if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
            invoke.reject("geocoder-invalid-coordinate"); return
        }
        if (!Geocoder.isPresent()) { invoke.reject("geocoder-unavailable"); return }
        var settled = false
        var timeout: Runnable? = null
        fun finish(addresses: List<Address>?, error: String = "geocoder-no-place") {
            if (settled) return
            settled = true
            timeout?.let { main.removeCallbacks(it) }
            cancel = null
            val address = addresses?.maxByOrNull {
                (if (!it.thoroughfare.isNullOrBlank()) 4 else 0) + (if (!it.featureName.isNullOrBlank()) 2 else 0) + (if (it.maxAddressLineIndex >= 0) 1 else 0)
            }
            if (address == null) { invoke.reject(error); return }
            val full = if (address.maxAddressLineIndex >= 0) address.getAddressLine(0)?.trim() else null
            val street = listOfNotNull(address.thoroughfare, address.subThoroughfare).distinct().joinToString(if (language.startsWith("zh")) "" else " ")
            val result = JSObject().put("province", address.adminArea ?: "").put("city", address.locality ?: "")
                .put("locality", address.subAdminArea ?: "").put("country", address.countryName ?: "")
                .put("neighborhood", address.subLocality ?: "").put("street", street)
                .put("name", address.featureName ?: "").put("address", full ?: "")
            if (full.isNullOrBlank() && address.locality.isNullOrBlank() && address.adminArea.isNullOrBlank()) invoke.reject("geocoder-no-place")
            else invoke.resolve(result)
        }
        cancel = { finish(null, "geocoder-cancelled") }
        timeout = Runnable { finish(null, "geocoder-timeout") }
        main.postDelayed(timeout!!, 8000)
        val geocoder = Geocoder(context, if (language.startsWith("zh")) Locale.SIMPLIFIED_CHINESE else Locale.ENGLISH)
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                geocoder.getFromLocation(latitude, longitude, 3, object : Geocoder.GeocodeListener {
                    override fun onGeocode(addresses: MutableList<Address>) { main.post { finish(addresses) } }
                    override fun onError(errorMessage: String?) { main.post { finish(null, "geocoder-unavailable") } }
                })
            } catch (_: Exception) { finish(null, "geocoder-unavailable") }
        } else worker.execute {
            try {
                @Suppress("DEPRECATION") val addresses = geocoder.getFromLocation(latitude, longitude, 3)
                main.post { finish(addresses) }
            } catch (_: Exception) { main.post { finish(null, "geocoder-unavailable") } }
        }
    }
    fun pause() { cancel?.invoke() }
    fun close() { pause(); worker.shutdownNow() }
}
