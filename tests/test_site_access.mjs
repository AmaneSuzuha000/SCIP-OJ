import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await readFile('supabase/functions/_shared/auth.ts','utf8');
const {code}=await transform(source,{loader:'ts',format:'esm'});
const {getAuthenticatedUser}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const request=new Request('https://fixture.invalid',{headers:{Authorization:'Bearer fixture-token'}});
for(const [label,user,allowed,error,expected] of [
 ['owner',{id:'owner'},true,null,true],
 ['pengguo318',{id:'peng'},true,null,true],
 ['forged display name',{id:'stranger',user_metadata:{user_name:'AmaneSuzuha000',provider_id:'177200341'}},false,null,false],
 ['permission service unavailable',{id:'owner'},null,{message:'offline'},false],
 ['no verified user',null,true,null,false],
]){
 const calls=[];
 const supabase={auth:{getUser:async token=>({data:{user},error:null})},rpc:async(name,args)=>{calls.push({name,args});return {data:allowed,error};}};
 const result=await getAuthenticatedUser(request,supabase);
 assert.equal(Boolean(result),expected,label);
 if(user)assert.deepEqual(calls,[{name:'check_site_user_access',args:{p_user_id:user.id}}]);
 else assert.deepEqual(calls,[]);
}
assert.equal(await getAuthenticatedUser(new Request('https://fixture.invalid'),{}),null);
console.log('Verified Edge identity, two-account admission, metadata forgery and permission outage fail closed: PASS');
