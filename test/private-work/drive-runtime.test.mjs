import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'esbuild';

test('production OAuth callback, token refresh and Drive use native workerd fetch without redirecting credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cbh-drive-native-'));
  try {
    for(const [source,name] of [['drive','drive'],['service','service']])
      await build({entryPoints:['worker/modules/documents/'+source+'.ts'],bundle:true,platform:'browser',format:'esm',outfile:join(dir,name+'.mjs'),logLevel:'silent'});
    await writeFile(join(dir,'probe.mjs'), `
      import { DriveArchive, refreshDriveToken, seal } from './drive.mjs';
      import { handleDocuments } from './service.mjs';
      export default {async test(){
        const bare = fetch;
        if ((await bare('https://synthetic.invalid/bare')).status !== 200) throw Error('bare fetch failed');
        const api = new DriveArchive('synthetic-only');
        if ((await api.request('drive/v3/files')).status !== 200) throw Error('Drive native fetch failed');
        for (const [status,code] of [[401,'DRIVE_RECONNECT'],[403,'DRIVE_REQUEST_FAILED'],[302,'DRIVE_REQUEST_FAILED']]) {
          let caught;
          try { await api.request('drive/v3/files?syntheticStatus='+status); } catch(error) { caught=error; }
          if(caught?.code !== code) throw Error('Provider status mapping failed');
        }
        const env = {PRIVATE_DRIVE_TOKEN_KEY:btoa('s'.repeat(32)),PRIVATE_DRIVE_CLIENT_ID:'synthetic',PRIVATE_DRIVE_CLIENT_SECRET:'synthetic',PRIVATE_DRIVE_PICKER_KEY:'synthetic',PRIVATE_DRIVE_APP_ID:'000000'};
        const verifier = await seal('synthetic-verifier',env);
        let saved = false;
        env.DB = {prepare(sql){return {bind(){return this},async first(){
          if(sql.startsWith('DELETE FROM case_oauth_states')) return {verifier_encrypted:verifier};
          if(sql.startsWith('SELECT * FROM case_drive_connections')) return null;
          if(sql.startsWith('INSERT INTO case_drive_connections')) {saved=true;return {case_id:'synthetic-case'}};
          throw Error('Unexpected synthetic SQL');
        }}}};
        const principal = {id:'synthetic-member',sessionHash:'synthetic-session'};
        const repo = {async authorize(){},args(){return ['synthetic-case','synthetic-member',0,'synthetic-session']},acl(){return '1=1'},async audit(){}};
        const callback = code => handleDocuments(new Request('https://synthetic.invalid/api/private/case/documents/oauth/callback?state=synthetic-state&code='+code),env,principal,repo,true,['oauth','callback']);
        const result = await callback('synthetic-code');
        if(result.status!==303 || !result.headers.get('Location').endsWith('drive=connected') || !saved) throw Error('Native callback failed');
        for(const code of ['synthetic-token-redirect','synthetic-identity-redirect']) {
          saved=false;let caught;
          try { await callback(code); } catch(error) {caught=error}
          if(caught?.code!=='DRIVE_CONNECT_FAILED' || saved) throw Error('OAuth redirect was not rejected before storage');
        }
        const connection = {refresh_token_encrypted:await seal('synthetic-refresh',env)};
        if(await refreshDriveToken(connection,env)!=='synthetic-access') throw Error('Native token refresh failed');
        connection.refresh_token_encrypted=await seal('synthetic-refresh-redirect',env);
        let rejected;
        try {await refreshDriveToken(connection,env)} catch(error) {rejected=error}
        if(rejected?.code!=='DRIVE_RECONNECT') throw Error('Refresh redirect not rejected');
        console.log('PRIVATE_DRIVE_NATIVE_FETCH_PASS externalNetwork=0 provider=embedded-synthetic');
      }};
    `);
    await writeFile(join(dir,'provider.mjs'), `
      export default {async fetch(request){
        const u = new URL(request.url);
        if (u.href === 'https://synthetic.invalid/bare') return Response.json({synthetic:true});
        const redirect = () => new Response(null,{status:302,headers:{Location:'https://unexpected.invalid/no-token-forwarding'}});
        if(u.href==='https://oauth2.googleapis.com/token') {
          if(request.redirect!=='manual') throw Error('OAuth must not follow redirects');
          const b=new URLSearchParams(await request.text());
          if(b.get('code')==='synthetic-token-redirect' || b.get('refresh_token')==='synthetic-refresh-redirect') return redirect();
          return Response.json({access_token:b.get('code')==='synthetic-identity-redirect'?'synthetic-identity-redirect':'synthetic-access',refresh_token:'synthetic-refresh'});
        }
        if(u.href==='https://openidconnect.googleapis.com/v1/userinfo') {
          if(request.redirect!=='manual') throw Error('Identity must not follow redirects');
          if(request.headers.get('Authorization')==='Bearer synthetic-identity-redirect') return redirect();
          return Response.json({sub:'synthetic-subject'});
        }
        if (u.origin !== 'https://www.googleapis.com' || u.pathname !== '/drive/v3/files' || request.headers.get('Authorization') !== 'Bearer synthetic-only') throw Error('Unexpected synthetic request');
        if(request.redirect!=='manual') throw Error('Drive must not follow redirects');
        if(u.searchParams.get('syntheticStatus')==='302') return redirect();
        return Response.json({synthetic:true},{status:Number(u.searchParams.get('syntheticStatus') ?? 200)});
      }};
    `);
    // Native fetch routes to an embedded service; no socket or internet service
    // can be reached. This exercises the native receiver checks missed by mocks.
    await writeFile(join(dir,'probe.capnp'), `
      using Workerd = import "/workerd/workerd.capnp";
      const config :Workerd.Config = (services = [
        (name = "probe", worker = (modules = [(name = "probe.mjs", esModule = embed "probe.mjs"),(name = "drive.mjs", esModule = embed "drive.mjs"),(name = "service.mjs", esModule = embed "service.mjs")], compatibilityDate = "2026-10-06", globalOutbound = "synthetic")),
        (name = "synthetic", worker = (modules = [(name = "provider.mjs", esModule = embed "provider.mjs")], compatibilityDate = "2026-10-06", globalOutbound = "synthetic"))
      ]);
    `);
    const {stdout,stderr} = await promisify(execFile)(resolve('node_modules/.bin/workerd'),['test',join(dir,'probe.capnp')],{timeout:20000});
    assert.match(stdout+stderr,/PRIVATE_DRIVE_NATIVE_FETCH_PASS/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
