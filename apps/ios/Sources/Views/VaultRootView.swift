import SwiftUI

public struct VaultRootView: View {
    @StateObject private var store = VaultStore()

    public init() {}

    public var body: some View {
        TabView {
            NavigationStack {
                TodayView(store: store)
            }
            .tabItem { Label("Days", systemImage: "calendar") }

            NavigationStack {
                InboxView(store: store)
            }
            .tabItem { Label("Inbox", systemImage: "tray") }

            NavigationStack {
                NotesView(board: store.board, kind: .journal)
            }
            .tabItem { Label("Journal", systemImage: "book") }

            NavigationStack {
                PairingView()
            }
            .tabItem { Label("Settings", systemImage: "gear") }
        }
    }
}
