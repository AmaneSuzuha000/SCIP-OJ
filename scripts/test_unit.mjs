import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
function run(program,args,options={}) {
    const result=spawnSync(program,args,{stdio:'inherit',timeout:120000,...options});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
// Python on Windows defaults to the ANSI code page for source decoding, which
// fails on the Chinese doc strings and test names in this repo. Forcing UTF-8
// keeps the run identical to Linux CI.
const python=process.platform==='win32'?'python':'python3';
run(python,['-m','unittest','discover','-s','tests','-p','test_*.py','-v'],
    {env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
for (const test of readdirSync('tests').sort()) {
    // The _browser.cjs files were Playwright runs against the retired portal
    // pages and went with them, so there is no browser suffix left to skip.
    if (!/^test_.*\.(cjs|mjs)$/.test(test) || test==='test_grading_database.mjs') continue;
    run(process.execPath,['tests/'+test]);
}
