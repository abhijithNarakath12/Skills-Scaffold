---
name: cpp
description: Write, refactor and review modern C++ (C++17/C++20) in CMake, Make, Conan or vcpkg projects. Covers RAII and ownership with smart pointers, const-correctness, STL usage, error handling, build configuration, sanitizers, clang-format/clang-tidy, and GoogleTest/Catch2 testing. Use when editing .cpp/.cc/.cxx/.hpp/.h files or CMakeLists.txt.
---

# C++

Assumes C++17 as the baseline and uses C++20 features (concepts, ranges, `std::span`, designated initializers) only when `CMAKE_CXX_STANDARD` is 20 or higher. Check the compiler versions the project supports before relying on newer library features.

## When to use

- Editing or creating `.cpp`, `.cc`, `.cxx`, `.hpp`, `.h`, `.ipp` files.
- Changing `CMakeLists.txt`, `CMakePresets.json`, `conanfile.*`, `vcpkg.json`, `Makefile`, `.clang-format`, `.clang-tidy`.
- Reviewing C++ for ownership, lifetime, undefined behaviour, const-correctness or build hygiene.

## Project conventions to detect first

1. Build system: `CMakeLists.txt` (+ `CMakePresets.json`, `cmake/` modules), plain `Makefile`, Bazel (`BUILD`, `WORKSPACE`/`MODULE.bazel`), Meson (`meson.build`). Use what exists.
2. Standard and flags: `set(CMAKE_CXX_STANDARD 17|20)`, `CMAKE_CXX_EXTENSIONS OFF`, warning flags (`-Wall -Wextra -Wpedantic -Werror`), `target_compile_features(... cxx_std_20)`.
3. Dependency manager: `conanfile.txt`/`conanfile.py` (Conan 2 uses `[requires]` + `CMakeDeps`/`CMakeToolchain`), `vcpkg.json` (manifest mode, toolchain file), `FetchContent`, git submodules in `third_party/` or `external/`.
4. Layout: `include/<project>/*.hpp` public headers + `src/*.cpp`; or headers beside sources. Test directory `tests/` or `test/`.
5. Style: `.clang-format` (BasedOnStyle Google/LLVM/Chromium), `.clang-tidy` checks, naming (`snake_case` vs `CamelCase`, `m_` or trailing `_` members), header extension (`.h` vs `.hpp`), `#pragma once` vs include guards.
6. Test framework: `find_package(GTest)` / `gtest_discover_tests` or `Catch2` with `catch_discover_tests`; `doctest`; `ctest` configuration in `CMakeLists.txt`.
7. Exceptions and RTTI: `-fno-exceptions` / `-fno-rtti` (embedded, games) changes error-handling advice completely.

## Core guidance

### Ownership and RAII

- Every resource (memory, file, socket, lock, handle) is owned by an object whose destructor releases it. No naked `new`/`delete`, `malloc`/`free`, `fopen` without a wrapper.
- `std::unique_ptr<T>` for single ownership (`std::make_unique`), `std::shared_ptr<T>` only for genuinely shared lifetime (`std::make_shared`), `std::weak_ptr` to break cycles.
- Pass by: value for cheap/sink parameters, `const T&` for read-only, `T&` for in/out, `T*`/`const T*` for optional non-owning, `std::unique_ptr<T>` by value to transfer ownership, `std::shared_ptr` by value only when the callee keeps a reference.
- Non-owning views: `std::string_view`, `std::span<T>` (C++20), raw pointers/references. Never store a `string_view` that outlives its source.
- Rule of zero: let members manage resources; if you must write one of destructor/copy/move, write (or `= default`/`= delete`) all five.

```cpp
class File {
public:
    explicit File(const std::filesystem::path& p) : handle_(std::fopen(p.string().c_str(), "rb")) {
        if (!handle_) throw std::system_error(errno, std::generic_category(), p.string());
    }
    ~File() { if (handle_) std::fclose(handle_); }
    File(const File&) = delete;
    File& operator=(const File&) = delete;
    File(File&& o) noexcept : handle_(std::exchange(o.handle_, nullptr)) {}
    File& operator=(File&& o) noexcept { std::swap(handle_, o.handle_); return *this; }
private:
    std::FILE* handle_;
};
```

### Const-correctness and value semantics

