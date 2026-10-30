import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const secretKeys=['ACCESS_TOKEN_SECRET','REFRESH_TOKEN_SECRET','TEMP_PASSWORD_SECRET'];

function runIsolated(code,contents='') {
  const directory=mkdtempSync(join(tmpdir(),'eu-connect-startup-'));
  try {
    writeFileSync(join(directory,'.env'),contents);
    const env={...process.env};
    // Never inherit real signing secrets or dotenv overrides into this fixture.
    for(const key of Object.keys(env))if(secretKeys.includes(key)||key.toUpperCase().startsWith('DOTENV_CONFIG_'))delete env[key];
    env.DOTENV_CONFIG_QUIET='true';
    return spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:directory,env,encoding:'utf8',timeout:10000,windowsHide:true});
  } finally { rmSync(directory,{recursive:true,force:true}); }
}

test('entry-point environment loads before the analytics authentication dependency',()=>{
  const source=readFileSync(new URL('server.js',root),'utf8');
  // Exercise the real entry-point import prefix through analytics, without
  // executing listeners, scheduled jobs, database queries or the server body.
  const prefix=source.slice(0,source.indexOf('import dns from'));
  assert(prefix.includes('analyticsRoutes.js'));
  const imports=prefix.replace(/(["'])([^"']+)\1/g,(_match,_quote,id)=>JSON.stringify(
    id.startsWith('.')?new URL(id,root).href:pathToFileURL(require.resolve(id)).href
  ));
  const result=runIsolated(`${imports}
    const {signAccessToken,verifyAccessToken}=await import(${JSON.stringify(new URL('config/jwt.js',root).href)});
    if(verifyAccessToken(signAccessToken({id:'fixture',role:'admin'})).sub!=='fixture')throw Error('Token verification failed');
    const {db}=await import(${JSON.stringify(new URL('config/db.js',root).href)});
    await db.end();
    process.exit(0);`,secretKeys.map(key=>`${key}=isolated-${key.toLowerCase()}`).join('\n'));
  assert.equal(result.status,0,result.stderr||result.error?.message);
});

test('JWT configuration still fails closed when signing secrets really are missing',()=>{
  const result=runIsolated(`await import(${JSON.stringify(new URL('config/jwt.js',root).href)});`);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be set/);
});
