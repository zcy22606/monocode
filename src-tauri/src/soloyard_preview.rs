//! Soloyard: serves project files to the file preview frames (HTML pages and
//! PDFs) at `soloyardpreview://localhost/<root>/<path>`. `<root>` is the
//! base64url project folder and a request only resolves inside it, so a page
//! loads its own CSS, scripts and images but nothing else on disk.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use std::path::{Path, PathBuf};
use tauri::http::{Method, Request, Response};

pub const SCHEME: &str = "soloyardpreview";

// ponytail: whole-file reads, no Range support; stream if big media in previews matters.
const MAX_BYTES: u64 = 256 * 1024 * 1024;

/// Every page runs in an opaque-origin sandbox, like the artifact frames: its
/// scripts run and public CDNs load, but it cannot fetch, submit forms or
/// reach the app. Scripts and styles may also come from the project itself.
const SANDBOX_CSP: &str = "sandbox allow-scripts; default-src 'none'; \
    script-src soloyardpreview: http://soloyardpreview.localhost 'unsafe-inline' 'unsafe-eval' https:; \
    style-src soloyardpreview: http://soloyardpreview.localhost 'unsafe-inline' https:; \
    img-src soloyardpreview: http://soloyardpreview.localhost data: blob: https:; \
    font-src soloyardpreview: http://soloyardpreview.localhost data: https:; \
    media-src soloyardpreview: http://soloyardpreview.localhost data: blob: https:; \
    frame-src soloyardpreview: http://soloyardpreview.localhost; \
    worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

pub fn serve(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let status = |code: u16| {
        Response::builder()
            .status(code)
            .body(Vec::new())
            .unwrap_or_default()
    };
    if request.method() != Method::GET {
        return status(405);
    }
    let Some(file) = resolve(request.uri().path()) else {
        return status(404);
    };
    if std::fs::metadata(&file).map_or(true, |meta| meta.len() > MAX_BYTES) {
        return status(413);
    }
    let Ok(body) = std::fs::read(&file) else {
        return status(404);
    };
    let mime = mime_for(&file);
    let mut response = Response::builder()
        .status(200)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        // Module scripts and fonts load in CORS mode from the sandbox's opaque origin.
        .header("Access-Control-Allow-Origin", "*");
    // The PDF viewer is a plugin, which a sandbox disables. A PDF runs no page script.
    if mime != "application/pdf" {
        response = response.header("Content-Security-Policy", SANDBOX_CSP);
    }
    response.body(body).unwrap_or_else(|_| status(500))
}

/// `/<base64url root>/<percent-encoded path>` → a file inside that root.
fn resolve(uri_path: &str) -> Option<PathBuf> {
    let (token, rest) = uri_path.trim_start_matches('/').split_once('/')?;
    let root = String::from_utf8(URL_SAFE_NO_PAD.decode(token).ok()?).ok()?;
    let root = std::fs::canonicalize(root).ok()?;
    let file = std::fs::canonicalize(root.join(percent_decode(rest)?)).ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            out.push(u8::from_str_radix(value.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "pdf" => "application/pdf",
        "wasm" => "application/wasm",
        "xml" => "application/xml",
        "txt" | "md" | "csv" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(path: &str) -> Response<Vec<u8>> {
        serve(
            &Request::builder()
                .uri(format!("soloyardpreview://localhost{path}"))
                .body(Vec::new())
                .unwrap(),
        )
    }

    #[test]
    fn serves_files_inside_the_root_only() {
        let base = std::env::temp_dir().join(format!("soloyard-preview-{}", std::process::id()));
        let root = base.join("proj");
        std::fs::create_dir_all(root.join("页面")).unwrap();
        std::fs::write(root.join("页面/a b.html"), "<p>hi</p>").unwrap();
        std::fs::write(root.join("doc.pdf"), "%PDF-1.4").unwrap();
        std::fs::write(base.join("secret.txt"), "no").unwrap();
        let token = URL_SAFE_NO_PAD.encode(root.to_str().unwrap());

        let page = get(&format!("/{token}/%E9%A1%B5%E9%9D%A2/a%20b.html"));
        assert_eq!(page.status(), 200);
        assert_eq!(page.body(), b"<p>hi</p>");
        assert!(page.headers()["Content-Security-Policy"]
            .to_str()
            .unwrap()
            .starts_with("sandbox allow-scripts;"));

        let pdf = get(&format!("/{token}/doc.pdf"));
        assert_eq!(pdf.headers()["Content-Type"], "application/pdf");
        assert!(pdf.headers().get("Content-Security-Policy").is_none());

        assert_eq!(get(&format!("/{token}/%2E%2E/secret.txt")).status(), 404);
        assert_eq!(get(&format!("/{token}/missing.html")).status(), 404);
        assert_eq!(get("/not-a-token/doc.pdf").status(), 404);
        std::fs::remove_dir_all(base).unwrap();
    }
}
