# claude-proxy

## 中文

### 项目说明

`claude-proxy` 是一个本地单机版 Claude 代理工具。它会在本机提供 Claude 兼容的 `/v1/messages` 服务，把请求转发到 OpenAI 兼容上游，并管理 Claude Code 与 Codex 的本地配置。

### 安装

`npm` 快速安装：

```bash
npm install -g @h1d3rone/claude-proxy
claude-proxy config
```

提示：包名带作用域，但实际命令仍然是 `claude-proxy`。

Git 源码安装：

```bash
git clone https://github.com/H1d3rOne/claude-proxy.git
cd claude-proxy
npm install
npm link
claude-proxy config
```

### 使用方法

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
```

- `config`：交互式写入本地配置并应用配置
- `config claude`：只配置 Claude 相关部分
- `config openai`：只配置 OpenAI/Codex 相关部分
- `config get`：查看配置文件、Claude、Codex 当前状态
- `start`：启动本地代理服务器
- `stop`：停止本地代理服务器
- `clean`：一键清除全部受管配置
- `clean claude`：只清除 Claude 配置
- `clean openai`：只清除 OpenAI/Codex 配置

## English

### Overview

`claude-proxy` is a local single-machine Claude proxy. It exposes a Claude-compatible `/v1/messages` endpoint, forwards requests to an OpenAI-compatible upstream, and manages local Claude Code and Codex configuration.

### Installation

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

### Usage

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
