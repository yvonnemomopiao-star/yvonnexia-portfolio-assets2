import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = html.match(/<section id="work-chapters"[\s\S]*?<\/section>/)?.[0];
assert.ok(section, 'the chapter directory should exist');
assert.ok(html.indexOf('id="home"') < html.indexOf(section));
assert.ok(html.indexOf(section) < html.indexOf('<section id="about"'));
const links = [...section.matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*data-page="([^"]+)"[^>]*data-target="([^"]+)"/g)];
assert.deepEqual(links.map(link => link[1]), ['proj-01', 'proj-07', 'proj-09']);
assert.match(html, /href="#work-chapters" class="hero-scroll-cue"/);

const switchSource = html.slice(html.indexOf('function switchPage('), html.indexOf('function throttle('));
for (const [, href, page, target] of links) {
    assert.equal(href, target, 'the link and navigation destination must agree');
    assert.ok(html.includes(`id="${target}"`), 'the target must exist in the portfolio');
    const classes = initial => {
        const values = new Set(initial);
        return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
    };
    const elements = {
        'view-main': { classList: classes([]) },
        'view-portfolio': { classList: classes(['view-hidden']) },
        'nav-light': { classList: classes([]) },
        'nav-dark': { classList: classes(['hidden']) },
        backToTop: { dataset: {} },
        [target]: { getBoundingClientRect: () => ({ top: 1200 }) }
    };
    const scrolls = [];
    const context = vm.createContext({
        document: {
            getElementById: id => elements[id],
            querySelector: () => ({ setAttribute() {} }),
            body: { getBoundingClientRect: () => ({ top: -200 }) }
        },
        window: { scrollTo: value => scrolls.push(value), dispatchEvent() {} },
        setTimeout: callback => callback(),
        requestAnimationFrame: callback => callback(),
        CustomEvent: class { constructor(type) { this.type = type; } }
    });
    vm.runInContext(switchSource, context);
    context.switchPage(page, target);
    assert.equal(elements['view-main'].classList.contains('view-hidden'), true);
    assert.equal(elements['view-portfolio'].classList.contains('view-hidden'), false);
    assert.equal(elements['nav-dark'].classList.contains('hidden'), false);
    assert.equal(elements.backToTop.dataset.theme, 'dark');
    assert.equal(scrolls.at(-1).top, 1320, 'chapter scrolling must retain the navigation offset');
}
console.log('PASS: directory order, destinations, portfolio switching, and scroll positioning');
