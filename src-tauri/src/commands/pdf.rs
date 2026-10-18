//! Render export HTML into US Letter PDF bytes.
//!
//! A hidden WKWebView loads the HTML and prints it to a file with an 8.5×11
//! inch paper size. The main webview is left alone.

/// US Letter, in PostScript points.
const LETTER_WIDTH: f64 = 612.0;
const LETTER_HEIGHT: f64 = 792.0;
/// 0.75 inch, so the text is not against the paper edge.
const LETTER_MARGIN: f64 = 54.0;

use std::cell::RefCell;
use std::ffi::c_void;
use std::rc::Rc;
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::{MainThreadMarker, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSData, NSError, NSString};
#[cfg(target_os = "macos")]
use objc2_web_kit::{WKPDFConfiguration, WKWebView, WKWebViewConfiguration};

#[cfg(target_os = "macos")]
#[link(name = "PDFKit", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRunLoopRunInMode(
        mode: *const c_void,
        seconds: f64,
        return_after_source_handled: u8,
    ) -> i32;
    static kCFRunLoopDefaultMode: *const c_void;
}

#[cfg(target_os = "macos")]
fn spin(seconds: f64) {
    unsafe {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, seconds, 0);
    }
}

#[cfg(target_os = "macos")]
fn wait_until(timeout: Duration, mut done: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while !done() {
        if start.elapsed() > timeout {
            return false;
        }
        spin(0.05);
    }
    true
}

/// Load `html` and return PDF bytes. `host` is the app NSWindow, used only so
/// WebKit has a view hierarchy to lay the page out in. The view sits outside
/// the window and is removed before this returns.
#[cfg(target_os = "macos")]
pub fn render_html_to_pdf(html: &str, host: Option<*mut c_void>) -> Result<Vec<u8>, String> {
    let mtm = MainThreadMarker::new().ok_or("PDF render must run on the main thread")?;
    let config = unsafe { WKWebViewConfiguration::init(WKWebViewConfiguration::alloc(mtm)) };
    // Letter width. Height grows to the note so the print job can paginate it.
    let frame = CGRect::new(
        CGPoint::new(4000.0, 0.0),
        CGSize::new(LETTER_WIDTH, LETTER_HEIGHT),
    );
    let web =
        unsafe { WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config) };

    if let Some(win) = host {
        if !win.is_null() {
            let window = unsafe { &*(win as *const AnyObject) };
            let content: *mut AnyObject = unsafe { msg_send![window, contentView] };
            if !content.is_null() {
                let content = unsafe { &*content };
                // NSWindowBelow (-1) keeps the capture view under the app webview.
                let _: () = unsafe {
                    msg_send![
                        content,
                        addSubview: &*web,
                        positioned: -1isize,
                        relativeTo: std::ptr::null::<AnyObject>()
                    ]
                };
            }
        }
    }
    let _detach = Detach(&web);

    let html = NSString::from_str(html);
    unsafe {
        web.loadHTMLString_baseURL(&html, None);
    }
    if !wait_until(Duration::from_secs(8), || unsafe { !web.isLoading() }) {
        return Err("PDF render timed out waiting for the note".into());
    }
    spin(0.05);

    paginate_letter_pdf(&web, mtm)
}

/// Lay the note out as 8.5×11 pages and return one PDF.
#[cfg(target_os = "macos")]
fn paginate_letter_pdf(web: &WKWebView, mtm: MainThreadMarker) -> Result<Vec<u8>, String> {
    let pages = eval_number(web, &paginate_script())?.max(1.0).round() as usize;
    let fitted = CGRect::new(
        CGPoint::new(4000.0, 0.0),
        CGSize::new(LETTER_WIDTH, LETTER_HEIGHT * pages as f64),
    );
    unsafe {
        let _: () = msg_send![web, setFrame: fitted];
    }
    spin(0.05);

    let mut slices = Vec::with_capacity(pages);
    for index in 0..pages {
        let rect = CGRect::new(
            CGPoint::new(0.0, LETTER_HEIGHT * index as f64),
            CGSize::new(LETTER_WIDTH, LETTER_HEIGHT),
        );
        slices.push(capture_rect(web, mtm, rect)?);
    }
    merge_pdf_pages(&slices)
}

