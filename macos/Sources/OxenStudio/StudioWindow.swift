import AppKit
import WebKit

/// The one window: a web view on the Studio deployment plus the native glue a
/// browser tab would otherwise supply (downloads, file pickers, dialogs, external links).
final class StudioWindow: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let window: NSWindow
    let webView: WKWebView
    var home: URL

    private var downloads: [ObjectIdentifier: URL] = [:]
    private var signIn: NativeSignIn?

    init(title: String, home: URL) {
        self.home = home

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // keeps the session cookie between launches
        config.preferences.isElementFullscreenEnabled = true
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
        config.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15 OxenStudioMac/\(version)"

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isInspectable = true

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1360, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.minSize = NSSize(width: 420, height: 520)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("StudioWindow")
        window.isReleasedWhenClosed = false

        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    func show() {
        window.makeKeyAndOrderFront(nil)
        loadHome()
    }

    func loadHome() {
        webView.load(URLRequest(url: home))
    }

    /// nil resets to 100%.
    func zoom(by delta: CGFloat?) {
        guard let delta else { webView.pageZoom = 1; return }
        webView.pageZoom = min(3, max(0.5, webView.pageZoom + delta))
    }

    /// The web app opens Settings on ⌘⇧, — replay that chord so no web change is needed.
    func openWebSettings() {
        webView.evaluateJavaScript("""
            document.body.dispatchEvent(new KeyboardEvent("keydown", {
              code: "Comma", key: ",", metaKey: true, shiftKey: true, bubbles: true
            }));
            """)
    }

    /// Sign in through the real browser, then drop the session cookie into the web view.
    private func startSignIn() {
        guard signIn == nil else { return }
        let flow = NativeSignIn(home: home, window: window)
        signIn = flow
        flow.start { [weak self] result in
            guard let self else { return }
            self.signIn = nil
            NSApp.activate(ignoringOtherApps: true)
            switch result {
            case .success(nil):
                break // cancelled
            case .success(let cookies?):
                let store = self.webView.configuration.websiteDataStore.httpCookieStore
                let group = DispatchGroup()
                for cookie in cookies {
                    group.enter()
                    store.setCookie(cookie) { group.leave() }
                }
                group.notify(queue: .main) { self.loadHome() }
            case .failure(let error):
                let alert = NSAlert()
                alert.messageText = "Sign-in failed"
                alert.informativeText = error.localizedDescription
                alert.beginSheetModal(for: self.window)
            }
        }
    }

    private func isStudio(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.host == home.host && url.port == home.port
    }

    // MARK: Navigation

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        // Passkeys and GitHub Mobile do not work inside a web view.
        if isStudio(url), url.path == NativeSignIn.path {
            decisionHandler(.cancel)
            startSignIn()
            return
        }
        let web = url.scheme == "http" || url.scheme == "https"
        let internalScheme = web || ["about", "blob", "data"].contains(url.scheme ?? "")
        if !internalScheme {
            NSWorkspace.shared.open(url) // mailto:, etc.
            decisionHandler(.cancel)
            return
        }
        // A link clicked inside Studio that leaves it (Buy Credits, docs) belongs in the
        // browser. Redirects stay here, so the GitHub sign-in round trip is untouched.
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if web, mainFrame, navigationAction.navigationType == .linkActivated,
           isStudio(webView.url), !isStudio(url) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let attachment = disposition.lowercased().hasPrefix("attachment")
        decisionHandler(attachment || !navigationResponse.canShowMIMEType ? .download : .allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        // -999: superseded by another load. 102: the load became a download.
        if code == NSURLErrorCancelled || code == 102 { return }
        showLoadError(error.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func showLoadError(_ message: String) {
        let safe = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
        let html = """
            <!doctype html><meta name="color-scheme" content="light dark">
            <body style="font:15px -apple-system;padding:15vh 3rem;text-align:center">
            <h2 style="font-weight:600">Can’t reach Studio</h2>
            <p style="opacity:.7">\(safe)</p>
            <p><a href="\(home.absoluteString)">Try again</a></p>
            """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: New windows

    /// target=_blank and window.open: outside links go to the browser, Studio ones stay here.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if isStudio(url) {
            webView.load(navigationAction.request)
        } else {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // MARK: Downloads

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let destination = Self.unusedURL(in: folder, filename: suggestedFilename)
        downloads[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // Bounces the Downloads stack in the Dock, like Safari does.
        DistributedNotificationCenter.default().post(
            name: Notification.Name("com.apple.DownloadFileFinished"),
            object: file.path
        )
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        let alert = NSAlert()
        alert.messageText = "Download failed"
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
    }

    /// WKDownload refuses to overwrite, so pick "name 2.png" style siblings.
    static func unusedURL(in folder: URL, filename: String) -> URL {
        let clean = filename.replacingOccurrences(of: "/", with: "-")
        let base = folder.appendingPathComponent(clean.isEmpty ? "download" : clean)
        guard FileManager.default.fileExists(atPath: base.path) else { return base }
        let ext = base.pathExtension
        let stem = base.deletingPathExtension().lastPathComponent
        var n = 2
        while true {
            let name = ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)"
            let candidate = folder.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            n += 1
        }
    }

    // MARK: File picker and JS dialogs (WKWebView shows none of these by itself)

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) {
            completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }
}
