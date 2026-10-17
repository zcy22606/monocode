package dev.soloyard.mobile

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import android.provider.Settings
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Soloyard：界面是深色的，状态栏和导航条一直用浅色图标
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    // 通知（SOL-104）：从通知点进来的先记着，网页起来后来取；开着通知就把常驻服务拉起来
    pendingOpen = intent?.getStringExtra(NotifyService.EXTRA_OPEN)

    // 安卓 15 起强制全面屏，网页拿不到状态栏高度，也不会被键盘顶起来。
    // 这里按状态栏、导航条、键盘的实际高度给网页留边；键盘升降时逐帧跟着变，输入框贴着键盘走。
    val content = findViewById<View>(android.R.id.content)
    val fit = { insets: WindowInsetsCompat ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      content.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
    }
    ViewCompat.setOnApplyWindowInsetsListener(content) { _, insets ->
      fit(insets)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.setWindowInsetsAnimationCallback(
      content,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          running: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          fit(insets)
          return insets
        }
      },
    )
  }

  // Soloyard：给网页层的几个系统功能（SOL-92 / SOL-97）：分享、用其他应用打开、存到「下载」、用浏览器打开。
  // 只注入给 app 自己的页面（http://tauri.localhost），预览的网页、开发服务器的页面拿不到；文件只认缓存里取回来的。
  private var webView: WebView? = null
  /** 从通知点进来、网页还没取走的那个会话（事件 JSON）。 */
  private var pendingOpen: String? = null

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val open = intent.getStringExtra(NotifyService.EXTRA_OPEN) ?: return
    // app 开着：直接告诉网页（open 是 JSONObject.toString()，本身就是合法的 JS 字面量）
    val view = webView
    if (view == null) pendingOpen = open
    else view.evaluateJavascript("window.dispatchEvent(new CustomEvent('soloyard:notification', { detail: $open }))", null)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    WebViewCompat.addWebMessageListener(webView, "SoloyardAndroid", setOf("http://tauri.localhost")) { _, message, _, _, reply ->
      // 成功回 "ok"，带数据的回 "ok:<数据>"，失败回 "error:<原因>"
      val answer = { result: Result<String> ->
        runOnUiThread {
          reply.postMessage(result.fold({ if (it.isEmpty()) "ok" else "ok:$it" }, { "error:" + (it.message ?: it.javaClass.simpleName) }))
        }
      }
      val request = runCatching { JSONObject(message.data ?: "{}") }.getOrElse { return@addWebMessageListener answer(Result.failure(it)) }
      // 存文件可能有几十 MB，不卡界面
      if (request.optString("action") == "save") Thread { answer(runCatching { save(request); "" }) }.start()
      else answer(runCatching { handle(request) })
    }
  }

  /** 常驻服务被系统杀了的话，回到 app 时拉起来。 */
  override fun onResume() {
    super.onResume()
    NotifyService.start(this)
  }

  /** 通知开没开、系统允不允许弹、有没有被省电管住（ColorOS 上还要另外开「自启动」，系统查不到）、连没连上网关。 */
  private fun notifyStatus(): String {
    val power = getSystemService(PowerManager::class.java)
    return NotifyService.health(this)
      .put("enabled", NotifyService.enabled(this))
      .put("allowed", NotificationManagerCompat.from(this).areNotificationsEnabled())
      .put("background", power?.isIgnoringBatteryOptimizations(packageName) == true)
      .toString()
  }

  private fun downloaded(request: JSONObject): File {
    val file = File(request.getString("path")).canonicalFile
    require(file.path.startsWith(File(cacheDir, "files").canonicalPath + "/") && file.isFile) { "Not a downloaded file" }
    return file
  }

  private fun mime(request: JSONObject) = request.optString("mime").ifEmpty { "application/octet-stream" }

  private fun handle(request: JSONObject): String {
    when (request.getString("action")) {
      "notifyStatus" -> return notifyStatus()
      "notifyOn" -> {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
          requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        NotifyService.setEnabled(this, true)
        return notifyStatus()
      }
      "notifyOff" -> {
        NotifyService.setEnabled(this, false)
        return notifyStatus()
      }
      // 不受省电限制（锁屏后也能连着）；已经是了就打开应用设置，ColorOS 的「自启动」在那里
      "notifyBackground" -> {
        val power = getSystemService(PowerManager::class.java)
        startActivity(
          if (power?.isIgnoringBatteryOptimizations(packageName) == true) Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
          else Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
        )
        return ""
      }
      "appSettings" -> {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        return ""
      }
      "takeOpen" -> return (pendingOpen ?: "").also { pendingOpen = null }
      "viewing" -> {
        NotifyService.viewing = request.optString("session")
        return ""
      }
    }
    if (request.getString("action") == "browse") {
      val uri = Uri.parse(request.getString("url"))
      require(uri.scheme == "http" || uri.scheme == "https") { "Not a web address" }
      startActivity(Intent(Intent.ACTION_VIEW, uri))
      return ""
    }
    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", downloaded(request))
    val intent = when (request.getString("action")) {
      "share" -> Intent(Intent.ACTION_SEND).setType(mime(request)).putExtra(Intent.EXTRA_STREAM, uri)
      "open" -> Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime(request))
      else -> error("Unknown action")
    }
    startActivity(Intent.createChooser(intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null))
    return ""
  }

  /** 存进系统的「下载」（安卓 10 起不用存储权限）。 */
  private fun save(request: JSONObject) {
    val file = downloaded(request)
    require(Build.VERSION.SDK_INT >= 29) { "Needs Android 10 or later" }
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, file.name)
      put(MediaStore.Downloads.MIME_TYPE, mime(request))
    }
    val target = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Couldn't create the file")
    contentResolver.openOutputStream(target)!!.use { out -> file.inputStream().use { it.copyTo(out) } }
  }
}
