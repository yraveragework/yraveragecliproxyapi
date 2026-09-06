# Run CLIProxyAPI on your Mac

The proxy, browser panel, and companion services run locally on the Mac. This does not require a Windows computer. FabSol, FabKim, Claude, and Moonshot sessions open in Terminal only when enabled in the browser. Background helpers do not each open a terminal.

## Setup

1. Install Node.js 22 or newer. Install Claude Code and complete its normal login in Terminal. Python 3 is optional, for the existing Cursor routing integration.
2. Download the matching macOS archive from [upstream CLIProxyAPI releases](https://github.com/router-for-me/CLIProxyAPI/releases): `darwin_arm64` for Apple silicon or `darwin_amd64` for Intel. Extract `cli-proxy-api` into this folder. The binary is not bundled.
3. In Terminal, change to this folder and run:

   ```sh
   chmod +x cli-proxy-api start.command stop.command model-router/scripts/*.sh
   cp config.yaml.example config.yaml
   ```

4. Edit `config.yaml`: choose your own API key and management password, keep `host: "127.0.0.1"`, and use `auth-dir: "./auth"`. Use matching model/provider configuration for your account.
5. Edit companion configurations locally. Set `apiKey` to your proxy API key in `claude-fabsol-worker/config.json`, `claude-fabkim-worker/config.json`, and `moonshot-worker/config.json`. Set `managementKey` in `claude-autostart/config.json` to your management password. Replace all placeholder values before use. Models are selectable in the panel; the defaults must exist on your configured provider.
6. Run `./start.command` (or `bash start.command`). It starts the services and opens the local panel in your default browser. Log in with your management password.
7. Enable FabSol, FabKim, Claude, or Moonshot to open that agent session. macOS may request permission for the launcher to control Terminal; approve that permission if you want the feature to open a session. Claude-only mode uses native Claude login; the other modes use the configured proxy.

You can double-click `start.command` after making it executable. A startup Terminal window may remain at “Process completed,” depending on Terminal preferences; the individual helpers run in the background.

## Stop and status

```sh
./stop.command
node tools/macos-services.mjs status
```

Stop disables the active session through its companion, then stops only this installation's services. Repeated startup reuses the active installation. Conflicting ports cause startup to fail rather than adopting another application. Service logs are under `logs/`; private lifecycle files are under `.runtime/` and each companion's `.runtime/`.

For a failed start, inspect `logs/launcher.log` and the named service log. After a forced termination, a stale `.runtime/services.lock` may remain; confirm this installation is no longer running before removing that one lock file and retrying.

## Platform differences

- Windows login shortcuts and the Windows executable updater are unavailable on macOS. For a Mac binary update, stop the app, replace `cli-proxy-api` with the correct upstream Mac binary, ensure it is executable, then start again. Keep your configuration and authentication files.
- Cursor settings use `~/Library/Application Support/Cursor/`. Optional routing requires Cursor and Python 3. A missing Cursor installation does not prevent Terminal sessions.
- Claude can store login credentials in macOS Keychain. File-based login indicators are not authoritative on Mac; verify login in Claude itself.
- Use the browser on the same Mac. Helpers remain local; no remote management or network exposure is added.
- Logs and credentials are local. Do not commit real configured keys, `config.yaml`, authentication folders, or runtime files.

## Verification status and Mac acceptance check

This port was authored on Windows. Portable Node tests, syntax checks, and the panel build can run there. Actual macOS Terminal automation, keyboard input, permission prompts, and binary compatibility require a Mac.

On a Mac, verify: start twice without duplicate helpers; sign into the panel; enable each mode and type in its Terminal; disable it and confirm its agent exits; switch modes and confirm the previous one stops; close an agent Terminal and confirm status clears; stop and confirm helper ports close; restart from a folder whose name contains spaces. Never copy Windows runtime/state files to the Mac.

Terminal automation follows [Apple's Terminal automation support](https://support.apple.com/guide/terminal/trml1003/mac).