- Mark everything `const` that can be: locals, member functions that do not mutate, parameters taken by reference. Use `constexpr` for compile-time constants and `inline constexpr` in headers.
- Prefer value types and `std::optional<T>`, `std::variant<...>`, `std::pair`/`struct` over out-parameters and sentinel values.
- `explicit` on single-argument constructors and conversion operators; `[[nodiscard]]` on functions whose result must not be ignored; `noexcept` on move operations and swap.
- `enum class` over plain `enum`; `nullptr` over `NULL`/`0`; `auto` where the type is obvious or unutterable, explicit types otherwise.
- `override` on every overriding function; `final` where appropriate; virtual destructor on polymorphic bases.

### STL and algorithms

- Prefer `<algorithm>` and `<numeric>` (`std::find_if`, `std::transform`, `std::accumulate`, `std::sort`) and C++20 `std::ranges::` versions over hand-written loops. Range-for with `const auto&` for reads.
- `std::vector` by default; `std::array` for fixed size; `std::unordered_map` for lookup, `std::map` when ordering matters; `std::deque` for queues. Call `reserve()` when the size is known.
- `std::string_view` for read-only string parameters; `std::format` (C++20, check compiler support) or `fmt::format` for formatting; never `sprintf` into fixed buffers.
- Containers of polymorphic objects: `std::vector<std::unique_ptr<Base>>`.
- Use `std::chrono` for time, `std::filesystem` for paths, `<random>` for randomness (not `rand()`).

### Error handling

