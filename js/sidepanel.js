// sidepanel.js - 此文件已拆分为模块化文件，位于 js/modules/sp-*.js
// 加载顺序请参考 sidepanel.html 中的 <script> 标签
// 原始文件备份: js/sidepanel.js.bak
//
// 模块列表:
//   sp-core.js          - 全局状态、DOM元素、工具函数、数据加载、Tab切换、初始化入口
//   sp-prompts.js       - AI 提示词模块（分类、筛选、列表渲染、增删改）
//   sp-scratchpad.js    - 便签模块（列表渲染、编辑、粘贴处理）
//   sp-readlater.js     - 稍后阅读模块
//   sp-gallery.js       - 图集模块（多选、灯箱预览、拖拽上传）
//   sp-tools.js         - 工具箱模块（单位换算、编码解码、IP查询、油价、汇率、UUID、Pip等）
//   sp-2fa.js           - 2FA 验证码模块（获取、渲染、定时刷新、导入导出、弹窗管理）
//   sp-ai-provider.js   - AI Provider 模块（CRUD、导入导出、过滤、拖拽排序）
//   sp-ai-collection.js - AI 合集模块（标签管理、iframe加载、全部服务弹窗、拖拽排序）
//   sp-hot.js           - 热门榜单模块（Tab排序、拖拽、数据获取）
//   sp-clock.js         - 国际时钟模块 + 初始化调用入口
