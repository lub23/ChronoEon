package app.chronoeon.desktop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      // Edge-to-edge content owns the union of system bars, cutouts and IME.
      // Resize the WebView instead of panning only the focused input; consume
      // these insets so children do not subtract the keyboard a second time.
      val occupied = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(occupied.left, occupied.top, occupied.right, occupied.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
