import Foundation

public enum PairingError: Error {
    case invalidURL
    case requestFailed
}

public struct PairingPayload {
    public var relay: URL
    public var roomId: String
    public var pairingToken: String
    public var expiresAt: Date?

    public init(url: URL) throws {
        guard url.scheme == "vault-pair",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let relayValue = components.queryItems?.first(where: { $0.name == "relay" })?.value,
              let relay = URL(string: relayValue),
              let room = components.queryItems?.first(where: { $0.name == "room" })?.value,
              let token = components.queryItems?.first(where: { $0.name == "pt" })?.value else {
            throw PairingError.invalidURL
        }
        self.relay = relay
        self.roomId = room
        self.pairingToken = token
        if let exp = components.queryItems?.first(where: { $0.name == "exp" })?.value,
           let seconds = TimeInterval(exp) {
            self.expiresAt = Date(timeIntervalSince1970: seconds)
        }
    }
}

public final class PairingService {
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func complete(payload: PairingPayload, deviceName: String, kind: String) async throws -> RelayPairCompleteResponse {
        guard var components = URLComponents(url: payload.relay, resolvingAgainstBaseURL: false) else {
            throw PairingError.invalidURL
        }
        components.scheme = components.scheme == "wss" ? "https" : "http"
        components.path = "/pair/complete"
        components.queryItems = [URLQueryItem(name: "room", value: payload.roomId)]
        guard let endpoint = components.url else { throw PairingError.invalidURL }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(RelayPairCompleteRequest(
            pairingToken: payload.pairingToken,
            deviceName: deviceName,
            kind: kind
        ))

        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw PairingError.requestFailed
        }
        return try decoder.decode(RelayPairCompleteResponse.self, from: data)
    }

}
