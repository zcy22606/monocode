package dev.soloyard.mobile

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Soloyard（SOL-104）：常驻服务，长连家里主机的网关等「会话跑完了 / 等你处理」，来了弹系统通知，点了进那个会话。
 * app 在前台、正开着那个会话时不弹（界面看得见），别的会话照弹。安卓要求常驻服务在通知栏挂一条「Soloyard 在线」。
 * 网关地址和设备凭据读原生层存的 connection.json（和 lib.rs 同一份），网页层碰不到凭据。
 */
class NotifyService : Service() {
  companion object {
    const val EXTRA_OPEN = "soloyard.open"
    private const val CHANNEL_EVENTS = "events"
    private const val CHANNEL_SERVICE = "service"
    private const val PREFS = "soloyard.notify"
    private const val ONLINE_ID = 1

    /** 界面正开着的会话（MainActivity 的 viewing）。 */
    @Volatile var viewing = ""

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun enabled(context: Context) = prefs(context).getBoolean("enabled", false)

    /** 设置里显示：上次连上网关的时间、之后连不上的原因、最近一次被系统停住（开始时间、停了多久）。 */
    fun health(context: Context): JSONObject = prefs(context).let {
      JSONObject()
        .put("lastOk", it.getLong("lastOk", 0))
        .put("lastError", it.getString("lastError", null) ?: "")
        .put("stoppedAt", it.getLong("stoppedAt", 0))
        .put("stoppedFor", it.getLong("stoppedFor", 0))
    }

    fun setEnabled(context: Context, on: Boolean) {
      prefs(context).edit().putBoolean("enabled", on).apply()
      if (on) start(context) else context.stopService(Intent(context, NotifyService::class.java))
    }

    fun start(context: Context) {
      if (enabled(context)) ContextCompat.startForegroundService(context, Intent(context, NotifyService::class.java))
    }

    private fun channels(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val manager = context.getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_EVENTS, context.getString(R.string.notify_channel_events), NotificationManager.IMPORTANCE_HIGH),
      )
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_SERVICE, context.getString(R.string.notify_channel_service), NotificationManager.IMPORTANCE_MIN),
      )
    }
  }

  @Volatile private var running = true
  private var worker: Thread? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    channels(this)
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val online = NotificationCompat.Builder(this, CHANNEL_SERVICE)
      .setSmallIcon(R.drawable.ic_stat_soloyard)
      .setContentTitle(getString(R.string.notify_online))
      .setContentText(getString(R.string.notify_online_text))
      .setContentIntent(open)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .build()
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
    ServiceCompat.startForeground(this, ONLINE_ID, online, type)
    worker = Thread(::loop, "soloyard-notify").also { it.start() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

  override fun onDestroy() {
    running = false
    worker?.interrupt()
    super.onDestroy()
  }

  private fun loop() {
    val prefs = prefs(this)
    var after: Long? = if (prefs.contains("after")) prefs.getLong("after", 0) else null
    var wait = 5_000L
    // 一次等待最多 25 秒（加上中继延迟、40 秒读超时），远超过 = 中间被系统停住了（锁屏后 ColorOS 冻结后台）
    fun noteStop(started: Long) {
      val took = System.currentTimeMillis() - started
      if (took > 120_000) prefs.edit().putLong("stoppedAt", started).putLong("stoppedFor", took).apply()
    }
    while (running) {
      val started = System.currentTimeMillis()
      try {
        val connection = JSONObject(File(applicationInfo.dataDir, "connection.json").readText())
        val result = waitEvents(connection.getString("url"), connection.getString("token"), after)
        noteStop(started)
        val events = result.getJSONArray("events")
        for (i in 0 until events.length()) show(events.getJSONObject(i))
        after = result.getLong("latest")
        prefs.edit().putLong("after", after).putLong("lastOk", System.currentTimeMillis()).remove("lastError").apply()
        wait = 5_000L
      } catch (e: InterruptedException) {
        return
      } catch (e: Exception) {
        // 没配对、连不上（Tailscale 断了、网关重启）：往后退，最长一分钟
        prefs.edit().putString("lastError", e.message ?: e.javaClass.simpleName).apply()
        try {
          Thread.sleep(wait)
        } catch (_: InterruptedException) {
          return
        }
        noteStop(started + wait)
        wait = minOf(wait * 2, 60_000L)
      }
    }
  }

  /** 网关的 soloyard.events.wait：有新的马上回，没有最多等 25 秒。 */
  private fun waitEvents(url: String, token: String, after: Long?): JSONObject {
    val connection = URL(url.trimEnd('/') + "/rpc").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 10_000
      connection.readTimeout = 40_000
      connection.doOutput = true
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("Content-Type", "application/json")
      val params = JSONObject()
      if (after != null) params.put("after", after)
      val body = JSONObject().put("version", 1).put("method", "soloyard.events.wait").put("params", params)
      connection.outputStream.use { it.write(body.toString().toByteArray()) }
      val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
      val reply = JSONObject(stream.bufferedReader().use { it.readText() })
      if (reply.has("error")) throw IllegalStateException(reply.getString("error"))
      return reply.getJSONObject("result")
    } finally {
      connection.disconnect()
    }
  }

  private fun foreground(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun show(event: JSONObject) {
    if (foreground() && event.optString("sessionId") == viewing) return
    // 主机起的标题带着「claude · 」前缀，和 app 里一样去掉
    val title = event.optString("title").replace(Regex("^[a-z]+\\s*·\\s*", RegexOption.IGNORE_CASE), "").ifEmpty { getString(R.string.notify_untitled) }
    val input = event.optString("kind") == "input"
    val body = event.optString("body").ifEmpty { getString(if (input) R.string.notify_input_body else R.string.notify_done_body) }
    // 顶上一行照原型：哪台机器 · 哪个项目
    val machine = if (event.optString("source") == "host") getString(R.string.notify_host) else event.optString("machine")
    val where = listOf(machine, event.optString("cwd").trimEnd('/').substringAfterLast('/')).filter { it.isNotEmpty() }.joinToString(" · ")
    val heading = getString(if (input) R.string.notify_input else R.string.notify_done, title)
    val open = Intent(this, MainActivity::class.java)
      .putExtra(EXTRA_OPEN, event.toString())
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tap = PendingIntent.getActivity(this, event.optInt("id"), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(this, CHANNEL_EVENTS)
      .setSmallIcon(R.drawable.ic_stat_soloyard)
      .setContentTitle(heading)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setSubText(where)
      // 锁屏设成隐藏内容时显示这一版：看得到哪个会话跑完了，看不到回复内容
      .setPublicVersion(
        NotificationCompat.Builder(this, CHANNEL_EVENTS)
          .setSmallIcon(R.drawable.ic_stat_soloyard)
          .setContentTitle(heading)
          .setSubText(where)
          .build(),
      )
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()
    // 同一个会话只留最新一条
    runCatching { NotificationManagerCompat.from(this).notify(event.optString("sessionId").hashCode(), notification) }
  }
}

/** 开机、app 更新后把常驻服务拉起来（开着通知时）。ColorOS 上要允许 Soloyard「自启动」才收得到。 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) NotifyService.start(context)
  }
}
