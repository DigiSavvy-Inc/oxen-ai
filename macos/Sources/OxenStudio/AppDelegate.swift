import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var studio: StudioWindow?

    private var appName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? "Oxen Studio"
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = buildMenu()
        guard let url = StudioURL.saved ?? StudioURL.ask(current: nil) else {
            NSApp.terminate(nil)
            return
        }
        studio = StudioWindow(title: appName, home: url)
        studio?.show()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: Menu actions

    @objc private func openSettings() { studio?.openWebSettings() }
    @objc private func reload() { studio?.webView.reload() }
    @objc private func goHome() { studio?.loadHome() }
    @objc private func goBack() { studio?.webView.goBack() }
    @objc private func goForward() { studio?.webView.goForward() }
    @objc private func zoomIn() { studio?.zoom(by: 0.1) }
    @objc private func zoomOut() { studio?.zoom(by: -0.1) }
    @objc private func zoomReset() { studio?.zoom(by: nil) }

    @objc private func changeServer() {
        guard let url = StudioURL.ask(current: studio?.home) else { return }
        studio?.home = url
        studio?.loadHome()
    }

    // MARK: Menu

    private func buildMenu() -> NSMenu {
        let main = NSMenu()

        let appMenu = submenu(main, appName)
        appMenu.addItem(item("About \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), target: NSApp))
        appMenu.addItem(.separator())
        // The web app owns Settings; natively it finally gets the standard ⌘, chord.
        appMenu.addItem(item("Settings…", #selector(openSettings), ","))
        appMenu.addItem(item("Change Server…", #selector(changeServer)))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Hide \(appName)", #selector(NSApplication.hide(_:)), "h", target: NSApp))
        appMenu.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option], target: NSApp))
        appMenu.addItem(item("Show All", #selector(NSApplication.unhideAllApplications(_:)), target: NSApp))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit \(appName)", #selector(NSApplication.terminate(_:)), "q", target: NSApp))

        // Responder-chain items: without these, ⌘C/⌘V/⌘Z never reach the web view.
        let edit = submenu(main, "Edit")
        edit.addItem(responder("Undo", Selector(("undo:")), "z"))
        edit.addItem(responder("Redo", Selector(("redo:")), "z", [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(responder("Cut", #selector(NSText.cut(_:)), "x"))
        edit.addItem(responder("Copy", #selector(NSText.copy(_:)), "c"))
        edit.addItem(responder("Paste", #selector(NSText.paste(_:)), "v"))
        edit.addItem(responder("Select All", #selector(NSText.selectAll(_:)), "a"))

        let view = submenu(main, "View")
        view.addItem(item("Reload", #selector(reload), "r"))
        view.addItem(item("Home", #selector(goHome), "h", [.command, .shift]))
        view.addItem(item("Back", #selector(goBack), "["))
        view.addItem(item("Forward", #selector(goForward), "]"))
        view.addItem(.separator())
        view.addItem(item("Actual Size", #selector(zoomReset), "0"))
        view.addItem(item("Zoom In", #selector(zoomIn), "+"))
        view.addItem(item("Zoom Out", #selector(zoomOut), "-"))
        view.addItem(.separator())
        view.addItem(responder("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))

        let window = submenu(main, "Window")
        window.addItem(responder("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        window.addItem(responder("Zoom", #selector(NSWindow.performZoom(_:))))
        window.addItem(responder("Close", #selector(NSWindow.performClose(_:)), "w"))
        NSApp.windowsMenu = window

        return main
    }

    private func submenu(_ main: NSMenu, _ title: String) -> NSMenu {
        let holder = NSMenuItem()
        let menu = NSMenu(title: title)
        holder.submenu = menu
        main.addItem(holder)
        return menu
    }

    private func item(
        _ title: String,
        _ action: Selector,
        _ key: String = "",
        _ modifiers: NSEvent.ModifierFlags = .command,
        target: AnyObject? = nil
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target ?? self
        return item
    }

    /// Nil target: AppKit sends it down the responder chain (web view, then window).
    private func responder(
        _ title: String,
        _ action: Selector,
        _ key: String = "",
        _ modifiers: NSEvent.ModifierFlags = .command
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        return item
    }
}
