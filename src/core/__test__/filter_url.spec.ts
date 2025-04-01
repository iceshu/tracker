import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 定义需要忽略的消息模式
const ignoredPatterns = [
    'twitter',
    't.co/1/i/adsct',
    'Cannot parse given Error object',
    'px.ads.linkedin.',
    '/faceswap/gallery/cover/',
    'googleads.g.doubleclick.net',
    'googletagmanager',
    'aloha-extension://nativeCall',
    '.agora.',
    '/videos/faceswap/gallery/cosplay/',
    'web-2.statscollector.sd-rtn.com',
    'statscollector-1.agora.io',
    'statscollector',
    '.clarity.',
    '.redditstatic.',
    '.g2crowd.',
    '.hubapi.com.',
    '/interface/detect-api/',
    '/api/v6/content/file/uploadurl',
    '.amazonaws.com',
    '.reddit.',
];
const createFilterRegExp = (patterns: string[]) => {
    // 转义特殊字符并将模式组合成一个正则表达式
    const escapedPatterns = patterns.map(pattern => pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(escapedPatterns.join('|'));
};

describe('check filter url is work', () => {
    ['https://conversions-config.reddit.com/v1/pixel/error','https://conversions-config.reddit.com/v1/pixel/error'].forEach(url => {
        it(`should return true for ${url}`, () => {
            const filterRegExp = createFilterRegExp(ignoredPatterns);
            expect(filterRegExp.test(url)).toBe(true);
        });
    });
});