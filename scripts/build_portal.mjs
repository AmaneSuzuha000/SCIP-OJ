import {build} from 'esbuild';
import {mkdir,writeFile,copyFile,readFile,readdir} from 'node:fs/promises';
import {renderPage} from '../site/layout/render.mjs';
await mkdir('.portal-build/js',{recursive:true});
const entries={app:'site/src/student/index.js',platform:'site/src/platform/index.js',teacher:'site/src/teacher/index.js',markdown:'site/src/markdown/index.js'};
const common={outdir:'.portal-build',entryNames:'js/[name]',assetNames:'assets/katex/[name]-[hash]',
    loader:{'.woff':'file','.woff2':'file','.ttf':'file'},bundle:true,format:'iife',target:'es2020',sourcemap:'external',logLevel:'info'};
await Promise.all([
    build({...common,entryPoints:{app:entries.app,platform:entries.platform,teacher:entries.teacher}}),
    build({...common,entryPoints:{markdown:entries.markdown},minify:true})
]);
await mkdir('.portal-build/assets/katex',{recursive:true});
await copyFile('node_modules/katex/LICENSE','.portal-build/assets/katex/LICENSE');
await mkdir('.portal-build/html',{recursive:true});
for (const name of (await readdir('site')).filter(name=>name.endsWith('.html'))) {
    await writeFile('.portal-build/html/'+name,await renderPage(name,await readFile('site/'+name,'utf8')));
}
await writeFile('.portal-build/manifest.json',JSON.stringify({entries:Object.keys(entries),format:'iife'}));
