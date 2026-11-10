import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAccess, publicAccessSummary, publicAccessDetails } from './public-access.mjs';
const root = 'https://example.test';
function fixture(change = () => null) {
  return async (url, options) => {
    assert.deepEqual(Object.keys(options.headers), url.endsWith('.json') && options.method === 'GET' ? ['user-agent', 'range'] : ['user-agent']);
    assert.equal(options.redirect, 'manual');
    const override = change(url, options); if (override) return override;
    const xml = url.endsWith('.xml'); const text = url.endsWith('.txt'); const json = url.endsWith('.json');
    return new Response(options.method === 'HEAD' ? null : xml ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/article</loc></url></urlset>' : text ? 'Public discovery document' : json ? '{"public":true}' : '<!doctype html><html><title>Public article</title></html>', { headers: { 'content-type': xml ? 'application/xml' : text ? 'text/plain' : json ? 'application/json' : 'text/html' } });
  };
}
test('checks both clients and methods; leaves production acceptance separate', async () => {
  const r = await publicAccess(root, [{path:'/article'}], {fetcher:fixture()});
  assert.equal(r.status,'passed'); assert.equal(r.checks.length,20); assert.match(publicAccessSummary(r),/separate from whether this PR/);
});
test('exposes UA-only denial', async () => {
  const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>o.headers['user-agent'].startsWith('Python')?new Response('blocked',{status:403}):null)});
  assert.equal(r.status,'failed');assert.equal(r.findings.length,10);assert.ok(r.findings.every(x=>x.client==='standardUa'));
});
test('HTML challenge with HTTP 200 is not success',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('llms.txt')?new Response(o.method==='HEAD'?null:'<html><title>Just a moment</title></html>',{headers:{'content-type':'text/plain'}}):null)});
 assert.equal(r.status,'failed');assert.ok(r.findings.some(x=>/challenge/.test(x.detail)));
});
test('HEAD-only failure is surfaced',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>o.method==='HEAD'?new Response(null,{status:405}):null)});
 assert.equal(r.findings.length,10);
});
test('child-map failure cannot silently shrink coverage',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(o.method==='HEAD'?null:'<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>',{headers:{'content-type':'application/xml'}}):u.endsWith('/child.xml')?new Response('missing',{status:404}):null)});
 assert.equal(r.sitemapDocuments,2);assert.equal(r.status,'failed');assert.equal(r.findings.length,4);
});
test('bounded traversal is explicitly incomplete',async()=>{
 const r=await publicAccess(root,[],{maxMaps:1,fetcher:fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(o.method==='HEAD'?null:'<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>',{headers:{'content-type':'application/xml'}}):null)});
 assert.ok(r.findings.some(x=>/bound exhausted/.test(x.detail)));assert.equal(r.status,'incomplete');
});
test('does not send credentials or follow foreign sitemap redirects',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(null,{status:302,headers:{location:'https://other.test/map.xml'}}):null)});
 assert.ok(r.findings.some(x=>/left production origin/.test(x.detail)));
});
test('missing production is not passed',async()=>{const r=await publicAccess('',[],{fetcher:()=>{throw Error('must not run')}});assert.equal(r.status,'not-tested')});
test('failed production acceptance stays visible without blocking an unrelated PR',async()=>{
 const { planComment } = await import('../outcome.mjs');
 const productionAccess = await publicAccess(root,[],{fetcher:fixture((u,o)=>o.headers['user-agent'].startsWith('Python')?new Response('blocked',{status:403}):null)});
 const r=planComment({checkerExit:0,report:{blocking:[],productionAccess},summary:'**Page check: clean.** No introduced defects.\n\n'+publicAccessSummary(productionAccess)});
 assert.equal(r.fail,false);assert.equal(r.verdict,'clean');assert.match(r.body,/Production machine access: failed/);
});
test('an empty sitemap index is not complete coverage',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(o.method==='HEAD'?null:'<sitemapindex></sitemapindex>',{headers:{'content-type':'application/xml'}}):null)});
 assert.equal(r.status,'failed');assert.ok(r.findings.some(x=>/no child locations/.test(x.detail)));
});
test('new preview pages are omitted; production supplies its own representative',async()=>{
 const calls=[];const reader=fixture();
 const r=await publicAccess(root,[{path:'/new-preview-page'}],{fetcher:async(u,o)=>{calls.push(u);return reader(u,o)}});
 assert.equal(r.status,'passed');assert.deepEqual(r.omittedPreviewPaths,['/new-preview-page']);assert.equal(r.sampledPages,2);
 assert.ok(calls.includes(root+'/article'));assert.ok(!calls.includes(root+'/new-preview-page'));
});
test('redirect without Location is rejected rather than requesting /null',async()=>{
 const calls=[];const reader=fixture(u=>u.endsWith('/sitemap.xml')?new Response(null,{status:302}):null);
 const r=await publicAccess(root,[],{fetcher:async(u,o)=>{calls.push(u);return reader(u,o)}});
 assert.equal(r.status,'failed');assert.ok(r.findings.some(f=>/no Location/.test(f.detail)));assert.ok(!calls.some(u=>u.endsWith('/null')));
});
test('unsupported compressed sitemap is incomplete, not a claimed content failure',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(o.method==='HEAD'?null:'gzip',{headers:{'content-type':'application/gzip'}}):null)});
 assert.equal(r.status,'incomplete');
});
test('findings group duplicate methods and explicitly count omitted groups',()=>{
 const findings=Array.from({length:14},(_,i)=>({url:root+'/'+i,detail:'HTTP 403',client:'standardUa',method:'GET'}));
 findings.push({...findings[0],method:'HEAD'});
 const lines=publicAccessDetails({findings});assert.equal(lines.length,13);assert.match(lines[0],/standardUa\/GET, standardUa\/HEAD/);assert.match(lines.at(-1),/2 more grouped/);
});
test('per-request timeout is failed access, distinct from the whole-check time bound',async()=>{
 const reader=fixture();
 const r=await publicAccess(root,[],{fetcher:async(u,o)=>{if(o.headers['user-agent'].startsWith('Python'))throw new DOMException('request timed out','TimeoutError');return reader(u,o)}});
 assert.equal(r.status,'failed');assert.equal(r.findings.length,10);assert.ok(r.findings.every(x=>!x.incomplete));
});
test('sitemap data documents are not falsely treated as HTML pages',async()=>{
 const calls=[];const reader=fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(o.method==='HEAD'?null:'<urlset><url><loc>https://example.test/measurement/data.json</loc></url><url><loc>https://example.test/index/domains/reddit.com</loc></url><url><loc>https://example.test/index/domains/visible.md</loc></url></urlset>',{headers:{'content-type':'application/xml'}}):null);
 const r=await publicAccess(root,[{path:'/index/domains/visible.md'}],{fetcher:async(u,o)=>{calls.push(u);return reader(u,o)}});
 assert.equal(r.status,'passed');assert.ok(calls.some(u=>u.endsWith('/visible.md')));assert.ok(calls.some(u=>u.endsWith('/data.json')));assert.equal(r.sampledDataDocuments,1);assert.ok(calls.some(u=>u.endsWith('/reddit.com')));
});


