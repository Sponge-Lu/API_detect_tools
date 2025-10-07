@echo off
REM {{ AURA-X: Add - Tauri项目打包脚本 }}
REM {{ Confirmed via 寸止: 一键打包成Windows exe }}

echo ========================================
echo   API检测工具 - Tauri打包
echo ========================================
echo.

echo [1/3] 清理旧的构建文件...
if exist "dist\" rmdir /s /q "dist"
if exist "src-tauri\target\release\" rmdir /s /q "src-tauri\target\release"
echo.

echo [2/3] 构建前端资源...
call npm run build
if errorlevel 1 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)
echo ✓ 前端构建完成
echo.

echo [3/3] 打包Tauri应用...
call npm run tauri:build
if errorlevel 1 (
    echo [错误] Tauri打包失败
    pause
    exit /b 1
)
echo.

echo ========================================
echo   ✓ 打包完成！
echo ========================================
echo.
echo 输出位置:
echo   src-tauri\target\release\bundle\
echo.

REM 检查输出文件
if exist "src-tauri\target\release\bundle\msi\*.msi" (
    echo ✓ MSI安装包已生成
    explorer /select,"src-tauri\target\release\bundle\msi"
) else if exist "src-tauri\target\release\bundle\nsis\*.exe" (
    echo ✓ NSIS安装包已生成
    explorer /select,"src-tauri\target\release\bundle\nsis"
) else (
    echo ⚠ 未找到安装包，请检查src-tauri\target\release\bundle\目录
)

pause

