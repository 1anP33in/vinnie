---
title: "System Requirements"
description: "Hardware and software you need to run or build Vinnie."
sidebar:
  order: 4
---
## To run Vinnie

| Requirement | Details |
| --- | --- |
| Operating system | Windows 10 or 11, 64-bit (x64) |
| WebView2 Runtime | Preinstalled on Windows 11; the installer can set it up on Windows 10 |
| [Ollama](https://ollama.com/download) | Any recent version (tested with 0.35.1). Must be running to chat |
| A local model | At least one model pulled in Ollama. A model with **tool support** is needed for agent work |
| Git *(optional)* | Enables Git status markers in the explorer |

### Hardware

Vinnie itself is light. The model is what needs resources, and that depends on Ollama and the model you choose:

- **Memory**: the model must fit in GPU memory (VRAM), system RAM, or a mix. As a rough guide, an
  8-billion-parameter model in Ollama's default quantization is about 5 GB on disk, for example
  `qwen3:8b` at 4.9 GB.
- **GPU**: optional but strongly recommended. Ollama uses a supported GPU automatically. See
  [GPU acceleration](/ollama/gpu-acceleration/).
- **Context length** increases memory use. See [Context length](/ollama/context-length/).

## To build Vinnie from source

| Tool | Version |
| --- | --- |
| Node.js | 20.19 or newer (tested on 24.19) |
| pnpm | 12.15, pinned in `package.json`; enable it with `corepack enable pnpm` |
| Rust | Stable, 1.85 or newer (tested on 1.99), MSVC toolchain via [rustup](https://rustup.rs) |
| Visual Studio C++ Build Tools | 2022 or newer, with the **Desktop development with C++** workload |

See [Building from source](/developer/building-from-source/).
