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

import {zh} from './zh';
import {en} from './en';

export type Locale = 'zh' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  zh,
  en,
};

/**
 * 获取指定语言的翻译文本
 *
 * @param locale 语言代码
 * @param key 翻译键
 * @returns 翻译后的文本，如果找不到则返回键本身
 */
export function t(locale: Locale, key: string): string {
  const localeTranslations = translations[locale];
  if (localeTranslations && key in localeTranslations) {
    return localeTranslations[key];
  }
  // 回退到英文
  if (locale !== 'en' && key in translations.en) {
    return translations.en[key];
  }
  // 如果都找不到，返回键本身
  return key;
}

/**
 * 获取当前支持的所有语言列表
 */
export function getSupportedLocales(): Locale[] {
  return ['zh', 'en'];
}

/**
 * 检查是否支持指定语言
 */
export function isLocaleSupported(locale: string): locale is Locale {
  return locale === 'zh' || locale === 'en';
}
