@echo off
chcp 65001 >nul
cd /d "C:\Users\UserX\WorkBuddy\2026-08-03-20-14-45"

REM Node 路径：默认用 PATH 里的 node；若命令行不识别 node，改成绝对路径
set "NODE=node"
REM set "NODE=C:\Users\UserX\.workbuddy\binaries\node\versions\22.22.2\node.exe"

echo [%date% %time%] 开始抓取最新内容...
"%NODE%" scripts/update-all.js
if errorlevel 1 (
    echo [警告] 抓取脚本出错，保留上次内容，仍尝试提交 meta。
)

echo [%date% %time%] 提交并推送到 GitHub...
git add content/
git -c user.name="小桃自动抓取" -c user.email="bot@workbuddy.local" commit -m "chore: 自动抓取更新 %date:~0,4%-%date:~5,2%-%date:~8,2%" >nul 2>&1 || echo 无变化，跳过提交
git push
echo [%date% %time%] 完成。