test('advertised JSON is probed for both clients and methods, including UA-only denials', async () => {
  const r = await publicAccess(root, [], { fetcher: fixture((u,o) => {
    if (u.endsWith('/llms.txt')) return new Response(o.method === 'HEAD' ? null : '[Release](https://example.test/data/release.json)', {headers:{'content-type':'text/plain'}});
    if (u.endsWith('/data/release.json') && o.headers['user-agent'].startsWith('Python')) return new Response(null, {status:403});
  }) });
  assert.equal(r.sampledDataDocuments, 1); assert.equal(r.status, 'failed');
  assert.equal(r.checks.filter(c=>c.kind==='json').length,4);
  assert.equal(r.findings.length,2); assert.ok(r.findings.every(f=>f.kind==='json'&&f.client==='standardUa'));
});
test('HTML links discover only same-origin JSON without credentials or query parameters', async () => {
  const calls=[]; const reader=fixture((u,o)=>u===root+'/'?new Response(o.method==='HEAD'?null:'<html><a href="/data/release.json">Release</a><a href="https://outside.test/private.json">Other</a><a href="https://user:pass@example.test/private.json">Credentials</a><a href="/private.json?token=x">Query</a></html>',{headers:{'content-type':'text/html'}}):null);
  const r=await publicAccess(root,[],{fetcher:async(u,o)=>{calls.push(u);return reader(u,o)}});
  assert.equal(r.status,'passed');assert.equal(r.sampledDataDocuments,1);
  assert.ok(!calls.some(u=>u.includes('private.json')));
});
test('JSON access accepts bounded partial reads but rejects HTML disguised as JSON', async () => {
  for (const body of ['{"partial":', '<html>Login</html>', 'not JSON']) {
    const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/llms.txt')?new Response(o.method==='HEAD'?null:'[Data](/data.json)',{headers:{'content-type':'text/plain'}}):u.endsWith('/data.json')?new Response(o.method==='HEAD'?null:body,{status:o.method==='GET'?206:200,headers:{'content-type':'application/json'}}):null)});
    assert.equal(r.status,body.startsWith('{')?'passed':'failed');
  }
});
test('advertised JSON coverage is bounded and exhaustion is not a pass', async () => {
  const r=await publicAccess(root,[],{maxDataDocuments:1,fetcher:fixture((u,o)=>u.endsWith('/llms.txt')?new Response(o.method==='HEAD'?null:'[One](/one.json) [Two](/two.json)',{headers:{'content-type':'text/plain'}}):null)});
  assert.equal(r.sampledDataDocuments,1);assert.equal(r.status,'incomplete');
  assert.ok(r.findings.some(f=>/JSON access bound exhausted/.test(f.detail)));
});


