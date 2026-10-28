import {sampleIE,runIE} from './ie-des-practice.js';

function grader(meta) {
    switch (meta.grader || 'knapsack') {
        case 'knapsack': return {sample:window.ScipOJJudge.genKnapsack,run:window.ScipOJJudge.runL1};
        case 'assignment': return {sample:window.ScipOJAssignment.genAssignment,run:window.ScipOJAssignment.runL1Assignment};
        case 'ie_des01': return {sample:sampleIE,run:runIE};
        default: throw new Error('本题尚未配置浏览器练习评分器');
    }
}

export function sampleInstance(meta) {
    const {optimal_value: unused, ...instance} = grader(meta).sample(Number(meta.seed_base || 20261021));
    return instance;
}

export function runPractice(solve, meta) {
    return grader(meta).run(solve, meta);
}
