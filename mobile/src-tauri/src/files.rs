//! 会话里的文件（SOL-92）：`soloyardfile://localhost/<m|h>/<会话 id>/<路径>`（安卓上是 `http://soloyardfile.localhost/...`）。
//! m = 电脑上的会话（网关交给那台电脑读），h = 主机上的会话（网关自己读）。
//! 取回来存进缓存目录 `files/<哈希>/<文件名>`，再打开时带着 mtime 问一下变没变；连不上时用缓存里的。
//! 网页里相对路径的样式、脚本、图片也从这里取，所以整套页面能看。
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::http::{Response, StatusCode};

use crate::{Connection, RpcError};

pub const SCHEME: &str = "soloyardfile";
const MAX_BYTES: u64 = 50 << 20;
/// 网页里的资源（样式、脚本、图片）取过以后这么久内直接用缓存，不再去问变没变：
/// 走海外中继时问一次要几秒，一个页面几十个资源。页面本身每次打开都会在后台问一次（Check）。
const FRESH: Duration = Duration::from_secs(10 * 60);
/// 缓存里一周没打开过的文件，启动时删掉。
const KEEP: Duration = Duration::from_secs(7 * 86_400);

/// 和电脑上的 HTML 预览一样（soloyard_preview.rs）：页面在不透明源的沙箱里，脚本能跑、公共 CDN 能加载，
/// 不能发请求、不能提交表单、碰不到 app。
const SANDBOX_CSP: &str = "sandbox allow-scripts; default-src 'none'; \
    script-src soloyardfile: http://soloyardfile.localhost 'unsafe-inline' 'unsafe-eval' https:; \
    style-src soloyardfile: http://soloyardfile.localhost 'unsafe-inline' https:; \
    img-src soloyardfile: http://soloyardfile.localhost data: blob: https:; \
    font-src soloyardfile: http://soloyardfile.localhost data: https:; \
    media-src soloyardfile: http://soloyardfile.localhost data: blob: https:; \
    frame-src soloyardfile: http://soloyardfile.localhost; \
    worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    name: String,
    mime: String,
    size: u64,
    mtime: u64,
    /// 文件所在机器上的路径。
    path: String,
    /// 手机缓存里的路径（分享、用其他应用打开、存到手机用）。
    #[serde(default)]
    local: String,
    #[serde(default)]
    fetched: u64,
    /// 缩小过的图（原图大小在 original_size）。
    #[serde(default)]
    preview: bool,
    #[serde(default)]
    original_size: Option<u64>,
}

/// 怎么拿：Cached = 缓存里有就直接用，不连网（先给界面显示）；Check = 一定去问变没变；Serve = 网页资源，取过不久的直接用。
#[derive(Clone, Copy, PartialEq)]
pub enum Mode {
    Cached,
    Check,
    Serve,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `/m/<id>/Users/x/a.png` → ("mirror", id, "/Users/x/a.png")；`~` 开头的原样交给那台机器展开。
fn parse(uri_path: &str) -> Option<(&'static str, String, String)> {
    let mut parts = uri_path.trim_start_matches('/').splitn(3, '/');
    let source = match parts.next()? {
        "m" => "mirror",
        "h" => "host",
        _ => return None,
    };
    let id = percent_decode(parts.next()?);
    let rest = percent_decode(parts.next()?);
    let path = if rest.starts_with("~/") { rest } else { format!("/{rest}") };
    (!id.is_empty()).then_some((source, id, path))
}

fn cache_dir(root: &Path, source: &str, id: &str, path: &str, preview: bool) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    (source, id, path, preview).hash(&mut hasher);
    root.join(format!("{:016x}", hasher.finish()))
}

fn read_meta(dir: &Path) -> Option<FileInfo> {
    serde_json::from_slice(&fs::read(dir.join("meta.json")).ok()?).ok()
}

fn write_meta(dir: &Path, info: &FileInfo) {
    let _ = fs::write(dir.join("meta.json"), serde_json::to_vec(info).unwrap_or_default());
}

enum Remote {
    Fresh(FileInfo, Vec<u8>),
    Same,
}

fn fetch_remote(agent: &ureq::Agent, connection: &Connection, source: &str, id: &str, path: &str, mtime: Option<u64>, preview: bool) -> Result<Remote, RpcError> {
    // 走中继时偶尔一次连不上：网络错误自动再试一次
    match fetch_once(agent, connection, source, id, path, mtime, preview) {
        Err(e) if e.kind == "network" => fetch_once(agent, connection, source, id, path, mtime, preview),
        other => other,
    }
}

fn fetch_once(agent: &ureq::Agent, connection: &Connection, source: &str, id: &str, path: &str, mtime: Option<u64>, preview: bool) -> Result<Remote, RpcError> {
    let response = agent
        .post(&format!("{}/file", connection.url.trim_end_matches('/')))
        .set("Authorization", &format!("Bearer {}", connection.token))
        .send_json(json!({ "source": source, "id": id, "path": path, "mtime": mtime, "preview": preview }));
    let response = match response {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let message = r
                .into_json::<Value>()
                .ok()
                .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| format!("HTTP {code}"));
            return Err(RpcError::new(if code == 401 { "auth" } else { "host" }, message));
        }
        Err(ureq::Error::Transport(e)) => return Err(RpcError::new("network", e.to_string())),
    };
    let info: FileInfo = response
        .header("X-Soloyard-File")
        .and_then(|h| serde_json::from_str(&percent_decode(h)).ok())
        .ok_or_else(|| RpcError::new("host", "Missing file info"))?;
    if response.status() == 304 {
        return Ok(Remote::Same);
    }
    let mut body = Vec::new();
    response
        .into_reader()
        .take(MAX_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|e| RpcError::new("network", e.to_string()))?;
    Ok(Remote::Fresh(info, body))
}

