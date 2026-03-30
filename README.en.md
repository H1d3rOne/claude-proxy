# claude-proxy

<p align="center">
  <a href="https://github.com/H1d3rOne/claude-proxy/blob/main/README.md">中文</a> |
  <strong>English</strong>
</p>

## Overview

`claude-proxy` is a local single-machine Claude proxy. It exposes a Claude-compatible `/v1/messages` endpoint, forwards requests to an OpenAI-compatible upstream, and manages local Claude Code and Codex configuration.

## Installation

Quick install with `npm`:

```bash
npm install -g @h1d3rone/claude-proxy
claude-proxy config
```

Note: the published package is scoped, but the command name is still `claude-proxy`.

Install from Git source:

```bash
git clone https://github.com/H1d3rOne/claude-proxy.git
cd claude-proxy
npm install
npm link
claude-proxy config
```

## Usage

```bash
claude-proxy config
claude-proxy config claude
claude-proxy config openai
claude-proxy config get

claude-proxy start
claude-proxy stop

claude-proxy clean
claude-proxy clean claude
claude-proxy clean openai
claude-proxy update
```

- `config`: interactively write and apply local configuration
- `config claude`: configure only Claude-related settings
- `config openai`: configure only OpenAI/Codex-related settings
- `config get`: show current config-file, Claude, and Codex state
- `start`: start the local proxy server
- `stop`: stop the local proxy server
- `clean`: clear all managed configuration
- `clean claude`: clear only Claude configuration
- `clean openai`: clear only OpenAI/Codex configuration
- `update`: Update the current claude-proxy installation (manual-only)
