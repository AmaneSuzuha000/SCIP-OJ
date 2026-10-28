// Ignore responses from an older course, request or signed-in account.
export function requestScope(context, key, courseId = context.currentCourseId) {
    const sequence = (context[key] || 0) + 1;
    context[key] = sequence;
    const userId = window.ScipOJPlatform.getUser()?.id;
    return () => context.active !== false && context[key] === sequence &&
        context.currentCourseId === courseId && window.ScipOJPlatform.getUser()?.id === userId;
}
