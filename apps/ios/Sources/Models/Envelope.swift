import Foundation

public enum MessageType: String, Codable {
    case handshake
    case handshakeAck = "handshake_ack"
    case request
    case response
    case event
    case error
    case sequenceAck = "sequence_ack"
}

public struct MessageEnvelope: Codable, Identifiable {
    public var id: String
    public var type: MessageType
    public var channel: String?
    public var args: [JSONValue]?
    public var result: JSONValue?
    public var error: WireError?
    public var protocolVersion: String?
    public var token: String?
    public var clientId: String?
    public var serverId: String?
    public var seq: Int?
    public var lastSeq: Int?
    public var reconnectClientId: String?
    public var reconnected: Bool?
    public var stale: Bool?

    public init(
        id: String = UUID().uuidString,
        type: MessageType,
        channel: String? = nil,
        args: [JSONValue]? = nil,
        token: String? = nil
    ) {
        self.id = id
        self.type = type
        self.channel = channel
        self.args = args
        self.token = token
    }
}

public struct WireError: Codable, Error {
    public var code: String
    public var message: String
    public var data: JSONValue?
}

public enum JSONValue: Codable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}
