import AppKit
import AuthenticationServices
import CryptoKit
import WebKit

/// GitHub sign-in through the person's real browser, where passkeys and GitHub Mobile
/// work, then a trade of the returned code for the session cookie (worker/native-auth.ts).
final class NativeSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let scheme = "oxenstudio"
    static let path = "/api/auth/github"

    private let home: URL
    private let window: NSWindow
    private var session: ASWebAuthenticationSession?

    init(home: URL, window: NSWindow) {
        self.home = home
        self.window = window
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { window }

    /// Calls back on the main thread with the session cookies, or nil if the person cancelled.
    func start(completion: @escaping (Result<[HTTPCookie]?, Error>) -> Void) {
        // PKCE: only this process knows the verifier, so a code caught by another app
        // registered for the same URL scheme cannot be redeemed.
        let verifier = Self.base64URL(Data((0..<32).map { _ in UInt8.random(in: .min ... .max) }))
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))

        guard var start = URLComponents(url: endpoint(Self.path), resolvingAgainstBaseURL: false) else { return }
        start.queryItems = [URLQueryItem(name: "native", value: challenge)]
        guard let startURL = start.url else { return }

        let session = ASWebAuthenticationSession(url: startURL, callbackURLScheme: Self.scheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.session = nil
                if let error {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    completion(cancelled ? .success(nil) : .failure(error))
                    return
                }
                let code = callback
                    .flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
                    .queryItems?.first { $0.name == "code" }?.value
                guard let code else {
                    completion(.failure(SignInError("Sign-in did not return a code.")))
                    return
                }
                self.redeem(code: code, verifier: verifier, completion: completion)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false // reuse the browser's GitHub login
        self.session = session
        session.start()
    }

    private func redeem(code: String, verifier: String, completion: @escaping (Result<[HTTPCookie]?, Error>) -> Void) {
        let url = endpoint("/api/auth/native")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("1", forHTTPHeaderField: "X-Studio-Native")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code, "verifier": verifier])

        // Ephemeral: the cookie goes to the web view's jar, not the system one.
        URLSession(configuration: .ephemeral).dataTask(with: request) { _, response, error in
            DispatchQueue.main.async {
                if let error {
                    completion(.failure(error))
                    return
                }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let headers = http.allHeaderFields as? [String: String]
                else {
                    completion(.failure(SignInError("Sign-in expired. Try again.")))
                    return
                }
                let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
                if cookies.isEmpty {
                    completion(.failure(SignInError("Studio did not return a session.")))
                } else {
                    completion(.success(cookies))
                }
            }
        }.resume()
    }

    private func endpoint(_ path: String) -> URL {
        var parts = URLComponents(url: home, resolvingAgainstBaseURL: false) ?? URLComponents()
        parts.path = path
        parts.query = nil
        return parts.url ?? home
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

struct SignInError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}
