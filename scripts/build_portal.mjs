import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('.portal-build/js',{recursive:true});
await build({entryPoints:{app:'site/src/student/index.js',platform:'site/src/platform/index.js',teacher:'site/src/teacher/index.js'},outdir:'.portal-build/js',bundle:true,format:'iife',target:'es2020',sourcemap:true,logLevel:'info'});
await writeFile('.portal-build/manifest.json',JSON.stringify({entries:['app','platform','teacher'],format:'iife'}));
