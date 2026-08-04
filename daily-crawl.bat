@echo off
chcp 65001 >nul
echo ========================================
echo   考公工作台 - 每日自动爬取更新
echo   %date% %time%
echo ========================================

cd /d "C:\Users\UserX\WorkBuddy\2026-08-03-20-14-45"

set NODE=C:\Users\UserX\.workbuddy\binaries\node\versions\22.22.2\node.exe

echo.
echo [1/2] 运行爬虫...
"%NODE%" scripts/update-all.js
if errorlevel 1 (
    echo   ⚠️ 爬虫执行失败，跳过提交
    goto :end
)

echo.
echo [2/2] 提交并推送...
git add content/
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: 自动抓取更新 %date:~0,4%%date:~5,2%%date:~8,2%"
    git push origin main
    echo   ✅ 推送成功！
) else (
    echo   ℹ️ 内容无变化，跳过提交
)

:end
echo.
echo ========================================
echo   完成！时间: %time%
echo ========================================
