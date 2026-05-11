import Foundation
import Security

public final class KeychainStore {
    private let service: String
    private let accessGroup: String?

    public init(service: String = "craft.vault.relay", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func saveToken(_ token: String, roomId: String, deviceId: String) throws {
        let account = "\(roomId):\(deviceId)"
        let data = Data(token.utf8)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    public func token(roomId: String, deviceId: String) throws -> String? {
        let account = "\(roomId):\(deviceId)"
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw KeychainError.status(status) }
        return String(data: data, encoding: .utf8)
    }

    public enum KeychainError: Error {
        case status(OSStatus)
    }
}
