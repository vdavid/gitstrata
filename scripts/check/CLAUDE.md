# Check runner

Go program behind `./scripts/check.sh`. Each check lives in `checks/` and is registered in `checks/registry.go`.

## Key decisions

- **Go analyzers are pinned and repo-local**: `EnsureGoTool` (`checks/go-tools.go`) installs each tool at an exact
  `@vX.Y.Z` into `node_modules/.cache/gitstrata-go-tools/`, and reinstalls when the binary's module version or building
  Go (`go version -m`) doesn't match the pin and the running `go env GOVERSION`. `@latest` is rejected.
    - **Why:** it used to accept any `staticcheck` on PATH. After moving to Go 1.27, a `~/go/bin/staticcheck` built by Go
      1.26 failed with "export data version 5 is greater than maximum supported version 2" inside `internal/cpu`, which
      reads like a broken change rather than a stale tool. CI never hit it because its runners start with no binary.
    - To bump a tool, change the version in its check file. Verify the new version is at least three days old.
