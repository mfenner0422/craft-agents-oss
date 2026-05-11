import Foundation

public enum RelayChannels {
    public static let write = "relay:write"
    public static let snapshot = "relay:snapshot"
    public static let event = "relay:event"
    public static let ack = "relay:ack"
    public static let devicePaired = "relay:devicePaired"
}

public struct RelayWrite: Codable, Identifiable {
    public var id: String { writeId }
    public var writeId: String
    public var targetChannel: String
    public var args: [JSONValue]
    public var createdAt: String
}

public struct RelayPairCompleteRequest: Codable {
    public var pairingToken: String
    public var deviceName: String
    public var kind: String

    public init(pairingToken: String, deviceName: String, kind: String) {
        self.pairingToken = pairingToken
        self.deviceName = deviceName
        self.kind = kind
    }
}

public struct RelayPairCompleteResponse: Codable {
    public var deviceId: String
    public var deviceToken: String
    public var roomId: String
    public var relayWsUrl: String
}

public struct RelaySnapshot: Codable {
    public var kind: Kind
    public var key: String?
    public var payload: JSONValue
    public var version: Int
    public var capturedAt: String

    public enum Kind: String, Codable {
        case tasks
        case inbox
        case day
    }
}

public struct RelayEvent: Codable {
    public var originDeviceId: String
    public var serverSeq: Int
    public var envelope: MessageEnvelope
}

public enum RelayAck: Codable {
    case event(upToSeq: Int)
    case write(writeId: String, status: WriteStatus, error: WireError?)

    public enum WriteStatus: String, Codable {
        case applied
        case rejected
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case upToSeq
        case writeId
        case status
        case error
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "event":
            self = .event(upToSeq: try container.decode(Int.self, forKey: .upToSeq))
        case "write":
            self = .write(
                writeId: try container.decode(String.self, forKey: .writeId),
                status: try container.decode(WriteStatus.self, forKey: .status),
                error: try container.decodeIfPresent(WireError.self, forKey: .error)
            )
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "Unknown ack kind")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .event(let upToSeq):
            try container.encode("event", forKey: .kind)
            try container.encode(upToSeq, forKey: .upToSeq)
        case .write(let writeId, let status, let error):
            try container.encode("write", forKey: .kind)
            try container.encode(writeId, forKey: .writeId)
            try container.encode(status, forKey: .status)
            try container.encodeIfPresent(error, forKey: .error)
        }
    }
}
