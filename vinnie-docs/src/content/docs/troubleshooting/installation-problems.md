---
title: "Installation Problems"
description: "Fix problems building or installing Vinnie."
sidebar:
  order: 1
---
## `link.exe` not found, or "linking with `link.exe` failed"

The Visual Studio C++ build tools are missing or not detected. Install **Visual Studio Build Tools** with the
**Desktop development with C++** workload, then build from **PowerShell**. Under Git Bash, MSYS's own `link`
command can shadow the MSVC linker.

```powershell
winget install --id Microsoft.VisualStudio.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## `pnpm` isn't recognized

Enable it through corepack (included with Node.js):

```powershell
corepack enable pnpm
```

If that fails with a permissions error:

```powershell
corepack enable pnpm --install-directory "$env:APPDATA\npm"
```

## The installer won't start, or Vinnie shows a blank window

Vinnie needs the **WebView2 Runtime**. It's built into Windows 11; on Windows 10, install it from Microsoft's
WebView2 download page.

## "WebView2 error … The group or resource is not in the correct state"

Another Vinnie instance is running with different WebView2 settings (common when running a development build next
to the installed app). Close the other instance, or give the development build its own
`WEBVIEW2_USER_DATA_FOLDER`.

## Where did it install?

Per user, in `%LOCALAPPDATA%\Vinnie`, with Start-menu and desktop shortcuts. Uninstall from Windows
**Settings → Apps**; your data in `%APPDATA%\ai.vinnie.desktop` is kept.
