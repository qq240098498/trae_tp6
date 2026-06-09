@echo off
chcp 65001 >nul
title 重置数据

echo.
echo ⚠️  警告：此操作将删除所有业务数据并重置为初始状态！
echo.
set /p confirm=确认继续？(输入 YES 确认): 

if /i not "%confirm%"=="YES" (
    echo 已取消操作。
    pause
    exit /b 0
)

cd /d "%~dp0"

if exist "cinema_data.json" (
    del /f /q "cinema_data.json"
    echo.
    echo ✅ 旧数据文件已删除
)

echo.
echo 正在重新初始化数据...
call npm run init-db

echo.
echo ✅ 数据已重置完成！
pause
