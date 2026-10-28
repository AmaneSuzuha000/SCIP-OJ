export async function withDeadline(task, milliseconds, message = '请求超时') {
    let timer;
    try {
        return await Promise.race([task,new Promise((_,reject)=>{
            timer=setTimeout(()=>{const error=Error(message);error.code='TIMEOUT';reject(error);},milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}
