"""Extract the common Codex client calls from retained, hash-verified OpenAI source."""
from pathlib import Path
import json,re,hashlib
D=Path(__file__).parent
p=json.loads((D/'provenance.json').read_text())
for f in p['files']:
 assert hashlib.sha256((D/f['file']).read_bytes()).hexdigest()==f['sha256'], f['file']
def read(f): return (D/'vendor'/f).read_text()
calls=[]
def call(client,method,url,file,needle,fields=None,encoding='json',query=None):
 text=read(file); assert needle in text, (file,needle)
 row={'client':client,'line':text[:text.index(needle)].count('\n')+1,'method':method,'url':url,'source':'vendor/'+file}
 if fields: row['body']={'encoding':encoding,'fields':fields}
 if query: row['query']=query
 calls.append(row)
call('auth.usercode','POST','/api/accounts/deviceauth/usercode','login/src/device_code_auth.rs','/deviceauth/usercode',{'client_id':'string'})
call('auth.poll','POST','/api/accounts/deviceauth/token','login/src/device_code_auth.rs','/deviceauth/token',{'device_auth_id':'string','user_code':'string'})
call('auth.token','POST','/oauth/token','login/src/server.rs','grant_type=authorization_code',dict.fromkeys(['grant_type','code','redirect_uri','client_id','code_verifier','requested_token','subject_token','subject_token_type'],'string'),'form')
call('auth.token','POST','/oauth/token','login/src/auth/manager.rs','grant_type: "refresh_token"',dict.fromkeys(['grant_type','refresh_token','client_id'],'string'))
call('auth.revoke','POST','/oauth/revoke','login/src/auth/manager.rs','https://auth.openai.com/oauth/revoke',dict.fromkeys(['token','token_type_hint','client_id'],'string'))
call('codex.responses','POST','/backend-api/codex/responses','codex-api/src/endpoint/responses.rs','=> "/responses"',{'model':'string','instructions':'string','input':'array','tools':'array','tool_choice':'string','stream':'boolean','store':'boolean'})
call('codex.compact','POST','/backend-api/codex/responses/compact','codex-api/src/endpoint/compact.rs','"responses/compact"',{'model':'string','instructions':'string','input':'array'})
call('codex.models','GET','/backend-api/codex/models','codex-api/src/endpoint/models.rs','"models"',query={'client_version':'string'})
for op,path,fn in [('usage','usage','client/rate_limit_resets.rs'),('profile','profiles/me','client.rs'),('messages','workspace-messages','client.rs'),('credits','rate-limit-reset-credits','client/rate_limit_resets.rs'),('consume','rate-limit-reset-credits/consume','client/rate_limit_resets.rs')]:
 call('wham.'+op,'POST' if op=='consume' else 'GET','/backend-api/wham/'+path,'backend-client/src/'+fn,'/wham/'+path,dict.fromkeys(['redeem_request_id','credit_id'],'string') if op=='consume' else None)
# Other backend calls are specified but gap-only. A path's paired method is read from its request builder.
text=read('backend-client/src/client.rs')
for m in re.finditer(r'"\{\}/wham/([^"\n]+)"',text):
 path='/backend-api/wham/'+m.group(1)
 for param in ['task_id','turn_id']:path=path.replace('{}','{'+param+'}',1)
 if any(c['url']==path for c in calls):continue
 line=text[:m.start()].count('\n')+1
 # URL functions are read-only unless their callers explicitly post/create/cancel.
 method='POST' if path == '/backend-api/wham/tasks' or 'send_add_credits' in path else 'GET'
 name=re.sub(r'[^a-zA-Z0-9]+','_',m.group(1)).strip('_')
 if path == '/backend-api/wham/tasks': name='create_task'
 calls.append({'client':'wham.'+name,'method':method,'url':path,'line':line,'source':'vendor/backend-client/src/client.rs'})
(D/'client-ops.json').write_text(json.dumps({'format':'client','version':'openai/codex rust-v0.151.0 '+p['commit'],'calls':calls},indent=2)+'\n')
(D/'client-ops.json.sha256').write_text(hashlib.sha256((D/'client-ops.json').read_bytes()).hexdigest()+'\n')
