---
name: bash
description: Write, review and harden Bash and Zsh shell scripts, Makefile recipes and CI steps. Covers strict mode (set -euo pipefail), quoting and word splitting, arrays, functions, error handling and traps, argument parsing, portability between bash/zsh/sh and macOS/Linux, ShellCheck and shfmt, and when to switch to Python instead. Use when editing .sh/.bash/.zsh files, shell snippets in Makefiles, Dockerfiles or CI YAML.
---

# Bash / shell scripting

Assumes Bash 4+ for scripts (associative arrays, `mapfile`, `${var,,}`). macOS ships Bash 3.2 at `/bin/bash`; if the script must run there unmodified, avoid 4+ features or require Homebrew bash. Zsh notes are called out where behaviour differs. POSIX `sh` advice applies when the shebang is `#!/bin/sh`.

## When to use

- Editing or creating `.sh`, `.bash`, `.zsh` files, `bin/*` scripts without extensions, shell functions in dotfiles.
- Writing shell in `Makefile` recipes, `Dockerfile` `RUN` lines, GitHub Actions `run:` steps, `package.json` scripts, `Justfile`.
- Reviewing scripts for quoting bugs, error handling, portability or security.

## Project conventions to detect first

1. Shebang and target shell: `#!/usr/bin/env bash` (portable lookup), `#!/bin/bash`, `#!/bin/sh` (POSIX only: no arrays, no `[[`, no guaranteed `local`), `#!/usr/bin/env zsh`. Match existing scripts.
2. Strict mode already used? Look for `set -euo pipefail`, `set -e`, `shopt -s inherit_errexit`, `IFS=$'\n\t'`.
3. Lint/format config: `.shellcheckrc` (disabled codes, `shell=` directive), `.editorconfig` for indent (`shfmt` reads it), `shfmt` flags in CI/Makefile (`-i 2 -ci -bn -sr`).
4. Layout: `scripts/`, `bin/`, `tools/`, `hack/` (Kubernetes-style), `.github/scripts/`. Shared helpers sourced via `source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"`.
5. Runtime: Docker images (Alpine → `/bin/sh` is BusyBox ash, no bash unless installed), CI runners (Ubuntu has bash 5, macOS has bash 3.2 and zsh default), target users' machines.
6. Test framework: `bats-core` (`test/*.bats`), `shunit2`, `shellspec`, or plain `make test`.
7. Make: `SHELL := bash` and `.SHELLFLAGS := -eu -o pipefail -c` at the top of the Makefile make recipes strict; `.ONESHELL:` runs a recipe in one shell.

## Core guidance

### Script skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true   # bash 4.4+: errexit inside $(...)
IFS=$'\n\t'

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [-v] [-o OUTPUT] INPUT...
  -o OUTPUT  write results to OUTPUT (default: stdout)
  -v         verbose
USAGE
}

log()  { printf '%s\n' "$*" >&2; }
die()  { log "error: $*"; exit 1; }

