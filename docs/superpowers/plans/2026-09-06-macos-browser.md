# Native macOS browser support

Goal: Run this overlay directly on macOS with a local browser panel and on-demand agent Terminal sessions, preserving Windows behavior.

Architecture: Keep existing HTTP companions and panel. Share platform paths and macOS Terminal lifecycle. Node session runner reads local configuration without placing secrets in Terminal command strings. Shell start/stop wrappers manage only this installation through a Node supervisor. Disable Windows-only login and binary-update actions on Mac with explicit explanations.

Validation: Node tests for platform paths, native versus routed environment, command quoting, process lifecycle and supervisor behavior; worker syntax checks; TypeScript/build checks; macOS CI tests plus documented manual Terminal acceptance steps. This Windows host cannot validate Apple Events or Gatekeeper.

- [x] Platform and session helper tests, then implementation.
- [x] Integrate all four companions and Mac settings paths.
- [x] Add Mac service supervisor, launchers, setup documentation.
- [x] Validate Windows-compatible source and package a credential-free Mac distribution.

Result: five portable tests passed, TypeScript and panel build passed. Native Mac lifecycle test is included but skipped on Windows. Public upload was blocked by automatic approval review pending explicit user authorization; Mac CI has not run.
