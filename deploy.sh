#!/usr/bin/env bash
# 一键部署到 GitHub Pages
# 用法：把下面两个变量改成你自己的，然后在 Git Bash 里运行  bash deploy.sh
set -e

GITHUB_USER="stella15272598393"      # ← 你的 GitHub 用户名
REPO_NAME="gongkao-app"              # ← 你在 github.com 上新建的仓库名（英文 slug）

REMOTE="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

# 若已存在 origin 先移除，避免冲突
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
git branch -M main
git push -u origin main

echo ""
echo "✅ 代码已推送到 GitHub。"
echo "➡️  下一步：打开 https://github.com/${GITHUB_USER}/${REPO_NAME}/settings/pages"
echo "     Source 选 『main』，文件夹选 『/ (root)』，点 Save。"
echo "⏳  等待约 1 分钟（Pages 首次构建需要一点时间）。"
echo ""
echo "📱 手机访问地址： https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo "     打开后点浏览器菜单 → 『添加到主屏幕』，就是你的备考 APP 了。"
