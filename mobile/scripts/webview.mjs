// 在模拟器 / 手机的 WebView 里执行一段 JS（调试版 APK 才开了 WebView 调试），顺带打出这段时间的控制台输出和异常。
// 用法：sh mobile/scripts/webview.sh '<表达式>' [等待毫秒]。表达式里要声明变量就包进 (() => { ... })()，不然第二次跑会重复声明。
// 测试时可以先 localStorage.soloyardDebug = "1" 再刷新，之后用 __soloyardNav.push({...}) 直接开页面（见 ui/nav.tsx）。
const [expr, wait = '1500'] = process.argv.slice(2)
setTimeout(() => (console.log('timeout'), process.exit(1)), Number(wait) + 8000)
const pages = await (await fetch('http://localhost:9333/json')).json()
const page = pages.find((p) => p.type === 'page' && p.url.startsWith('http://tauri.localhost')) ?? pages[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }))
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.method === 'Runtime.consoleAPICalled') console.log('console.' + d.params.type, d.params.args.map((a) => a.value ?? a.description).join(' '))
  if (d.method === 'Runtime.exceptionThrown') console.log('exception', d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)
  if (d.id === 2) console.log('result', JSON.stringify(d.result.result?.value ?? d.result.result?.description ?? d.result))
}
ws.onopen = () => {
  send('Runtime.enable')
  send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  setTimeout(() => process.exit(0), Number(wait))
}
