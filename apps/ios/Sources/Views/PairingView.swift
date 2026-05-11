import SwiftUI

public struct PairingView: View {
    @State private var pairingURL = ""

    public init() {}

    public var body: some View {
        Form {
            Section {
                TextField("vault-pair://...", text: $pairingURL)
            }
            Section {
                Button("Pair") {
                    // QR scanning and PairingService wiring sit in the app target.
                }
                .disabled(pairingURL.isEmpty)
            }
        }
        .navigationTitle("Pair Vault")
    }
}
