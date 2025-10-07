@echo off
REM {{ AURA-X: Add - Tauri项目初始化脚本 }}
REM {{ Confirmed via 寸止: Windows环境一键安装依赖 }}

echo ========================================
echo   API检测工具 - Tauri版本初始化
echo ========================================
echo.

echo [1/4] 检查Node.js环境...
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Node.js，请先安装Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)
echo ✓ Node.js已安装
echo.

echo [2/4] 检查Rust环境...
rustc --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Rust，请先安装Rust
    echo 下载地址: https://www.rust-lang.org/tools/install
    pause
    exit /b 1
)
echo ✓ Rust已安装
echo.

echo [3/4] 安装前端依赖...
call npm install
if errorlevel 1 (
    echo [错误] 前端依赖安装失败
    pause
    exit /b 1
)
echo ✓ 前端依赖安装完成
echo.

echo [4/4] 构建Rust依赖...
cd src-tauri
cargo fetch
if errorlevel 1 (
    echo [错误] Rust依赖下载失败
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✓ Rust依赖准备完成
echo.

echo ========================================
echo   ✓ 初始化完成！
echo ========================================
echo.
echo 运行项目:
echo   npm run tauri:dev
echo.
echo 打包项目:
echo   npm run tauri:build
echo.
pause

