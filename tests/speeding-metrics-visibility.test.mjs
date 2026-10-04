import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const speedingScript = scripts.find(script => script.includes("document.querySelectorAll('[data-speeding-value]')"));

assert.ok(speedingScript, 'Speeding Text script should exist');

const metric = {
    dataset: { speedingValue: '215', speedingPrefix: '+', speedingFilter: 'ctr' },
    textContent: '+215'
};
const lens = { setAttribute() {} };
const listeners = new Map();
const observers = [];

class FakeIntersectionObserver {
    constructor(callback) {
        this.callback = callback;
        this.targets = [];
        observers.push(this);
    }
    observe(target) {
        this.targets.push(target);
    }
    unobserve() {}
}

const windowObject = {
    IntersectionObserver: FakeIntersectionObserver,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, callback) {
        const callbacks = listeners.get(type) || [];
        callbacks.push(callback);
        listeners.set(type, callbacks);
    },
    dispatchEvent(event) {
        for (const callback of listeners.get(event.type) || []) callback(event);
    }
};

vm.runInContext(speedingScript, vm.createContext({
    document: {
        querySelectorAll: () => [metric],
        querySelector: () => lens
    },
    window: windowObject,
    IntersectionObserver: FakeIntersectionObserver,
    requestAnimationFrame() {}
}));

assert.equal(observers.length, 0, 'hidden portfolio content must not arm its observer during initial page load');

windowObject.dispatchEvent({ type: 'portfolio:view-visible' });
assert.equal(observers.length, 1, 'showing the portfolio should arm the observer');
assert.deepEqual(observers[0].targets, [metric]);

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} should exist`);
    const openingBrace = source.indexOf('{', start);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

const switchPageSource = extractFunction(html, 'switchPage');
const dispatched = [];
const elements = new Map([
    ['view-main', { classList: { add() {}, remove() {} } }],
    ['view-portfolio', { classList: { add() {}, remove() {} } }],
    ['nav-light', { classList: { add() {}, remove() {} } }],
    ['nav-dark', { classList: { add() {}, remove() {} } }],
    ['backToTop', { dataset: {} }]
]);
const switchContext = vm.createContext({
    document: {
        getElementById: id => elements.get(id),
        querySelector: () => ({ setAttribute() {} })
    },
    window: {
        scrollTo() {},
        dispatchEvent: event => dispatched.push(event.type)
    },
    requestAnimationFrame: callback => callback(),
    setTimeout: callback => callback(),
    CustomEvent: class {
        constructor(type) { this.type = type; }
    }
});

vm.runInContext(`${switchPageSource}; switchPage('portfolio');`, switchContext);
assert.deepEqual(dispatched, ['portfolio:view-visible'], 'portfolio navigation should announce that hidden content is visible');
assert.equal(elements.get('backToTop').dataset.theme, 'dark', 'the return button should follow the portfolio navigation theme');
vm.runInContext("switchPage('home');", switchContext);
assert.equal(elements.get('backToTop').dataset.theme, 'light', 'the return button should restore the homepage navigation theme');

console.log('PASS: Speeding Text arms only after the portfolio view becomes visible');
