import Foundation
import Combine

@MainActor
public final class VaultStore: ObservableObject, RelayClientDelegate {
    @Published public private(set) var board: DaysBoardRecord?
    @Published public private(set) var inbox: [CaptureItem] = []
    @Published public private(set) var tasks: [TaskRecord] = []
    @Published public private(set) var pendingWrites: [RelayWrite] = []

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public init() {}

    public func enqueue(channel: String, args: [JSONValue]) -> RelayWrite {
        let write = RelayWrite(
            writeId: UUID().uuidString,
            targetChannel: channel,
            args: args,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
        pendingWrites.append(write)
        return write
    }

    public nonisolated func relayClient(_ client: RelayClient, didReceive envelope: MessageEnvelope) {
        Task { @MainActor in
            self.applyEvent(envelope)
        }
    }

    public nonisolated func relayClient(_ client: RelayClient, didReceive snapshot: RelaySnapshot) {
        Task { @MainActor in
            self.applySnapshot(snapshot)
        }
    }

    public nonisolated func relayClient(_ client: RelayClient, didReceive ack: RelayAck) {
        Task { @MainActor in
            if case .write(let writeId, let status, _) = ack, status == .applied {
                self.pendingWrites.removeAll { $0.writeId == writeId }
            }
        }
    }

    private func applySnapshot(_ snapshot: RelaySnapshot) {
        switch snapshot.kind {
        case .day:
            board = try? decode(DaysBoardRecord.self, from: snapshot.payload)
        case .inbox:
            inbox = (try? decode([CaptureItem].self, from: snapshot.payload)) ?? inbox
        case .tasks:
            tasks = (try? decode([TaskRecord].self, from: snapshot.payload)) ?? tasks
        }
    }

    private func applyEvent(_ envelope: MessageEnvelope) {
        // v1 refreshes from snapshots/explicit reads after change events.
        // The event channel is still surfaced here so views can trigger targeted reloads.
        _ = envelope
    }

    private func decode<T: Decodable>(_ type: T.Type, from value: JSONValue) throws -> T {
        try decoder.decode(T.self, from: encoder.encode(value))
    }
}
