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
 * English translations
 */
export const en: Record<string, string> = {
  // TopBar
  'topbar.title': 'OpenPerfetto',
  'topbar.toggleTheme': 'Toggle Theme',
  'topbar.toggleLanguage': 'Toggle Language',
  'topbar.connectionStatus.connected': 'Connected',
  'topbar.connectionStatus.connecting': 'Connecting...',
  'topbar.connectionStatus.disconnected': 'Disconnected',
  'topbar.connectionStatus.error': 'Connection Error',

  // SearchPin Module
  'searchPin.title': 'Search & Pin',
  'searchPin.placeholder': 'Search process/thread name...',
  'searchPin.noResults': 'No results',
  'searchPin.pinAll': 'Pin All',
  'searchPin.unpinAll': 'Unpin All',
  'searchPin.presets': 'Preset Scenes',
  'searchPin.savePreset': 'Save as Preset',
  'searchPin.deletePreset': 'Delete Preset',

  // Markers Module
  'markers.title': 'Markers & Jump',
  'markers.noMarkers': 'No markers yet',
  'markers.addMarker': 'Add Marker',
  'markers.deleteMarker': 'Delete Marker',
  'markers.jumpTo': 'Jump to',
  'markers.severity.info': 'Info',
  'markers.severity.warning': 'Warning',
  'markers.severity.error': 'Error',

  // AI Chat Module
  'aiChat.title': 'AI Chat',
  'aiChat.placeholder': 'Type your question...',
  'aiChat.send': 'Send',
  'aiChat.stop': 'Stop',
  'aiChat.clear': 'Clear Chat',
  'aiChat.thinking': 'Thinking...',
  'aiChat.welcome':
    "Hello! I'm the OpenPerfetto AI assistant. How can I help you?",

  // Settings
  'settings.title': 'Settings',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.language': 'Language',
  'settings.connection': 'Connection Settings',
  'settings.serverUrl': 'Server URL',
  'settings.reconnect': 'Reconnect',

  // Common
  'common.loading': 'Loading...',
  'common.error': 'Error',
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.close': 'Close',
  'common.collapse': 'Collapse',
  'common.expand': 'Expand',

  // Placeholder messages for Phase 1
  'placeholder.searchPin': 'Search & Pin (Coming in Phase 5)',
  'placeholder.markers': 'Markers & Jump (Coming in Phase 5)',
  'placeholder.aiChat': 'AI Chat (Coming in Phase 2)',
};
