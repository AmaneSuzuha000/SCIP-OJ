import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <EmptyState title="页面不存在" hint="检查地址是否正确，或返回首页" />
      <Link to="/" className="text-sm text-brand">
        返回课程教学
      </Link>
    </div>
  );
}
