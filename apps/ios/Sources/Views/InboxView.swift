import SwiftUI

public struct InboxView: View {
    @ObservedObject private var store: VaultStore

    public init(store: VaultStore) {
        self.store = store
    }

    public var body: some View {
        List(store.inbox) { item in
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title ?? item.url ?? "Untitled capture")
                    .font(.headline)
                Text(item.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
        .navigationTitle("Inbox")
    }
}
