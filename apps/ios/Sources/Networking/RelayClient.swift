import Foundation

public protocol RelayClientDelegate: AnyObject {
    func relayClient(_ client: RelayClient, didReceive envelope: MessageEnvelope)
    func relayClient(_ client: RelayClient, didReceive snapshot: RelaySnapshot)
    func relayClient(_ client: RelayClient, didReceive ack: RelayAck)
}

public final class RelayClient {
    public weak var delegate: RelayClientDelegate?

    private let url: URL
    private let token: String
    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var lastSeenSeq = 0

    public init(url: URL, token: String, session: URLSession = .shared) {
        self.url = url
        self.token = token
        self.session = session
    }

    public func connect() {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        send(MessageEnvelope(type: .handshake, args: nil, token: token))
        receiveLoop()
    }

    public func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    public func send(_ envelope: MessageEnvelope) {
        guard let data = try? encoder.encode(envelope),
              let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    public func sendWrite(_ write: RelayWrite) {
        guard let payload = try? jsonValue(write) else { return }
        send(MessageEnvelope(type: .event, channel: RelayChannels.write, args: [payload]))
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            defer { self.receiveLoop() }

            guard case .success(let message) = result else { return }
            let text: String
            switch message {
            case .string(let value): text = value
            case .data(let data): text = String(decoding: data, as: UTF8.self)
            @unknown default: return
            }
            guard let data = text.data(using: .utf8),
                  let envelope = try? self.decoder.decode(MessageEnvelope.self, from: data) else { return }
            self.handle(envelope)
        }
    }

    private func handle(_ envelope: MessageEnvelope) {
        switch envelope.channel {
        case RelayChannels.event:
            guard let value = envelope.args?.first,
                  let event = try? decode(RelayEvent.self, from: value),
                  event.serverSeq > lastSeenSeq else { return }
            lastSeenSeq = event.serverSeq
            delegate?.relayClient(self, didReceive: event.envelope)
            sendAck(.event(upToSeq: lastSeenSeq))
        case RelayChannels.snapshot:
            guard let value = envelope.args?.first,
                  let snapshot = try? decode(RelaySnapshot.self, from: value) else { return }
            delegate?.relayClient(self, didReceive: snapshot)
        case RelayChannels.ack:
            guard let value = envelope.args?.first,
                  let ack = try? decode(RelayAck.self, from: value) else { return }
            delegate?.relayClient(self, didReceive: ack)
        default:
            delegate?.relayClient(self, didReceive: envelope)
        }
    }

    private func sendAck(_ ack: RelayAck) {
        guard let payload = try? jsonValue(ack) else { return }
        send(MessageEnvelope(type: .event, channel: RelayChannels.ack, args: [payload]))
    }

    private func decode<T: Decodable>(_ type: T.Type, from value: JSONValue) throws -> T {
        try decoder.decode(T.self, from: encoder.encode(value))
    }

    private func jsonValue<T: Encodable>(_ value: T) throws -> JSONValue {
        try decoder.decode(JSONValue.self, from: encoder.encode(value))
    }
}
