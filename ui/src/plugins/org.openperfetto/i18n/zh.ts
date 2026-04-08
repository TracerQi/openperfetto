// Copyright (C) 2026 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * 中文翻译
 */
export const zh: Record<string, string> = {
  // TopBar
  'topbar.title': 'OpenPerfetto',
  'topbar.toggleTheme': '切换主题',
  'topbar.toggleLanguage': '切换语言',
  'topbar.connectionStatus.connected': '已连接',
  'topbar.connectionStatus.connecting': '连接中...',
  'topbar.connectionStatus.disconnected': '未连接',
  'topbar.connectionStatus.error': '连接错误',

  // SearchPin Module
  'searchPin.title': '搜索与置顶',
  'searchPin.placeholder': '搜索进程/线程，如 surf+vsync',
  'searchPin.noResults': '未找到匹配结果',
  'searchPin.noResultsProcessThread': '不存在指定进程下的线程',
  'searchPin.searching': '搜索中...',
  'searchPin.pinAll': '全部置顶',
  'searchPin.unpinAll': '全部取消置顶',
  'searchPin.presets': '预设场景',
  'searchPin.noPresets': '暂无预置场景',
  'searchPin.savePreset': '保存为预设',
  'searchPin.deletePreset': '删除预设',
  'searchPin.history': '搜索历史',
  'searchPin.applyPreset': '应用预设',
  'searchPin.aiPinBadge': 'AI 置顶',

  // Markers Module
  'markers.title': '标记与跳转',
  'markers.noMarkers': '暂无标记',
  'markers.addMarker': '添加标记',
  'markers.deleteMarker': '删除标记',
  'markers.jumpTo': '跳转到',
  'markers.severity.info': '信息',
  'markers.severity.warning': '警告',
  'markers.severity.error': '错误',
  'markers.syncFromSession': '同步AI标记',
  'markers.clearAll': '清空所有',
  'markers.editNote': '编辑备注',

  // AI Chat Module
  'aiChat.title': 'AI 对话',
  'aiChat.placeholder': '请输入问题...',
  'aiChat.send': '发送',
  'aiChat.stop': '停止',
  'aiChat.clear': '清空对话',
  'aiChat.thinking': '正在思考...',
  'aiChat.welcome': '你好！我是 OpenPerfetto AI 助手。请问有什么可以帮助你的？',

  // Settings
  'settings.title': '设置',
  'settings.theme': '主题',
  'settings.theme.light': '浅色',
  'settings.theme.dark': '深色',
  'settings.language': '语言',
  'settings.connection': '连接设置',
  'settings.serverUrl': '服务器地址',
  'settings.reconnect': '重新连接',
  'settings.general': '常规',
  'settings.presets': '预设场景',
  'settings.about': '关于',
  'settings.newPreset': '新建场景',
  'settings.editPreset': '编辑场景',
  'settings.presetName': '场景名称',
  'settings.threadRules': '线程规则',
  'settings.addRule': '添加规则',
  'settings.processPattern': '进程名模式',
  'settings.threadPattern': '线程名模式',

  // Common
  'common.loading': '加载中...',
  'common.error': '错误',
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.close': '关闭',
  'common.collapse': '折叠',
  'common.expand': '展开',

  // Placeholder messages for Phase 1
  'placeholder.searchPin': '搜索与置顶 (Phase 5 实现)',
  'placeholder.markers': '标记与跳转 (Phase 5 实现)',
  'placeholder.aiChat': 'AI 对话 (Phase 2 实现)',
};
