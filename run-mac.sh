#!/usr/bin/env bash

set -euo pipefail

# ==========================================
# API Hub Management Tools - Mac运行脚本
# 用途：一键在Mac上安装依赖、启动开发、构建与打包
# 使用：
#   ./run-mac.sh dev       启动开发模式（Electron + Vite）
#   ./run-mac.sh prod      构建后以生产模式运行（本地Electron）
#   ./run-mac.sh build     仅构建（主进程 + 渲染进程）
#   ./run-mac.sh dist      打包mac应用（dmg/zip）
#   ./run-mac.sh clean     清理构建产物
# ==========================================

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

info()  { echo -e "\033[32m[INFO]\033[0m $*"; }
warn()  { echo -e "\033[33m[WARN]\033[0m $*"; }
error() { echo -e "\033[31m[ERROR]\033[0m $*"; }

# Electron与electron-builder下载镜像（避免npm未知配置警告，使用环境变量）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

# 降噪：关闭macOS系统活动日志与Electron安全/调试日志输出
export OS_ACTIVITY_MODE=disable
export ELECTRON_ENABLE_LOGGING=0
export ELECTRON_DISABLE_SECURITY_WARNINGS=1

## 检查当前系统是否为macOS
## 说明：确保脚本仅在Mac执行，避免环境不一致
ensure_macos() {
  if [[ "$(uname)" != "Darwin" ]]; then
    error "当前系统不是 macOS，已退出"
    exit 1
  fi
}

## 检查 Node.js 版本是否满足要求
## 要求：Node >= 18（Vite 5 与 Electron 28 均要求）
check_node() {
  if ! command -v node >/dev/null 2>&1; then
    error "未检测到 Node.js，请先安装（建议使用 nvm 或 Homebrew）"
    exit 1
  fi
  local major
  major=$(node -v | sed -E 's/^v([0-9]+).*$/\1/')
  if (( major < 18 )); then
    error "Node.js 版本过低（当前 v$(node -v)），请升级到 >= v18"
    exit 1
  fi
}

## 安装项目依赖
## 策略：优先使用 npm ci（锁定依赖），无锁则使用 npm install
install_deps() {
  cd "$ROOT_DIR"
  if [[ -d node_modules ]]; then
    info "依赖已安装，跳过安装"
    return
  fi
  if [[ -f package-lock.json ]]; then
    info "安装依赖（npm ci）..."
    npm ci
  else
    info "安装依赖（npm install）..."
    npm install
  fi
}

## 启动开发模式
## 行为：并行启动主进程（Electron）与渲染进程（Vite）
start_dev() {
  cd "$ROOT_DIR"
  printf "\033c"
  clear
  info "关闭已有的开发进程（Electron/Vite）..."
  # 关闭 Electron 进程
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "Electron.app/Contents/MacOS/Electron" || true
    pkill -f "electron" || true
  fi
  # 释放常见端口（5173/5174/5175）
  if command -v lsof >/dev/null 2>&1; then
    (lsof -ti :5173 -sTCP:LISTEN | xargs -r kill -9) || true
    (lsof -ti :5174 -sTCP:LISTEN | xargs -r kill -9) || true
    (lsof -ti :5175 -sTCP:LISTEN | xargs -r kill -9) || true
  fi
  info "启动开发模式（Electron + Vite）..."
  npm run dev
}

## 构建项目产物
## 行为：编译主进程与渲染进程
do_build() {
  cd "$ROOT_DIR"
  info "构建主进程与渲染进程..."
  npm run build
  info "构建完成：dist/ 与 dist-renderer/"
}

## 生产模式运行应用
## 行为：构建后使用 Electron 运行打包前的本地产物
start_prod() {
  cd "$ROOT_DIR"
  do_build
  info "以生产模式运行 Electron..."
  # Electron 会读取 package.json 的 main 字段（dist/main.js）
  npx electron .
}

## 打包 mac 应用（dmg/zip）
## 前置：需已构建产物
pack_mac() {
  cd "$ROOT_DIR"
  info "打包 macOS 应用（dmg/zip）..."
  npm run dist:mac
  info "打包输出目录：release/"
}

## 清理构建产物
## 行为：删除常见产物目录
do_clean() {
  cd "$ROOT_DIR"
  info "清理构建产物..."
  rm -rf dist dist-renderer release node_modules/.cache
  info "已清理"
}

main() {
  ensure_macos
  check_node
  install_deps

  local cmd=${1:-dev}
  case "$cmd" in
    dev)   start_dev;;
    prod)  start_prod;;
    build) do_build;;
    dist)  pack_mac;;
    clean) do_clean;;
    *)
      warn "未知命令：$cmd"
      echo "用法：$0 [dev|prod|build|dist|clean]"
      exit 2
      ;;
  esac
}

main "$@"
