import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('        // Observe the section behind'), html.indexOf('        function switchPage('));
const classes = () => { const values = new Set(); return { remove(...items) { items.forEach(x => values.delete(x)); }, toggle(x, on) { on ? values.add(x) : values.delete(x); }, contains(x) { return values.has(x); } }; };
const ids = ['home','work-chapters','about','skills','experience','portfolio','contact'];
let active = 'home';
const elements = Object.fromEntries(ids.map(id => [id, { id, getClientRects: () => id === 'portfolio' && active !== 'portfolio' ? [] : [{}], getBoundingClientRect: () => ({top: id === active ? 0 : 1000, bottom: id === active ? 900 : 1500}) }]));
for (const id of ['nav-light','nav-dark']) elements[id] = {classList:classes(), offsetHeight:64, contains:() => false, querySelectorAll:() => []};
elements.backToTop = {dataset:{}};
let callback, options;
const events = {};
const context = {document:{ getElementById:id=>elements[id], querySelector:()=>null }, window:{innerHeight:900, IntersectionObserver:true, addEventListener:(name, cb)=>events[name]=cb}, IntersectionObserver:class {constructor(cb, opts){callback=cb;options=opts;} observe(){} disconnect(){}}, requestAnimationFrame:cb=>cb()};
vm.runInNewContext(source, context);
assert.equal(options.rootMargin, '-32px 0px -867px 0px');
for (const id of ids) {
 active=id;callback();
 const dark=['work-chapters','skills','portfolio','contact'].includes(id);
 assert.equal(elements['nav-light'].classList.contains('hidden'),dark,id);
 assert.equal(elements['nav-dark'].classList.contains('hidden'),!dark,id);
 assert.equal(elements.backToTop.dataset.theme,dark?'dark':'light',id);
}
active='about';context.window.syncNavigationTheme();
assert.equal(elements.backToTop.dataset.theme,'light');
context.window.innerHeight=600;events.resize();
assert.equal(options.rootMargin,'-32px 0px -567px 0px');
console.log('PASS: section themes, route resync, return button, and resize observation');
