import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
function run(program,args) {
    const result=spawnSync(program,args,{stdio:'inherit',timeout:120000});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
run('python3',['-m','unittest','discover','-s','tests','-p','test_*.py','-v']);
for (const test of readdirSync('tests').sort()) {
    if (!/^test_.*\.(cjs|mjs)$/.test(test) || test.endsWith('_browser.cjs') || test==='test_grading_database.mjs') continue;
    run(process.execPath,['tests/'+test]);
}
