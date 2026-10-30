---
name: swift
description: Write, refactor and review Swift 5.9+ for iOS/macOS apps and Swift packages. Covers SwiftPM and Xcode project layout, optionals, protocols and value types, structured concurrency (async/await, actors, Sendable), SwiftUI vs UIKit conventions, XCTest and Swift Testing, SwiftLint/SwiftFormat, and xcodebuild/swift CLI. Use when editing .swift files or a project with Package.swift, .xcodeproj, .xcworkspace or Podfile.
---

# Swift

Assumes Swift 5.9+ (macros, `if`/`switch` expressions, parameter packs) with Xcode 15+. Swift 6 language mode turns strict concurrency warnings into errors; check `swiftLanguageVersions`/`SWIFT_VERSION` and `SWIFT_STRICT_CONCURRENCY` before relying on either behaviour.

## When to use

- Editing or creating `.swift` files, `Package.swift`, `.xcodeproj`/`.xcworkspace` settings, `Podfile`, `.swiftlint.yml`, `.swiftformat`.
- Adding targets, dependencies, tests or CI steps to an Apple-platform or server-side Swift project.
- Reviewing Swift for optional handling, concurrency safety, value/reference semantics or API design.

## Project conventions to detect first

1. Project type: `Package.swift` only (SwiftPM library/CLI/server), `.xcodeproj` (app), `.xcworkspace` + `Podfile` (CocoaPods), `project.yml` (XcodeGen) or `Project.swift` (Tuist). Edit the generator source, not the generated `.xcodeproj`.
2. Swift tools version: first line of `Package.swift` (`// swift-tools-version: 5.9`); `swift-version` file; Xcode `SWIFT_VERSION` build setting.
3. UI framework: `import SwiftUI` + `@main struct App: App` means SwiftUI; `UIApplicationDelegate`/`UIViewController`/storyboards/xibs mean UIKit; `NSViewController` means AppKit. Many apps mix: SwiftUI views hosted via `UIHostingController`, or UIKit views via `UIViewRepresentable`.
4. Concurrency style: `async/await` + actors vs Combine vs completion handlers vs RxSwift. Match the dominant style in the module you touch.
5. Test framework: `import XCTest` vs `import Testing` (Swift Testing, Xcode 16+). Test targets in `Tests/<Target>Tests` (SwiftPM) or a `*Tests` scheme target.
6. Lint/format: `.swiftlint.yml`, `.swiftformat`, `.swift-format`; build phases or `Mintfile`/`Brewfile` listing tools.
7. Dependency injection: environment values (`@Environment`, `@EnvironmentObject`), initializer injection, a container library (Factory, Swinject, Needle), or singletons.
8. Minimum deployment target (`platforms:` in `Package.swift`, `IPHONEOS_DEPLOYMENT_TARGET`): gates `Observable` (iOS 17), `NavigationStack` (iOS 16), `async` APIs (iOS 15).

## Core guidance

### Optionals

- Unwrap with `if let x`, `guard let x else { return }` (shorthand `if let x` for same-name binding, Swift 5.7+), `??`, optional chaining. Never force-unwrap (`!`) outside tests and clearly-impossible-to-fail cases (`URL(string: "https://literal")!`), and comment why.
- Avoid implicitly unwrapped optionals (`var x: T!`) except for `@IBOutlet`s.
- Prefer throwing or returning `Result` over returning `nil` when the caller needs to know why.
- Use `switch` with pattern matching on optionals/enums with associated values; make switches exhaustive without `default` where the enum is yours.

### Value types and protocols

- `struct`/`enum` by default; `class` only for identity, shared mutable state, inheritance or Objective-C interop. Mark classes `final` unless designed for subclassing.
- Model state as enums with associated values rather than multiple optionals:

```swift
enum LoadState<Value> {
    case idle, loading
    case loaded(Value)
    case failed(Error)
}
```

