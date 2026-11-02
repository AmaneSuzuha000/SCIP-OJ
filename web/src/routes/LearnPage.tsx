import { Card } from '@/components/ui';

export function LearnPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-primary">拓展学习</h2>
      <p className="text-sm text-secondary">
        开放案例不进入正式成绩，可以自由改参数、导出实验记录。
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          { title: 'IE-DES-01 检修排队', desc: '多工位 FCFS 离散事件仿真与配对置信区间' },
          { title: 'IE-MC-02 随机库存', desc: '周期检查补货、丢失销售与服务水平' },
          { title: 'IE-DES-03 双工序产线', desc: '有限缓冲与加工后阻塞' },
          { title: 'SCIP 官方示例', desc: '背包、EOQ、设施选址、流水车间' },
        ].map((item) => (
          <Card key={item.title} className="p-5">
            <p className="text-sm font-medium text-primary">{item.title}</p>
            <p className="mt-1 text-xs text-tertiary">{item.desc}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
