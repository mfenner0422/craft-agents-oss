import SwiftUI

public struct NotesView: View {
    public enum Kind: String {
        case journal
        case scratch
    }

    private let board: DaysBoardRecord?
    private let kind: Kind

    public init(board: DaysBoardRecord?, kind: Kind) {
        self.board = board
        self.kind = kind
    }

    public var body: some View {
        ScrollView {
            Text(board?.bodies[kind.rawValue] ?? "")
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle(kind == .journal ? "Journal" : "Scratch")
    }
}