- Protocols for behaviour; protocol extensions for default implementations; `some Protocol` (opaque) for return types, `any Protocol` (existential) when you need heterogeneous storage. Generics with `where` clauses for constraints.
- Conform to `Equatable`, `Hashable`, `Codable`, `Identifiable`, `Sendable` by synthesis where possible; put conformances in extensions.
- `let` over `var`; immutable models updated via copy (`var copy = self; copy.x = 1`) or `mutating func`.
- Access control: `private` by default, `internal` for module API, `public`/`open` only for package API. Use `private(set)`.
- Errors: `enum AppError: Error` (optionally `LocalizedError`), `throws`/`try`/`do-catch`, typed throws (`throws(MyError)`) only in Swift 6+. `try?` only when the failure is genuinely ignorable.

### Structured concurrency

- `async`/`await` for asynchronous work; `async let` for a fixed number of parallel children; `withTaskGroup`/`withThrowingTaskGroup` for dynamic fan-out. Children complete before the scope exits.
- `Task { }` only at the boundary with synchronous code (button action, `onAppear`, delegate callback). Store and `cancel()` long-lived tasks; check `Task.isCancelled`/`try Task.checkCancellation()` in loops.
- `@MainActor` on UI-facing types (view models, view controllers) and on functions that mutate UI state. Do not sprinkle `DispatchQueue.main.async` in async code.
- `actor` for mutable state shared across tasks; keep actor methods small; avoid awaiting inside an actor while holding invariants half-updated (reentrancy).
- `Sendable`: value types of sendable members are sendable; classes need `final` + immutable state or `@unchecked Sendable` with a documented lock. Closures crossing concurrency domains must be `@Sendable`.
- Bridge callbacks: `withCheckedThrowingContinuation` and resume exactly once. Wrap Combine/delegate streams in `AsyncStream`.
- Replace `Timer`/`sleep` with `try await Task.sleep(for: .seconds(1))`.

### SwiftUI

- Views are cheap structs; put logic in `@Observable` (iOS 17+) or `ObservableObject` view models, or in the view when trivial.
- State ownership: `@State` for view-local, `@Binding` for passed-down mutable, `@Environment` for app-wide, `@Bindable` for `@Observable` models. Pre-iOS 17: `@StateObject` (owner) vs `@ObservedObject` (passed in).
- Use `NavigationStack` + `navigationDestination(for:)`, `.task { }` for async work tied to view lifetime, `.refreshable`, `List` with `Identifiable` data. Keep `body` small by extracting subviews and `ViewBuilder` properties.
- Previews: `#Preview { ContentView() }` (Swift 5.9 macro).

### UIKit

- Prefer programmatic Auto Layout (`NSLayoutConstraint.activate`, `translatesAutoresizingMaskIntoConstraints = false`) or the project's existing storyboard/xib approach; do not mix in one screen.
- `UICollectionView` with compositional layout + diffable data source; `UITableView` only for simple lists.
- `weak self` in escaping closures held by the view controller; `[weak self]` guard pattern `guard let self else { return }`.
- Lifecycle: load data in `viewDidLoad`/`viewWillAppear` via a `Task`; cancel in `viewWillDisappear` if appropriate.

### Style

- Follow Swift API Design Guidelines: clarity at the point of use, argument labels that read as phrases (`insert(_:at:)`), `UpperCamelCase` types, `lowerCamelCase` everything else, no Hungarian prefixes.
- Trailing closures for the last closure argument; multiple trailing closures when it reads well.
- `// MARK: -` sections; one primary type per file; extensions grouped by conformance.

## Common tasks

### Create a package

```bash
swift package init --type library --name Networking    # or --type executable / tool
swift build
swift test
```

`Package.swift` essentials: `platforms: [.iOS(.v16), .macOS(.v13)]`, `products`, `targets` (`.target`, `.testTarget`, `.executableTarget`), `dependencies: [.package(url:, from: "1.2.0")]` with `.product(name:, package:)` in target dependencies.

### Add a dependency

