import Foundation

public enum TaskStatus: String, Codable {
    case todo
    case inProgress = "in_progress"
    case delegated
    case completed
    case canceled
}

public enum TaskListKind: String, Codable {
    case next
    case someday
}

public struct TaskRecord: Codable, Identifiable {
    public var id: String
    public var title: String
    public var status: TaskStatus
    public var day: String?
    public var slot: Int?
    public var list: TaskListKind?
    public var source: String
    public var due: String?
    public var createdAt: String
    public var updatedAt: String
    public var completedAt: String?
    public var canceledAt: String?
    public var droppedAt: String?
    public var tags: [String]
    public var body: String

    enum CodingKeys: String, CodingKey {
        case id, title, status, day, slot, list, source, due, tags, body
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case completedAt = "completed_at"
        case canceledAt = "canceled_at"
        case droppedAt = "dropped_at"
    }
}

public struct DayTask: Codable, Identifiable {
    public var id: String
    public var text: String
    public var status: TaskStatus
    public var line: String?
    public var tags: [String]?
    public var due: String?
    public var body: String?
}

public struct DayRecord: Codable {
    public var dateISO: String
    public var files: [String: String]
    public var bodies: [String: String]
}

public struct DaysBoardRecord: Codable {
    public var dateISO: String
    public var files: [String: String]
    public var bodies: [String: String]
    public var tasks: TaskGroups

    public struct TaskGroups: Codable {
        public var today: [DayTask]
        public var next: [DayTask]
        public var someday: [DayTask]
    }
}

public struct CaptureItem: Codable, Identifiable {
    public var id: String
    public var filePath: String
    public var capturedAt: String
    public var source: String
    public var url: String?
    public var title: String?
    public var tags: [String]
    public var triagedAt: String?
    public var body: String
}