#[cfg(target_os = "macos")]
fn paginate_script() -> String {
    format!(
        r#"
(() => {{
  const PAGE_W = {width}, PAGE_H = {height}, MARGIN = {margin};
{rest}"#,
        width = LETTER_WIDTH,
        height = LETTER_HEIGHT,
        margin = LETTER_MARGIN,
        rest = PAGINATE_JS_REST,
    )
}

#[cfg(target_os = "macos")]
const PAGINATE_JS_REST: &str = r#"
  const INNER = PAGE_H - MARGIN * 2;
  const content = document.querySelector(".content") || document.body;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.height + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0);
  };
  const splitText = (el) => {
    const words = (el.innerText || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [el];
    const probe = document.createElement(el.tagName);
    probe.style.cssText = "width:" + (PAGE_W - MARGIN * 2) + "px;margin:0;";
    document.body.appendChild(probe);
    const pieces = [];
    let buf = [];
    const flush = (words) => {
      const piece = document.createElement(el.tagName);
      piece.textContent = words.join(" ");
      pieces.push(piece);
    };
    for (const word of words) {
      buf.push(word);
      probe.textContent = buf.join(" ");
      if (box(probe) > INNER && buf.length > 1) {
        buf.pop();
        flush(buf);
        buf = [word];
      }
    }
    if (buf.length) flush(buf);
    probe.remove();
    return pieces.length ? pieces : [el];
  };
  const blocks = [];
  const walk = (el) => {
    if (box(el) <= INNER || el.children.length === 0) {
      if (box(el) > INNER && el.children.length === 0) blocks.push(...splitText(el));
      else blocks.push(el);
      return;
    }
    for (const child of [...el.children]) walk(child);
  };
  for (const child of [...content.children]) walk(child);
  const pages = [];
  let page = document.createElement("div");
  let used = 0;
  const pushPage = () => { pages.push(page); page = document.createElement("div"); used = 0; };
  if (!blocks.length) pages.push(page);
  for (const el of blocks) {
    const h = box(el);
    if (used > 0 && used + h > INNER) pushPage();
    page.appendChild(el);
    used += h;
  }
  if (page.childNodes.length) pages.push(page);
  const root = document.createElement("div");
  for (const sheet of pages) {
    sheet.style.cssText = "width:" + PAGE_W + "px;height:" + PAGE_H + "px;padding:" + MARGIN + "px;box-sizing:border-box;overflow:hidden;background:#fff;";
    root.appendChild(sheet);
  }
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  document.body.appendChild(root);
  return pages.length || 1;
})()
"#;

#[cfg(target_os = "macos")]
fn capture_rect(web: &WKWebView, mtm: MainThreadMarker, rect: CGRect) -> Result<Vec<u8>, String> {
    let pdf_config = unsafe { WKPDFConfiguration::init(WKPDFConfiguration::alloc(mtm)) };
    unsafe { pdf_config.setRect(rect) };
    let slot: Rc<RefCell<Option<Result<Vec<u8>, String>>>> = Rc::new(RefCell::new(None));
    let slot_for_block = Rc::clone(&slot);
    let block = block2::RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
        *slot_for_block.borrow_mut() = Some(nsdata_to_vec(data, error));
    });
    unsafe {
        web.createPDFWithConfiguration_completionHandler(Some(&pdf_config), &block);
    }
    if !wait_until(Duration::from_secs(8), || slot.borrow().is_some()) {
        return Err("PDF render timed out".into());
    }
    let captured = slot.borrow().clone();
    captured.unwrap_or_else(|| Err("PDF render produced no data".into()))
}

#[cfg(target_os = "macos")]
fn nsdata_to_vec(data: *mut NSData, error: *mut NSError) -> Result<Vec<u8>, String> {
    if !error.is_null() {
        let message: Retained<NSString> = unsafe { msg_send![error, localizedDescription] };
        return Err(message.to_string());
    }
    if data.is_null() {
        return Err("PDF render returned no data".into());
    }
    let data = unsafe { &*data };
    let len = data.length() as usize;
    if len < 5 {
        return Err("PDF render returned an empty file".into());
    }
    let mut buf = vec![0u8; len];
    unsafe {
        let _: () = msg_send![data, getBytes: buf.as_mut_ptr(), length: len];
    }
    if &buf[..4] != b"%PDF" {
        return Err("PDF render did not produce a PDF".into());
    }
    Ok(buf)
}

