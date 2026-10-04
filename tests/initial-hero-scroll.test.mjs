import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startupScript = html.match(/<script>([\s\S]*?site-loading[\s\S]*?)<\/script>/)?.[1];

assert.ok(startupScript, 'initial loading script should exist');

function runStartup(hash) {
    const scrollCalls = [];
    const window = {
        location: { hash },
        scrollTo: (...args) => scrollCalls.push(args)
    };
    const history = { scrollRestoration: 'auto' };
    const context = vm.createContext({
        document: {
            documentElement: {
                classList: { add() {} }
            }
        },
        history,
        performance: { now: () => 42 },
        window
    });

    vm.runInContext(startupScript, context);
    return { history, scrollCalls, window };
}

const regularOpen = runStartup('');
assert.equal(regularOpen.history.scrollRestoration, 'manual');
assert.equal(regularOpen.window.__siteStartAtHero, true);
assert.equal(regularOpen.scrollCalls.length, 1, 'ordinary opening should reset to the hero immediately');

regularOpen.window.__resetSiteScroll();
assert.equal(regularOpen.scrollCalls.length, 2, 'the loader can reset to the hero again before revealing the page');

const deepLinkOpen = runStartup('#about');
assert.equal(deepLinkOpen.history.scrollRestoration, 'manual');
assert.equal(deepLinkOpen.window.__siteStartAtHero, false);
assert.equal(deepLinkOpen.scrollCalls.length, 0, 'a deliberate deep link should keep its destination');

console.log('PASS: initial loading starts at the hero while deep links keep their destination');
