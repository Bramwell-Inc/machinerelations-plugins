import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAccess, publicAccessSummary, publicAccessDetails } from './public-access.mjs';
const root = 'https://example.test';
function fixture(change = () => null) {
  return async (url, options) => {
    assert.deepEqual(Object.keys(options.headers), ['user-agent']);
    assert.equal(options.redirect, 'manual');
    const override = change(url, options); if (override) return override;
    const xml = url.endsWith('.xml'); const text = url.endsWith('.txt');
    return new Response(options.method === 'HEAD' ? null : xml ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/article</loc></url></urlset>' : text ? 'Public discovery document' : '<!doctype html><html><title>Public article</title></html>', { headers: { 'content-type': xml ? 'application/xml' : text ? 'text/plain' : 'text/html' } });
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
 assert.equal(r.status,'passed');assert.ok(calls.some(u=>u.endsWith('/visible.md')));assert.ok(!calls.some(u=>u.endsWith('/data.json')));assert.ok(calls.some(u=>u.endsWith('/reddit.com')));
});
