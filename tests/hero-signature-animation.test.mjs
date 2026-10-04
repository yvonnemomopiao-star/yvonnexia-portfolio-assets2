import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /font-family:\s*"QEHADEX"/);
assert.match(html, /color:\s*#a4a7bf/);
assert.match(html, /font-size:\s*calc\(2\.35cqw \+ 3px\)/);
assert.match(html, /font-style:\s*oblique 12deg/);
assert.match(html, /transform:\s*skewX\(-16deg\)/);
assert.match(html, /transform-origin:\s*left bottom/);
assert.match(html, /\.hero-signature\s*\{[\s\S]*?top:\s*90%/);
assert.match(html, /className = 'letter-3d-swap-char-box-item'/);
assert.match(html, /transform:\s*translateZ\(-0\.5lh\)/);
assert.match(html, /rotateX\(-90deg\) translateZ\(0\.5lh\)/);
assert.match(html, /const staggerInterval = 0\.05/);
assert.match(html, /frontFace\.animate\(/);
assert.match(html, /backFace\.animate\(/);
assert.match(html, /transform:\s*'rotateX\(0deg\)'/);
assert.match(html, /const replayDelay = 4200/);
assert.match(html, /mouseenter/);

console.log("PASS: hero signature keeps the licensed animation structure and existing styling");
