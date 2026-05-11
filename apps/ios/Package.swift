// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VaultCompanion",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "VaultCompanion", targets: ["VaultCompanion"])
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.0.0")
    ],
    targets: [
        .target(
            name: "VaultCompanion",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift")
            ],
            path: "Sources"
        )
    ]
)
