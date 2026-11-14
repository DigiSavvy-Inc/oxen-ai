// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "OxenStudio",
    platforms: [.macOS("13.3")],
    targets: [
        .executableTarget(name: "OxenStudio", path: "Sources/OxenStudio")
    ]
)