/// 拿到缓存里的文件（需要时去取，见 Mode）。连不上但缓存里有，就用缓存的。
pub fn ensure(agent: &ureq::Agent, connection: &Connection, root: &Path, source: &str, id: &str, path: &str, preview: bool, mode: Mode) -> Result<FileInfo, RpcError> {
    let dir = cache_dir(root, source, id, path, preview);
    let cached = read_meta(&dir).filter(|m| dir.join(&m.name).is_file());
    if let Some(info) = &cached {
        let fresh = now_ms().saturating_sub(info.fetched) < FRESH.as_millis() as u64;
        if mode == Mode::Cached || (mode == Mode::Serve && fresh) {
            return Ok(info.clone());
        }
    }
    let remote = fetch_remote(agent, connection, source, id, path, cached.as_ref().map(|c| c.mtime), preview);
    let io = |e: std::io::Error| RpcError::new("host", e.to_string());
    let mut info = match (remote, cached) {
        (Ok(Remote::Fresh(info, body)), old) => {
            fs::create_dir_all(&dir).map_err(io)?;
            if let Some(old) = old.filter(|o| o.name != info.name) {
                let _ = fs::remove_file(dir.join(old.name));
            }
            // 文件名来自对方：只取最后一段，不让它写到别处
            let name = Path::new(&info.name).file_name().map_or("file".into(), |n| n.to_string_lossy().into_owned());
            fs::write(dir.join(&name), body).map_err(io)?;
            FileInfo { name, ..info }
        }
        (Ok(Remote::Same), Some(old)) => old,
        (Ok(Remote::Same), None) => return Err(RpcError::new("host", "Missing cached file")),
        (Err(e), Some(old)) if e.kind == "network" => return Ok(old),
        (Err(e), _) => return Err(e),
    };
    info.fetched = now_ms();
    info.local = dir.join(&info.name).to_string_lossy().into_owned();
    write_meta(&dir, &info);
    Ok(info)
}

/// 协议的处理：网页里加载的图片、页面和它的资源、界面里 fetch 的文本都走这里。
/// query 带 preview=1 时要缩小版（看图用），带 cached=1 时缓存里有就直接用（文件页已经先取过了）。
pub fn serve(agent: &ureq::Agent, connection: Option<Connection>, root: &Path, uri_path: &str, query: Option<&str>) -> Response<Vec<u8>> {
    let has = |flag: &str| query.is_some_and(|q| q.split('&').any(|p| p == flag));
    let (preview, mode) = (has("preview=1"), if has("cached=1") { Mode::Cached } else { Mode::Serve });
    let fail = |code: StatusCode, message: &str| {
        Response::builder()
            .status(code)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Access-Control-Allow-Origin", "*")
            .body(message.as_bytes().to_vec())
            .unwrap_or_default()
    };
    let Some((source, id, path)) = parse(uri_path) else {
        return fail(StatusCode::NOT_FOUND, "Bad file address");
    };
    let Some(connection) = connection else {
        return fail(StatusCode::UNAUTHORIZED, "No host is paired");
    };
    let info = match ensure(agent, &connection, root, source, &id, &path, preview, mode) {
        Ok(info) => info,
        Err(e) => return fail(StatusCode::BAD_GATEWAY, &e.message),
    };
    let Ok(body) = fs::read(&info.local) else {
        return fail(StatusCode::NOT_FOUND, "File not found");
    };
    let mut response = Response::builder()
        .status(200)
        .header("Content-Type", info.mime.as_str())
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        // 模块脚本、字体在沙箱的不透明源里按 CORS 加载
        .header("Access-Control-Allow-Origin", "*");
    if info.mime != "application/pdf" {
        response = response.header("Content-Security-Policy", SANDBOX_CSP);
    }
    response.body(body).unwrap_or_default()
}

/// 启动时清掉一周没打开过的缓存。
pub fn prune(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let old = read_meta(&entry.path()).map_or(true, |m| now_ms().saturating_sub(m.fetched) > KEEP.as_millis() as u64);
        if old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_file_addresses() {
        assert_eq!(parse("/m/abc/Users/x/%E6%96%87%E6%A1%A3/a%20b.html").unwrap(), ("mirror", "abc".into(), "/Users/x/文档/a b.html".into()));
        assert_eq!(parse("/h/s1/~/Downloads/x.pdf").unwrap(), ("host", "s1".into(), "~/Downloads/x.pdf".into()));
        assert!(parse("/x/abc/a").is_none());
        assert!(parse("/m//a").is_none());
        assert_eq!(percent_decode("100%"), "100%");
    }
}
