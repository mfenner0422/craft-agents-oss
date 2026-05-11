import SwiftUI

public struct TodayView: View {
    @ObservedObject private var store: VaultStore

    public init(store: VaultStore) {
        self.store = store
    }

    public var body: some View {
        List {
            Section("Today") {
                ForEach(store.board?.tasks.today ?? []) { task in
                    TaskRow(task: task)
                }
            }
            Section("Next") {
                ForEach(store.board?.tasks.next ?? []) { task in
                    TaskRow(task: task)
                }
            }
            Section("Someday") {
                ForEach(store.board?.tasks.someday ?? []) { task in
                    TaskRow(task: task)
                }
            }
        }
        .navigationTitle("Today")
    }
}

private struct TaskRow: View {
    let task: DayTask

    var body: some View {
        HStack {
            Image(systemName: iconName)
            Text(task.text)
        }
    }

    private var iconName: String {
        switch task.status {
        case .completed: return "checkmark.circle.fill"
        case .inProgress: return "slash.circle"
        case .delegated: return "arrowshape.turn.up.right.circle"
        case .canceled: return "minus.circle"
        case .todo: return "circle"
        }
    }
}