cleanup() {
  local rc=$?
  [[ -n "${TMPDIR_WORK:-}" ]] && rm -rf "$TMPDIR_WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'die "interrupted"' INT TERM

main() {
  local output="" verbose=0
  while getopts ":o:vh" opt; do
    case "$opt" in
      o) output="$OPTARG" ;;
      v) verbose=1 ;;
      h) usage; exit 0 ;;
      :) die "option -$OPTARG requires an argument" ;;
      \?) die "unknown option -$OPTARG" ;;
    esac
  done
  shift $((OPTIND - 1))
  (( $# > 0 )) || { usage >&2; exit 2; }

  TMPDIR_WORK="$(mktemp -d)"
  for input in "$@"; do
    [[ -r "$input" ]] || die "cannot read $input"
    process "$input" "$output"
  done
}

main "$@"
```

### Strict mode and its caveats

- `set -e` (exit on error) does not fire inside `if`/`while` conditions, `&&`/`||` chains, or command substitutions in bash before 4.4 (`inherit_errexit`). Check critical return codes explicitly: `if ! out="$(cmd)"; then die "cmd failed"; fi`.
- `set -u` makes unset variables fatal; use `"${VAR:-default}"` for optional values and `"${1:-}"` for optional positional args. `"$@"` is safe even with zero args.
- `set -o pipefail` makes a pipeline fail if any stage fails; combine with `${PIPESTATUS[@]}` (bash) / `${pipestatus[@]}` (zsh) when you need the specific stage.
- Allow an expected failure: `cmd || true`, or capture: `rc=0; cmd || rc=$?`.
- `grep` returns 1 on no match; under `set -e` write `grep -q pattern file || true` or test the result explicitly.

### Quoting and expansion

- Double-quote every expansion: `"$var"`, `"$(cmd)"`, `"${arr[@]}"`, `"$@"`. Unquoted expansions undergo word splitting and globbing. Exceptions: the right side of `[[ ... ]]` comparisons and plain assignments `x=$y` (still quote for readability).
- `[[ ]]` over `[ ]` in bash/zsh: no word splitting, pattern matching `==`, regex `=~`, `&&`/`||` inside. Use `[ ]` only in POSIX `sh`.
- Arithmetic: `(( i++ ))`, `$(( a + b ))`; compare numbers with `-eq`/`-lt` inside `[ ]` or `<`/`>` inside `(( ))`, never string `==` for numbers.
- Prefer `$(cmd)` over backticks; `printf '%s\n'` over `echo` for arbitrary data (`echo` mangles `-n`, `-e`, backslashes across shells).
- Parameter expansion instead of `sed`/`awk` for simple cases: `${file%.*}` (strip extension), `${file##*/}` (basename), `${var/pattern/repl}`, `${var^^}`/`${var,,}` (case, bash 4), `${#var}` (length), `${var:offset:length}`.
- Globs: `shopt -s nullglob` so a non-matching glob expands to nothing (zsh errors on no match by default; use `setopt null_glob`). `shopt -s globstar` for `**`.
- Filenames: handle spaces and newlines by using arrays and `-print0`/`-0`/`-d ''`: `find . -name '*.log' -print0 | xargs -0 rm --` or `while IFS= read -r -d '' f; do ...; done < <(find ... -print0)`.
- Always `read -r`; `IFS= read -r line` preserves leading/trailing whitespace.

### Arrays and data

- Indexed arrays: `files=(a b "c d")`, `"${files[@]}"`, `${#files[@]}`, `files+=("e")`. Associative: `declare -A map; map[key]=value; "${!map[@]}"` (bash 4+; zsh `typeset -A`, and zsh indexed arrays are 1-based unless `KSH_ARRAYS`).
- Read lines into an array: `mapfile -t lines < file` (bash 4) or `while IFS= read -r l; do lines+=("$l"); done < file`.
- Avoid parsing `ls`; use globs or `find`. Avoid `for x in $(cmd)`; use `while read` or `mapfile`.
- Structured data: use `jq` for JSON, `yq` for YAML, not regex. Once you need nested data structures, move to Python.

### Functions and structure

- `local` for every variable inside functions (`local -r` for constants, `local -a`/`-A` for arrays). Declare and assign separately when the assignment is a command substitution so `set -e` sees the failure: `local out; out="$(cmd)"`.
- Return status via `return N`; return data via stdout (`printf`) captured with `$(...)`, or via a nameref `local -n ref="$1"` (bash 4.3+).
- One `main` function invoked at the bottom as `main "$@"`; keep top-level statements to definitions so the script can be sourced for testing.
- Diagnostics on stderr (`>&2`), data on stdout. Exit codes: 0 success, 1 general failure, 2 usage error, 64-78 from `sysexits.h` if the project uses them.
- Prefer long options in scripts for readability (`--recursive` not `-r`) where the tool supports them on every target platform (GNU vs BSD differ; see portability).

### Traps and cleanup

- `trap cleanup EXIT` runs on normal exit, `exit`, and after `set -e` failures; capture `$?` first thing in the handler. Also trap `INT TERM` to run cleanup on Ctrl-C/kill, and `ERR` for diagnostics: `trap 'log "failed at line $LINENO: $BASH_COMMAND"' ERR`.
- Temporary files: `tmp="$(mktemp)"` / `mktemp -d`; never fixed names in `/tmp`. Respect `TMPDIR` if set.
- Lock files: `exec 9>"$lockfile"; flock -n 9 || die "already running"` (Linux `flock`; macOS lacks it, use `mkdir lockdir` atomically).
- Background jobs: `cmd & pids+=($!)`; `wait "${pids[@]}"` and check each status; `wait -n` (bash 4.3+) for first-finished.

### Portability

- GNU vs BSD tools differ: `sed -i ''` (macOS) vs `sed -i` (GNU), `readlink -f` missing on older macOS (use `realpath` or a `cd && pwd` dance), `date -d` (GNU) vs `date -v` (BSD), `grep -P` GNU only, `stat -c` vs `stat -f`, `xargs -r` GNU only, `mktemp` template requirements on macOS (`mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX"`).
- Check with `command -v tool >/dev/null || die "tool required"` at startup; prefer tools present everywhere (`awk`, `sed`, `grep -E`, `cut`, `sort`, `tr`) over GNU-only ones.
- `#!/bin/sh` scripts: no arrays, `[[`, `function` keyword, `$'...'`, `${var//}`, `source` (use `.`), `==` in `[ ]` (use `=`); `local` is widely supported but not guaranteed; `pipefail` is in POSIX 2024 but not in `dash` yet. Run `shellcheck -s sh` and test with `dash`.
- Zsh-specific: word splitting is off by default (`$var` is one word; use `${=var}` to split), arrays are 1-indexed, `setopt` instead of `shopt`, `read -A` for arrays, `print -r --` instead of `echo`, `${(f)...}` flags for splitting. Interactive dotfiles (`.zshrc`) are zsh; scripts should still be bash unless the project standardises on zsh.
- Makefile recipes run each line in a separate `/bin/sh` by default; set `SHELL := bash` and `.SHELLFLAGS := -eu -o pipefail -c`, escape `$` as `$$`, and chain with `&&` or use `.ONESHELL:`.

### When to switch to Python (or Go)

Rewrite when any of these apply: nested data (JSON/YAML beyond a `jq` one-liner), more than ~200 lines, floating-point math, concurrency beyond `&`/`wait`, need for unit tests of logic, cross-platform without GNU coreutils, or string handling with Unicode. A shell script is right for glueing CLI tools, environment setup, and short CI steps. Python with `subprocess.run([...], check=True)` keeps the glue while adding structure.

## Common tasks

### Add a new script

1. Create `scripts/<name>.sh` with the skeleton above; `chmod +x`.
2. Add usage, `getopts` (or the long-option loop below), and input validation.
3. Run `shellcheck` and `shfmt`; add a `bats` test if the repo has them.
4. Wire into `Makefile`/`package.json`/CI as the project does.

### Parse long options

```bash
while (( $# > 0 )); do
  case "$1" in
    --output) output="${2:?--output needs a value}"; shift 2 ;;
    --output=*) output="${1#*=}"; shift ;;
    --verbose) verbose=1; shift ;;
    --) shift; break ;;
    -*) die "unknown option $1" ;;
    *) break ;;
  esac
done
```

GNU `getopt` (not `getopts`) supports long options but is unavailable or different on macOS; the loop above is portable.

### Process files safely

```bash
while IFS= read -r -d '' f; do
  process "$f"
done < <(find "$dir" -type f -name '*.csv' -print0)
```

A `while` on the right of a pipe (`find ... | while read`) runs in a subshell, so variables set inside vanish; process substitution as above (or `shopt -s lastpipe`) keeps them.

### Make a script idempotent and safe to rerun

Check state before acting (`[[ -d "$dir" ]] || mkdir -p "$dir"`), use `install -d`, `ln -sfn`, `mkdir -p`, `rsync` rather than `cp -r`, write to a temp file and `mv` atomically, and offer `--dry-run` that prints commands instead of running them.

### Write a bats test

```bash
# test/greet.bats
setup() { load 'test_helper/bats-support/load'; load 'test_helper/bats-assert/load'; }

@test "greets by name" {
  run "$BATS_TEST_DIRNAME/../scripts/greet.sh" Ada
  assert_success
  assert_output "Hello, Ada"
}
```

Run with `bats test/`.

## Pitfalls

- Unquoted `$var` or `$(cmd)` with spaces/globs; `for f in $(ls)`; parsing `ls` output.
- `cd somewhere` without `|| exit` (under `set -e` a failed `cd` exits, but `cd dir && rm -rf *` without strict mode deletes the wrong tree). Prefer `cd "$dir" || die` or run in a subshell `( cd "$dir" && ... )`.
- `rm -rf "$prefix/"` when `prefix` is unset (`set -u` prevents; `"${prefix:?}"` is explicit).
- `echo "$var"` where `var` may start with `-`; use `printf '%s\n'`.
- `[ $a == $b ]` with empty values or spaces; use `[[ "$a" == "$b" ]]`.
- Writing to a file you are reading in the same pipeline (`sort f > f` truncates it); use a temp file or `sponge`.
- `set -e` with functions used in `if` conditions: errexit is disabled inside the whole function body.
- Modifying `IFS` globally and forgetting to restore; scope it per command (`IFS=, read -r a b <<< "$line"`).
- Relying on the current directory; compute paths from `SCRIPT_DIR`.
- `sudo` inside scripts, secrets in command arguments (visible in `ps`), and `curl | bash` without pinning and checksum verification.
- Using `which` (not POSIX, inconsistent); use `command -v`.
- Zsh/bash differences when a `.zsh` file is executed with bash or vice versa; make the shebang match the syntax.

## Verification

```bash
shellcheck scripts/*.sh                 # honours .shellcheckrc; -x follows source; -s sh for POSIX
shfmt -d -i 2 -ci scripts/              # diff; -w to write; -ln posix/bash/mksh
bash -n script.sh                       # syntax check only
bats test/                              # if tests exist
bash -x script.sh args                  # trace; or set -x inside, PS4='+ ${BASH_SOURCE}:${LINENO}: '
dash -n script.sh                       # POSIX sh scripts: check with dash too
```

Run the script once against throwaway input and once with `--dry-run`/`-n` if it mutates state; test on both macOS and Linux (or a `debian:stable-slim` container) when both are targets. Check `Makefile`, `.pre-commit-config.yaml` (`shellcheck`, `shfmt` hooks) and CI for the exact invocations.

## References

- Bash reference manual: https://www.gnu.org/software/bash/manual/bash.html
- Greg's Bash wiki (pitfalls, FAQ): https://mywiki.wooledge.org/BashPitfalls
- Google Shell Style Guide: https://google.github.io/styleguide/shellguide.html
- ShellCheck wiki (every SC code explained): https://www.shellcheck.net/wiki/
- shfmt: https://github.com/mvdan/sh
- POSIX shell command language: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html
- Zsh manual: https://zsh.sourceforge.io/Doc/
- bats-core: https://bats-core.readthedocs.io/
