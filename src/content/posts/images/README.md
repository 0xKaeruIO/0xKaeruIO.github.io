# 文章配图

每篇文章一个子目录，目录名和 Markdown 文件名（不含 `.md`）保持一致：

```
src/content/posts/
├── my-article.md
└── images/
    └── my-article/
        ├── cover.png
        └── screenshot.webp
```
```markdown
![截图](./images/my-article/screenshot.webp)
*图注写在图片下一行，用斜体。*
```