- SwiftPM package: edit `Package.swift`; `swift package resolve`; commit `Package.resolved`. In Xcode: File > Add Package Dependencies, which writes to the `.xcodeproj` and `Package.resolved` in the workspace.
- CocoaPods: edit `Podfile`, `pod install`, open the `.xcworkspace`.
- Check licenses and minimum platform of the dependency before adding.

### Write tests

```swift
// XCTest
import XCTest
@testable import Networking

final class ClientTests: XCTestCase {
    func testFetchDecodesUser() async throws {
        let client = Client(session: .mock(json: #"{"id":1,"name":"Ada"}"#))
        let user = try await client.fetchUser(id: 1)
        XCTAssertEqual(user.name, "Ada")
    }
}

// Swift Testing (Xcode 16+)
import Testing
@testable import Networking

@Test func fetchDecodesUser() async throws {
    let user = try await Client(session: .mock(json: #"{"id":1,"name":"Ada"}"#)).fetchUser(id: 1)
    #expect(user.name == "Ada")
}
```

Use `@Test(arguments:)` for parameterised tests, `#require` for unwrap-or-fail. Inject `URLSession`/clocks/dates through initialisers so tests avoid the network and real time. Put UI tests in a separate target using `XCUIApplication`.

### Build and test from the CLI

```bash
swift build -c release                         # SwiftPM
swift test --filter ClientTests               # subset
xcodebuild -list -project App.xcodeproj         # discover schemes
xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 15' build
xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 15' test
xcrun simctl list devices available            # find simulator names
```

Use `-workspace App.xcworkspace` with CocoaPods/multi-project setups. Pipe through `xcbeautify` or `xcpretty` if available.

### Convert a completion-handler API to async

1. Add `func load() async throws -> T` using `withCheckedThrowingContinuation`; resume exactly once on every path.
2. Migrate callers one at a time; mark the view model `@MainActor`.
3. Delete the completion-handler overload when no callers remain.

## Pitfalls

- Retain cycles: closures stored in properties capturing `self` strongly; delegates declared `strong`; `Timer` targets. Use `weak`/`unowned` deliberately.
- Running UI updates off the main actor; Xcode's Main Thread Checker and strict concurrency flag these.
- Data races through non-`Sendable` classes passed into `Task`s; `@unchecked Sendable` without a lock is a lie.
- Actor reentrancy: state read before an `await` may be stale after it.
- `DispatchQueue.main.asyncAfter` and `sleep` in async code; use `Task.sleep`.
- Large `body` properties causing slow type-checking ("expression too complex"); split into subviews.
- Using `ObservedObject` for a view-owned model (recreated every render); use `StateObject`/`@State` with `@Observable`.
- `Codable` key mismatches silently defaulting; set `keyDecodingStrategy` or `CodingKeys` explicitly.
- Editing `.xcodeproj/project.pbxproj` by hand when XcodeGen/Tuist generates it.
- Force-casts (`as!`) on JSON/plist data; use `as?` with a guard.

## Verification

```bash
swift build && swift test                      # SwiftPM
xcodebuild -scheme <Scheme> -destination '<dest>' test   # Xcode projects
swiftlint                                       # obey .swiftlint.yml; `swiftlint --fix` for autocorrect
swiftformat --lint .                            # or `swift-format lint -r Sources`
```

Check `Makefile`, `fastlane/Fastfile`, `.github/workflows/*.yml` or `Mintfile` for the project's canonical commands and tool versions. Build with strict concurrency (`-strict-concurrency=complete` or `SWIFT_STRICT_CONCURRENCY=complete`) if the project targets Swift 6.

## References

- Swift language guide: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/
- API design guidelines: https://www.swift.org/documentation/api-design-guidelines/
- Swift concurrency: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/
- SwiftPM: https://www.swift.org/documentation/package-manager/
- Swift Testing: https://developer.apple.com/documentation/testing
- SwiftUI: https://developer.apple.com/documentation/swiftui
- SwiftLint rules: https://realm.github.io/SwiftLint/rule-directory.html
