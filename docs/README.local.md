# claude-proxy

`claude-proxy` 是一个本地单机版的 Claude 代理工具。

它会在本机启动一个 Claude 兼容的 `/v1/messages` 服务，把 Claude Code 请求转换成 OpenAI 兼容上游请求，同时帮你维护 Claude Code 和 Codex 的本地配置。

## 功能

- 将 Claude 请求转发到 OpenAI 兼容上游
- 交互式生成和维护 `~/.claude-proxy/config.toml`
- 自动修改 `~/.claude/settings.json`，让 Claude Code 走本地代理
- 自动修改 `~/.codex/config.toml` 和 `~/.codex/auth.json`
- 支持全量配置/清理，也支持只处理 `claude` 或 `openai` 单项
- 支持 Claude 会话开始自动启动代理、结束自动停止代理
- 只支持本机，不再支持远端主机配置

## 要求

- Node.js `>= 18`
- 已安装 Claude Code
- 如果需要同步配置 Codex，需要本机存在 `~/.codex`

## 安装

推荐全局安装，因为 Claude Hook 需要能直接在 `PATH` 中找到 `claude-proxy`。

```bash
npm install -g @h1d3rone/claude-proxy
```

安装后实际命令仍然是：

```bash
claude-proxy
```

开发环境：

```bash
npm install
npm test
```

## 快速开始

1. 全量配置：

```bash
claude-proxy config
```

2. 查看当前配置：

```bash
claude-proxy config get
```

3. 手动启动代理：

```bash
claude-proxy start
```

如果已经执行过 `claude-proxy config`，Claude Code 会在会话开始时自动检查代理是否已运行，未运行则启动；会话结束时自动停止。

## 命令

### 配置命令

```bash
claude-proxy config
claude-proxy config claude
claude-proxy config openai
claude-proxy config get
```

- `claude-proxy config`
  交互式配置全部字段，并同时应用到 Claude Code 和 Codex。

- `claude-proxy config claude`
  只配置 Claude 相关字段，并只更新 Claude 配置。

- `claude-proxy config openai`
  只配置 OpenAI/Codex 相关字段，并只更新 Codex 配置。

- `claude-proxy config get`
  显示配置文件、Claude、Codex 的当前状态。

### 清理命令

```bash
claude-proxy clean
claude-proxy clean claude
claude-proxy clean openai
```

- `claude-proxy clean`
  恢复所有受管文件，并清除 `config.toml` 中所有受管字段。

- `claude-proxy clean claude`
  只恢复 Claude 相关文件，并清除 `config.toml` 中 Claude 相关字段。

- `claude-proxy clean openai`
  只恢复 Codex/OpenAI 相关文件，并清除 `config.toml` 中 OpenAI 相关字段。

说明：

- `clean` 系列命令只恢复配置，不会主动停止当前正在运行的代理进程
- 如果需要停止代理，使用 `claude-proxy stop`

### 运行命令

```bash
claude-proxy start
claude-proxy stop
```

- `claude-proxy start`
  使用当前配置启动本地代理，前台运行，启动成功后会输出监听地址和端口。

- `claude-proxy stop`
  停止当前受管代理进程。

## 配置文件

默认配置文件路径：

```bash
~/.claude-proxy/config.toml
```

也可以用 `--config` 指定：

```bash
claude-proxy config --config /path/to/config.toml
claude-proxy config claude --config /path/to/config.toml
claude-proxy config openai --config /path/to/config.toml
claude-proxy config get --config /path/to/config.toml
claude-proxy clean --config /path/to/config.toml
```

参考示例见 [config_example.toml](../config_example.toml)。

### 配置项

- `server_host`
  代理监听地址，默认 `127.0.0.1`

- `server_port`
  代理监听端口，默认 `8082`

- `base_url`
  OpenAI 兼容上游地址

- `api_key`
  上游 API Key

- `big_model`
  Claude `opus` 请求映射到的上游模型

- `middle_model`
  Claude `sonnet` 请求映射到的上游模型

- `small_model`
  Claude `haiku` 请求映射到的上游模型

- `default_claude_model`
  Claude Code 默认模型

- `home_dir`
  家目录基路径，默认 `~`

- `claude_dir`
  Claude 配置目录，默认 `~/.claude`

- `codex_dir`
  Codex 配置目录，默认 `~/.codex`

- `codex_provider`
  Codex 中要修改的 provider 名称，可选

### 字段归属

`claude-proxy config claude` / `claude-proxy clean claude` 管理这些字段：

- `server_port`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`
- `claude_dir`

`claude-proxy config openai` / `claude-proxy clean openai` 管理这些字段：

- `base_url`
- `api_key`
- `codex_dir`
- `codex_provider`

`claude-proxy config` / `claude-proxy clean` 会处理以上全部受管字段。

## Claude 与 Codex 的实际改动

### Claude

执行配置命令后，会修改 `~/.claude/settings.json` 中的受管部分：

- `ANTHROPIC_BASE_URL=http://localhost:<server_port>`
- `ANTHROPIC_API_KEY=arbitrary value`
- 默认模型相关环境变量
- `SessionStart` Hook：自动确保代理运行
- `SessionEnd` Hook：自动停止代理

### Codex

执行配置命令后，会修改：

- `~/.codex/config.toml`
  将目标 provider 的 `base_url` 改为配置文件中的 `base_url`

- `~/.codex/auth.json`
  将 `OPENAI_API_KEY` 改为配置文件中的 `api_key`

## 兼容性说明

### 上游 `base_url`

如果你填的是 provider 根地址，例如：

```toml
base_url = "https://newapis.xyz"
```

代理会自动把 Claude 转发流量发送到：

```text
/v1/chat/completions
```

如果你已经显式填写了 `/v1`，例如：

```toml
base_url = "https://newapis.xyz/v1"
```

则会保持该路径继续拼接兼容接口。

### 单机模式

本项目当前只支持单机模式：

- 不支持远端主机列表
- 不支持 `--host`
- 不支持旧版远端同步逻辑

## 常见工作流

### 首次接入

```bash
claude-proxy config
claude-proxy config get
claude-proxy start
```

### 只重配 Claude

```bash
claude-proxy config claude
```

### 只重配 OpenAI/Codex

```bash
claude-proxy config openai
```

### 全量还原

```bash
claude-proxy clean
```

### 只还原 Claude

```bash
claude-proxy clean claude
```

### 只还原 OpenAI/Codex

```bash
claude-proxy clean openai
```

## 旧命令迁移

当前命令以现在项目实现为准：

- 旧的 `serve` 已改为 `start`
- 不再使用 `config set`
- 不再使用多远端主机配置

也就是说，正确写法是：

```bash
claude-proxy config
claude-proxy config claude
claude-proxy config openai
```

不是：

```bash
claude-proxy config set
claude-proxy config set claude
```

## 开发

```bash
npm install
npm test
```

常用 npm script：

```bash
npm run config
npm run config:claude
npm run config:openai
npm run config:get
npm run clean
npm run clean:claude
npm run clean:openai
npm run start
npm run stop
```
