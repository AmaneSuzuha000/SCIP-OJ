const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const markdown=String.raw`# 课程公式
行内 $x_1 + y_{ij}$ 与 \(\frac{a}{b}\)。

$$
\begin{aligned}
\max\quad & \sum_{i=1}^{n} c_i x_i \\
\text{s.t.}\quad & \sum_{i=1}^{n} a_i x_i \le b
\end{aligned}
$$

\[\begin{bmatrix}1&2\\3&4\end{bmatrix}\]

| 指标 | 定义 |
| --- | --- |
| 利用率 | $\rho=\lambda/(c\mu)$ |

INLINE_CODE，价格 \$5 和 $10。

~~~python
text = "$not_math$"
~~~

$\href{javascript:alert(1)}{unsafe}$
<img src="missing-fixture-image" onerror="window.__unsafe=true">
`.replace('INLINE_CODE', () => '代码 `$not_math$`');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:1100,height:850}}),fontErrors=[];
  page.on('requestfailed',request=>{if(/\.(woff2?|ttf)/.test(request.url()))fontErrors.push(request.url());});
  await page.route('**/js/python_runtime.js*',r=>r.fulfill({contentType:'text/javascript',body:`window.ScipOJRuntime={prewarm:async()=>{},isReady:()=>true,getStatus:()=>({phase:'ready'}),hideNotebook(){},detachNotebook(){}};`}));
  await page.route('**/problems/P001_knapsack/README.md',r=>r.fulfill({contentType:'text/plain',body:markdown}));
  await page.route('**/docs/math-fixture.md',r=>r.fulfill({contentType:'text/plain',body:markdown}));
  const origin=process.env.SCIP_UI_TEST_ORIGIN||'http://127.0.0.1:8765';
  for(const [url,container] of [['/index.html#P001','#readme'],['/doc.html?f=math-fixture.md','#md']]) {
   await page.goto(origin+url);
   await page.locator(container+' .katex').first().waitFor();
   assert.equal(await page.locator(container+' .katex').count(),6);
   assert.equal(await page.locator(container+' .katex-display').count(),2);
   assert.equal(await page.locator(container+' pre .katex,'+container+' code .katex').count(),0);
   assert.match(await page.locator(container+' pre code').innerText(),/\$not_math\$/);
   assert.equal(await page.locator(container+' [onerror]').count(),0);
   assert.equal(await page.locator(container+' a[href^="javascript:"]').count(),0);
   assert.equal(await page.evaluate(()=>window.__unsafe),undefined);
   await page.evaluate(()=>document.fonts.ready);
   const fonts=await page.evaluate(()=>[...document.fonts].filter(f=>f.family.includes('KaTeX')&&f.status==='loaded').length);
   assert.ok(fonts>0,'Self-hosted math fonts must load');
   await page.setViewportSize({width:390,height:844});
   const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert.ok(size.scroll<=size.width+2,'Math stays inside the mobile content width');
  }
  assert.deepEqual(fontErrors,[]);
  fs.mkdirSync(process.env.SCIP_UI_SCREENSHOT_DIR||'ui-artifacts',{recursive:true});
  await page.screenshot({path:(process.env.SCIP_UI_SCREENSHOT_DIR||'ui-artifacts')+'/11-math-mobile.png',fullPage:true});
  console.log('Portal/document LaTeX delimiters, matrices, aligned blocks, fonts, code exclusion and sanitization: PASS');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