test('JSON redirects cannot turn credential-free checks into authenticated reads', async () => {
 for (const location of ['/private.json?token=secret','https://user:pass@example.test/private.json','https://other.test/private.json']) {
  const calls=[]; const reader=fixture((u,o)=>u.endsWith('/llms.txt')?new Response(o.method==='HEAD'?null:'[Data](/data.json)',{headers:{'content-type':'text/plain'}}):u.endsWith('/data.json')?new Response(null,{status:302,headers:{location}}):null);
  const r=await publicAccess(root,[],{fetcher:async(u,o)=>{calls.push(u);return reader(u,o)}});
  assert.equal(r.status,'failed'); assert.equal(r.findings.length,4);
  assert.ok(!calls.some(u=>u.includes('private.json')));
 }
});
test('relative JSON links resolve against the served page, not the origin root', async () => {
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/article')?new Response(null,{status:302,headers:{location:'/research/article/'}}):u.endsWith('/research/article/')?new Response(o.method==='HEAD'?null:'<html><a href="data.json">Data</a></html>',{headers:{'content-type':'text/html'}}):null)});
 assert.equal(r.status,'passed'); assert.equal(r.sampledDataDocuments,1);
 assert.ok(r.checks.filter(c=>c.kind==='json').every(c=>c.url===root+'/research/article/data.json'));
});
test('JSON content may legitimately quote HTML and challenge names', async () => {
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/llms.txt')?new Response(o.method==='HEAD'?null:'[Data](/data.json)',{headers:{'content-type':'text/plain'}}):u.endsWith('/data.json')?new Response(o.method==='HEAD'?null:JSON.stringify({example:'<html>cf-chl- error code: 1010</html>'}),{headers:{'content-type':'application/json'}}):null)});
 assert.equal(r.status,'passed'); assert.equal(r.sampledDataDocuments,1);
});
