import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.equal((html.match(/\bonclick\s*=/gi) || []).length, 0, 'inline onclick handlers should be removed');

const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map(match => match[0]);
const anchorsWithoutHref = anchors.filter(anchor => !/\bhref\s*=/.test(anchor));
assert.equal(anchorsWithoutHref.length, 0, 'every anchor should have a real href');

assert.match(
    html,
    /id="project01CompareSlider"[^>]*aria-label="调整修改前与修改后主视觉的对比范围"/,
    'the comparison slider should have an accessible name'
);
assert.match(
    html,
    /setAttribute\('aria-valuetext', `修改后画面显示 \$\{sliderValue\}%`\)/,
    'the comparison slider should announce its current visual ratio'
);
assert.match(html, /a\[data-page\]/, 'navigation should use delegated events on real links');
assert.match(html, /:focus-visible/, 'keyboard focus should remain visible');
assert.doesNotMatch(
    html,
    /\.project-compare-divider::before/,
    'the comparison divider should not be visually widened by a frosted pseudo-element'
);
assert.match(html, /\.project-compare-divider\s*\{[\s\S]*?background:\s*rgba\(10, 10, 10, \.8\)/, 'the divider should use the dark navigation material');
assert.match(html, /id="project01CompareHandle"[^>]*\bw-\[2px\]/, 'the divider should be exactly two pixels wide');

console.log('PASS: navigation, inline actions, focus, and comparison slider accessibility');