/// Join single-page PDFs into one document. Each page keeps its own media box.
#[cfg(target_os = "macos")]
fn merge_pdf_pages(pages: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyClass;
    if pages.is_empty() {
        return Err("PDF render produced no pages".into());
    }
    if pages.len() == 1 {
        return Ok(pages[0].clone());
    }
    let doc_cls = AnyClass::get(c"PDFDocument").ok_or("PDFDocument is unavailable")?;
    let data_cls = AnyClass::get(c"NSData").ok_or("NSData is unavailable")?;
    let combined: Retained<AnyObject> = unsafe {
        let allocated = msg_send![doc_cls, alloc];
        msg_send![allocated, init]
    };
    for (index, bytes) in pages.iter().enumerate() {
        let nsdata: Retained<AnyObject> =
            unsafe { msg_send![data_cls, dataWithBytes: bytes.as_ptr(), length: bytes.len()] };
        let one: Retained<AnyObject> = unsafe {
            let allocated = msg_send![doc_cls, alloc];
            msg_send![allocated, initWithData: &*nsdata]
        };
        let page: *mut AnyObject = unsafe { msg_send![&*one, pageAtIndex: 0usize] };
        if page.is_null() {
            return Err("PDF render produced a page that could not be read".into());
        }
        unsafe {
            let _: () = msg_send![&*combined, insertPage: page, atIndex: index];
        }
    }
    let out: *mut AnyObject = unsafe { msg_send![&*combined, dataRepresentation] };
    if out.is_null() {
        return Err("PDF render could not assemble the pages".into());
    }
    nsdata_to_vec(out.cast(), std::ptr::null_mut())
}

#[cfg(target_os = "macos")]
struct Detach<'a>(&'a WKWebView);

#[cfg(target_os = "macos")]
impl Drop for Detach<'_> {
    fn drop(&mut self) {
        unsafe {
            let _: () = msg_send![&*self.0, removeFromSuperview];
        }
    }
}

#[cfg(target_os = "macos")]
fn eval_number(web: &WKWebView, script: &str) -> Result<f64, String> {
    let slot: Rc<RefCell<Option<Result<f64, String>>>> = Rc::new(RefCell::new(None));
    let slot_for_block = Rc::clone(&slot);
    let js = NSString::from_str(script);
    let block = block2::RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
        if !error.is_null() {
            let message: Retained<NSString> = unsafe { msg_send![error, localizedDescription] };
            *slot_for_block.borrow_mut() = Some(Err(message.to_string()));
            return;
        }
        if value.is_null() {
            *slot_for_block.borrow_mut() = Some(Err("PDF pagination returned nothing".into()));
            return;
        }
        let measured: f64 = unsafe { msg_send![value, doubleValue] };
        *slot_for_block.borrow_mut() = Some(Ok(measured));
    });
    unsafe {
        web.evaluateJavaScript_completionHandler(&js, Some(&block));
    }
    if !wait_until(Duration::from_secs(8), || slot.borrow().is_some()) {
        return Err("PDF pagination timed out".into());
    }
    let result = slot.borrow().clone();
    result.unwrap_or_else(|| Err("PDF pagination returned nothing".into()))
}

#[cfg(not(target_os = "macos"))]
pub fn render_html_to_pdf(_html: &str, _host: Option<*mut c_void>) -> Result<Vec<u8>, String> {
    Err("PDF export requires macOS".into())
}

/// Render standalone HTML to PDF bytes on the main thread.
#[tauri::command]
pub async fn render_html_pdf(app: tauri::AppHandle, html: String) -> Result<Vec<u8>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let window = {
        use tauri::Manager;
        app.get_webview_window("main")
    };
    app.run_on_main_thread(move || {
        let host = window.as_ref().and_then(|w| w.ns_window().ok());
        let result = render_html_to_pdf(&html, host);
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| format!("PDF render failed: {e}"))?
}
