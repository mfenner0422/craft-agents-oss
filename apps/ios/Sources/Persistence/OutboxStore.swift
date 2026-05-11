import Foundation
import GRDB

public struct PendingWrite: Codable, FetchableRecord, PersistableRecord, Identifiable {
    public static let databaseTableName = "outbox"

    public var id: String { writeId }
    public var writeId: String
    public var channel: String
    public var argsJSON: String
    public var attempts: Int
    public var createdAt: String
}

public final class OutboxStore {
    private let db: DatabaseQueue

    public init(path: String) throws {
        db = try DatabaseQueue(path: path)
        try migrator.migrate(db)
    }

    public func insert(_ write: RelayWrite) throws {
        let argsData = try JSONEncoder().encode(write.args)
        let argsJSON = String(decoding: argsData, as: UTF8.self)
        let pending = PendingWrite(
            writeId: write.writeId,
            channel: write.targetChannel,
            argsJSON: argsJSON,
            attempts: 0,
            createdAt: write.createdAt
        )
        try db.write { database in try pending.insert(database) }
    }

    public func all() throws -> [PendingWrite] {
        try db.read { database in try PendingWrite.fetchAll(database) }
    }

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            try db.create(table: "outbox", ifNotExists: true) { table in
                table.column("writeId", .text).primaryKey()
                table.column("channel", .text).notNull()
                table.column("argsJSON", .text).notNull()
                table.column("attempts", .integer).notNull().defaults(to: 0)
                table.column("createdAt", .text).notNull()
            }
        }
        return migrator
    }
}
