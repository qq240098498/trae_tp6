@echo off
chcp 65001 >nul
title 星幕私人影吧运营系统

echo.
echo ============================================================
echo      ★ 星幕私人影吧运营系统 - 启动脚本 ★
echo ============================================================
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo [1/2] 检测到未安装依赖，正在安装...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo ❌ 依赖安装失败，请检查网络或手动执行 npm install
        pause
        exit /b 1
    )
    echo.
    echo ✅ 依赖安装完成！
)

if not exist "cinema_data.json" (
    echo.
    echo [2/2] 正在初始化数据...
    call npm run init-db
    echo.
    echo ✅ 数据初始化完成！
)

echo.
echo 🚀 正在启动服务...
echo.
echo ============================================================
echo   服务启动后，请在浏览器中访问:
echo   👉  本机访问:  http://localhost:3000
echo   👉  局域网:    http://你电脑的IP:3000
echo ============================================================
echo.
echo   按 Ctrl+C 可停止服务
echo.

call npm start
pause
