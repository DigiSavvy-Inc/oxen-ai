import AppKit

/// Which Studio deployment this app opens. A build can bake one in (Info.plist
/// `StudioURL`); otherwise the first launch asks, since every self-hoster has their own.
enum StudioURL {
    private static let key = "StudioURL"

    static var saved: URL? {
        let stored = UserDefaults.standard.string(forKey: key)
        let baked = Bundle.main.object(forInfoDictionaryKey: key) as? String
        return parse(stored) ?? parse(baked)
    }

    static func ask(current: URL?) -> URL? {
        let alert = NSAlert()
        alert.messageText = "Studio address"
        alert.informativeText = "The URL of the Oxen Studio deployment to open."
        alert.addButton(withTitle: "Open")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.placeholderString = "https://studio.example.com"
        field.stringValue = current?.absoluteString ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field

        while alert.runModal() == .alertFirstButtonReturn {
            if let url = parse(field.stringValue) {
                UserDefaults.standard.set(url.absoluteString, forKey: key)
                return url
            }
            alert.informativeText = "Enter a full address starting with https://"
        }
        return nil
    }

    /// https anywhere; plain http only for a local dev server.
    private static func parse(_ raw: String?) -> URL? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
              let url = URL(string: text), let host = url.host, !host.isEmpty
        else { return nil }
        let local = host == "localhost" || host == "127.0.0.1"
        guard url.scheme == "https" || (url.scheme == "http" && local) else { return nil }
        return url
    }
}
