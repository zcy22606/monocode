//! Soloyard 手机端的原生层：带着设备凭据调主机的 `POST /rpc`，取会话里的文件（files.rs）。
//! 凭据只存在这里，网页层拿不到；主机拒绝带 Origin 头的请求，所以也只能从原生层发。
mod files;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Manager, State};

/// 和 `src/features/connections/model/protocol.ts` 的 `HOST_PROTOCOL_VERSION` 一致。
const PROTOCOL_VERSION: u64 = 1;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    url: String,
    token: String,
    environment_id: String,
    name: String,
}

/// 给网页层看的连接信息，不带凭据。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionInfo {
    url: String,
    environment_id: String,
    name: String,
}

impl From<&Connection> for ConnectionInfo {
    fn from(c: &Connection) -> Self {
        Self {
            url: c.url.clone(),
            environment_id: c.environment_id.clone(),
            name: c.name.clone(),
        }
    }
}

/// 网页层按 kind 给提示：network 连不上、auth 凭据无效、host 主机报错、
/// protocol 版本不对、unpaired 还没配对。message 是原文。
#[derive(Debug, Serialize)]
struct RpcError {
    kind: &'static str,
    message: String,
}

impl RpcError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

struct Store {
    path: PathBuf,
    connection: Mutex<Option<Connection>>,
    agent: ureq::Agent,
    /// 会话里的文件取回来放这里（缓存目录，系统空间紧张时会清）。
    files: PathBuf,
}

impl Store {
    fn connected(&self) -> Result<Connection, RpcError> {
        self.connection.lock().unwrap().clone().ok_or_else(|| RpcError::new("unpaired", "No host is paired"))
    }
}

fn post(agent: &ureq::Agent, url: &str, token: &str, body: Value) -> Result<Value, RpcError> {
    let response = agent
        .post(&format!("{}/rpc", url.trim_end_matches('/')))
        .set("Authorization", &format!("Bearer {token}"))
        .send_json(body);
    let (status, response) = match response {
        Ok(r) => (200, r),
        Err(ureq::Error::Status(code, r)) => (code, r),
        Err(ureq::Error::Transport(e)) => return Err(RpcError::new("network", e.to_string())),
    };
    let value: Value = response
        .into_json()
        .map_err(|e| RpcError::new("host", e.to_string()))?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(RpcError::new(if status == 401 { "auth" } else { "host" }, error));
    }
    if status != 200 {
        return Err(RpcError::new("host", format!("HTTP {status}")));
    }
    Ok(value.get("result").cloned().unwrap_or(Value::Null))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, RpcError> + Send + 'static,
) -> Result<T, RpcError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| RpcError::new("host", e.to_string()))?
}

fn load(path: &Path) -> Option<Connection> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn save(path: &Path, connection: Option<&Connection>) -> Result<(), RpcError> {
    let Some(connection) = connection else {
        let _ = fs::remove_file(path);
        return Ok(());
    };
    let io = |e: std::io::Error| RpcError::new("host", e.to_string());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io)?;
    }
    fs::write(path, serde_json::to_vec(connection).unwrap_or_default()).map_err(io)?;
    // ponytail: 放在 app 私有目录里，安卓沙盒别的 app 读不到；要防 root 再换 Android Keystore。
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(io)?;
    }
    Ok(())
}

#[tauri::command]
fn connection(store: State<Store>) -> Option<ConnectionInfo> {
    store.connection.lock().unwrap().as_ref().map(ConnectionInfo::from)
}

/// 用地址和凭据问一次主机是谁，对上了才存下来。
#[tauri::command]
async fn pair(store: State<'_, Store>, url: String, token: String) -> Result<ConnectionInfo, RpcError> {
    let url = url.trim().trim_end_matches('/').to_string();
    let token = token.trim().to_string();
    let (agent, u, t) = (store.agent.clone(), url.clone(), token.clone());
    let host = blocking(move || {
        post(&agent, &u, &t, json!({ "version": PROTOCOL_VERSION, "method": "environment.describe", "params": {} }))
    })
    .await?;
    if host["protocolVersion"].as_u64() != Some(PROTOCOL_VERSION) {
        return Err(RpcError::new("protocol", format!("Host protocol {}", host["protocolVersion"])));
    }
    let connection = Connection {
        url,
        token,
        environment_id: host["environmentId"].as_str().unwrap_or_default().to_string(),
        name: host["name"].as_str().unwrap_or_default().to_string(),
    };
    save(&store.path, Some(&connection))?;
    let info = ConnectionInfo::from(&connection);
    *store.connection.lock().unwrap() = Some(connection);
    Ok(info)
}

#[tauri::command]
fn forget(store: State<Store>) -> Result<(), RpcError> {
    save(&store.path, None)?;
    *store.connection.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn host_rpc(store: State<'_, Store>, method: String, params: Value) -> Result<Value, RpcError> {
    let connection = store.connected()?;
    let agent = store.agent.clone();
    blocking(move || {
        post(&agent, &connection.url, &connection.token, json!({
            "version": PROTOCOL_VERSION,
            "environmentId": connection.environment_id,
            "method": method,
            "params": params,
        }))
    })
    .await
}

/// 会话里的一个文件：取到手机缓存里（要时才去取），返回文件信息和缓存里的路径。source = mirror（电脑上的会话）/ host（主机上的）。
/// preview = 图片要缩小版；cached = 缓存里有就直接给、不连网（界面先显示，再用 cached = false 问一次变没变）。
#[tauri::command]
async fn file_info(store: State<'_, Store>, source: String, id: String, path: String, preview: Option<bool>, cached: Option<bool>) -> Result<files::FileInfo, RpcError> {
    let connection = store.connected()?;
    let (agent, root) = (store.agent.clone(), store.files.clone());
    let source = if source == "host" { "host" } else { "mirror" };
    let mode = if cached.unwrap_or(false) { files::Mode::Cached } else { files::Mode::Check };
    blocking(move || files::ensure(&agent, &connection, &root, source, &id, &path, preview.unwrap_or(false), mode)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("connection.json");
            let agent = ureq::AgentBuilder::new()
                // 手机走 4G、Tailscale 走海外中继时，建连有时要十来秒
                .timeout_connect(Duration::from_secs(15))
                // 主机自己 20 秒超时；走 Tailscale 海外中继时一个大会话要传十几秒，多留一点
                .timeout_read(Duration::from_secs(45))
                .timeout_write(Duration::from_secs(10))
                .build();
            let files = app.path().app_cache_dir()?.join("files");
            files::prune(&files);
            app.manage(Store { connection: Mutex::new(load(&path)), path, agent, files });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(files::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            let query = request.uri().query().map(str::to_string);
            tauri::async_runtime::spawn_blocking(move || {
                let store = app.state::<Store>();
                let connection = store.connection.lock().unwrap().clone();
                responder.respond(files::serve(&store.agent, connection, &store.files, &path, query.as_deref()));
            });
        })
        .invoke_handler(tauri::generate_handler![connection, pair, forget, host_rpc, file_info])
        .run(tauri::generate_context!())
        .expect("error while running Soloyard mobile");
}
