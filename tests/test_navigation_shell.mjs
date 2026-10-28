import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
for (const name of readdirSync('.portal-build/html')) {
    const html=readFileSync('.portal-build/html/'+name,'utf8');
    assert.equal((html.match(/shared-topbar/g)||[]).length,1,name+' must have one shared header');
    for(const id of ['nav-course-space','nav-learning-space']) assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,name+' '+id);
    assert.ok(!html.includes('PLATFORM_HEADER'),name+' was not assembled');
    assert.ok(!html.includes('data-header-services'),name+' still contains a header template');
    for(const href of html.matchAll(/href="([^"]+)"/g)) assert.ok(!/^(lab|repl)\//.test(href[1]),name+' exposes a legacy standalone entry');
}
const portal=readFileSync('.portal-build/html/index.html','utf8');
assert.ok(portal.includes('#notebook/01_P001_knapsack_PySCIPOpt.ipynb'));
assert.ok(portal.includes('#notebook/06_IE_Stochastic_Inventory_PySCIPOpt.ipynb'));
console.log('One generated navigation shell, two owned spaces and canonical Notebook entries: PASS');
