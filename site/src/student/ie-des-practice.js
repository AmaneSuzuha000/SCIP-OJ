import '../../js/simulation-core.js';

// Public browser exercises only. Formal grading retains its server-only seeds.
export function sampleIE(seed) {
    const s = Number(seed) >>> 0;
    return {arrivalMean: 6 + s % 10, serviceMean: 12 + s % 13,
        servers: 2 + s % 4, horizon: 600, warmup: 90, seed: s || 1};
}

export function referenceIE(instance) {
    return window.IESimLab.simulate(window.IESimLab.workload(instance, instance.seed),
        instance.servers, instance.warmup, instance.horizon);
}

export function gradeIE(result, instance, meta) {
    const weights = {F:15,C:25,I:20,O:40,R:0,...meta.weights};
    const breakdown = Object.fromEntries(Object.keys(weights).map(key => [key, 0]));
    const messages = [];
    const pack = (message, valid = false) => {
        messages.push(message);
        const score = Object.values(breakdown).reduce((a,b) => a+b, 0);
        return {score, passed:valid && score >= (meta.pass_score ?? 90), breakdown, messages};
    };
    const fields = ['avgWait','throughput','utilization','meanQueue','meanWip','completions'];
    if (!result || Array.isArray(result) || typeof result !== 'object' || fields.some(key => !(key in result)))
        return pack('缺少必要的仿真返回指标');
    const numeric = value => {
        if (typeof value === 'number' || typeof value === 'boolean') return Number(value);
        if (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return Number(value);
        return NaN;
    };
    const m = Object.fromEntries(fields.map(key => [key, numeric(result[key])]));
    if (Object.values(m).some(value => !Number.isFinite(value))) return pack('返回指标必须是有限数值');
    breakdown.F = weights.F;
    const eps = meta.eps_feas ?? 1e-4;
    if (m.utilization < -eps || m.utilization > 1+eps || m.avgWait < -eps ||
        m.meanQueue < -eps || m.meanWip < m.meanQueue-eps || m.completions < 0)
        return pack('仿真指标超出物理边界');
    breakdown.C = weights.C;
    const throughput = 60*m.completions/Math.max(1, instance.horizon-instance.warmup);
    const diff = Math.abs(m.throughput-throughput);
    if (diff > .2 && diff/Math.max(1, throughput) > .05) return pack('吞吐率与完工数不一致');
    breakdown.I = weights.I;
    const ref = referenceIE(instance);
    const gap = (Math.abs(m.avgWait-ref.avgWait)/Math.max(1,ref.avgWait) +
        Math.abs(m.utilization-ref.utilization)/Math.max(.1,ref.utilization))/2;
    const points = gap <= (meta.eps_obj ?? 1e-3) ? 40 : gap <= .02 ? 32 : gap <= .05 ? 24 : gap <= .1 ? 16 : 0;
    breakdown.O = Math.round(points*weights.O/40);
    return pack(`仿真基准偏差=${gap.toExponential(2)}`, true);
}

export async function runIE(solve, meta) {
    const instances = [];
    for (let i=0; i<(meta.n_instances_l1 ?? 3); i++) {
        const seed = (meta.seed_base ?? 20261028)+i, instance = sampleIE(seed);
        let report;
        try { report = gradeIE(await solve({...instance}), instance, meta); }
        catch (error) {
            report = {score:0,passed:false,breakdown:{F:0,C:0,I:0,O:0,R:0},messages:['运行错误: '+error.message]};
        }
        instances.push({...report, seed});
    }
    const avg = key => Math.round(instances.reduce((total,row) => total+key(row),0)/instances.length);
    const score = avg(row => row.score);
    return {problem_id:meta.id, score, passed:score >= (meta.pass_score ?? 90), instances,
        breakdown:Object.fromEntries(Object.keys(instances[0].breakdown).map(key => [key,avg(row => row.breakdown[key])])),
        messages:[`N=${instances.length} 实例平均分`]};
}