- Exceptions for exceptional, non-local failures; derive from `std::runtime_error`/`std::logic_error`; catch by `const&`. Keep destructors and move operations `noexcept`.
- Expected failures in APIs: `std::optional<T>` (no error info), `std::expected<T, E>` (C++23) or the project's `Result`/`tl::expected`/`absl::StatusOr`. Follow the existing convention.
- Never ignore return codes from C APIs; wrap them immediately in RAII and convert to exceptions or error types at the boundary.
- `assert()` (or the project's `CHECK` macro) for programmer invariants, not for input validation.

### Headers and modules

- Minimal includes; forward-declare in headers when only pointers/references are used. Include what you use (`include-what-you-use` if the repo runs it).
- No `using namespace` in headers. Keep implementation details in `namespace detail` or an anonymous namespace in the `.cpp`.
- Templates and `inline`/`constexpr` functions live in headers; everything else in `.cpp`.
- `#pragma once` is universally supported; match the repo's choice.

### Concurrency

- `std::jthread` (C++20) or `std::thread` joined in a destructor; `std::mutex` + `std::scoped_lock`/`std::lock_guard`; `std::atomic` for flags/counters; `std::condition_variable` with a predicate loop.
- Prefer passing work to a task/executor abstraction the project already has over creating raw threads.
- Shared mutable state needs a documented locking discipline; run TSan to validate.

## Common tasks

### Add a library target and test (CMake)

```cmake
add_library(geometry src/circle.cpp src/rect.cpp)
target_include_directories(geometry PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>)
target_compile_features(geometry PUBLIC cxx_std_20)
target_compile_options(geometry PRIVATE -Wall -Wextra -Wpedantic)

find_package(GTest REQUIRED)
add_executable(geometry_tests tests/circle_test.cpp)
target_link_libraries(geometry_tests PRIVATE geometry GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(geometry_tests)
```

Catch2 v3: `find_package(Catch2 3 REQUIRED)`, link `Catch2::Catch2WithMain`, `include(Catch)` + `catch_discover_tests(target)`.

### Write a test

```cpp
// GoogleTest
#include <gtest/gtest.h>
#include "geometry/circle.hpp"

TEST(Circle, AreaOfUnitCircle) {
    EXPECT_NEAR(geometry::Circle{1.0}.area(), 3.14159, 1e-4);
}

// Catch2 v3
#include <catch2/catch_test_macros.hpp>
TEST_CASE("circle area", "[geometry]") {
    REQUIRE(geometry::Circle{0.0}.area() == 0.0);
}
```

Use `EXPECT_*` for non-fatal, `ASSERT_*` when continuing is meaningless. Parameterise with `TEST_P`/`INSTANTIATE_TEST_SUITE_P` (gtest) or `GENERATE` (Catch2).

### Configure, build, test

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
cmake --build build -j
ctest --test-dir build --output-on-failure
# with presets (CMakePresets.json):
cmake --preset debug && cmake --build --preset debug && ctest --preset debug
```

Conan 2: `conan install . --output-folder=build --build=missing` then pass `-DCMAKE_TOOLCHAIN_FILE=build/conan_toolchain.cmake`. vcpkg: `-DCMAKE_TOOLCHAIN_FILE=$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake` with dependencies listed in `vcpkg.json`.

### Enable sanitizers

Add a build type or option:

```cmake
option(ENABLE_SANITIZERS "ASan+UBSan" OFF)
if(ENABLE_SANITIZERS)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()
```

Run tests once with ASan+UBSan and once with TSan (`-fsanitize=thread`, cannot combine with ASan). `valgrind --leak-check=full ./build/app` as a fallback on Linux.

### Format and lint

```bash
clang-format -i $(git ls-files '*.cpp' '*.hpp' '*.h')      # or: cmake --build build --target format if defined
clang-tidy -p build src/foo.cpp                                # uses compile_commands.json
run-clang-tidy -p build                                        # whole project
```

Keep `.clang-tidy` checks like `bugprone-*`, `modernize-*`, `performance-*`, `readability-*`, `cppcoreguidelines-*` with the project's exclusions; do not disable a check to silence one finding, fix the code.

### Add a dependency

- Conan: add to `[requires]` in `conanfile.txt` (or `self.requires("fmt/10.2.1")` in `conanfile.py`), re-run `conan install`, then `find_package(fmt REQUIRED)` + `target_link_libraries(... fmt::fmt)`.
- vcpkg: add the port name to `"dependencies"` in `vcpkg.json`; `find_package` names come from the port's usage file (`vcpkg install` prints it).
- FetchContent: `FetchContent_Declare(... GIT_TAG <pinned tag or sha>)` + `FetchContent_MakeAvailable`. Pin versions.

## Pitfalls

- Dangling references: returning references to locals, storing `string_view`/`span` of temporaries, iterators invalidated by `push_back`/`erase`.
- Undefined behaviour that "works": signed overflow, out-of-bounds indexing (`[]` on vector), uninitialised members, data races, use-after-move. UBSan/ASan catch most of these; run them.
- `std::move` on a `const` object or on a return value (prevents NRVO); `std::move` into a function that takes `const T&` does nothing.
- Implicit conversions: `int` to `bool`, narrowing in braces is an error but in parentheses silently truncates; use brace initialisation.
- `std::shared_ptr` everywhere as a substitute for thinking about ownership; it costs atomics and hides cycles.
- Macros for constants or inline functions; use `constexpr`/templates.
- `#include` order dependencies and missing includes that only compile because of transitive includes.
- Static initialisation order across translation units; use function-local statics.
- Mixing `malloc`/`new`/`new[]` with the wrong deallocator; use containers and smart pointers.
- Changing `CMAKE_CXX_FLAGS` globally instead of `target_compile_options`; use target-scoped commands.

## Verification

Find the real commands in `CMakePresets.json`, `Makefile`, `.github/workflows/`, `Justfile` or `README`. Typical loop:

```bash
cmake --build build -j                             # must be warning-free if -Werror
ctest --test-dir build --output-on-failure         # unit tests
clang-format --dry-run --Werror $(git ls-files '*.cpp' '*.hpp' '*.h')
run-clang-tidy -p build                            # static analysis
cmake -B build-asan -DENABLE_SANITIZERS=ON && cmake --build build-asan && ctest --test-dir build-asan
```

Compile with both the project's primary compiler and, if CI does, the other of GCC/Clang/MSVC.

## References

- C++ Core Guidelines: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines
- cppreference: https://en.cppreference.com/w/
- CMake documentation: https://cmake.org/cmake/help/latest/
- Modern CMake guide: https://cliutils.gitlab.io/modern-cmake/
- GoogleTest primer: https://google.github.io/googletest/primer.html
- Catch2 docs: https://github.com/catchorg/Catch2/tree/devel/docs
- clang-tidy checks: https://clang.llvm.org/extra/clang-tidy/checks/list.html
- Sanitizers: https://github.com/google/sanitizers/wiki
