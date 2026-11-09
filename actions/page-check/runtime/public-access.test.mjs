import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAccess, publicAccessSummary } from './public-access.mjs';
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
  assert.equal(r.status,'failed');assert.equal(r.findings.length,8);assert.ok(r.findings.every(x=>x.client==='standardUa'));
});
test('HTML challenge with HTTP 200 is not success',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('llms.txt')?new Response(o.method==='HEAD'?null:'<html><title>Just a moment</title></html>',{headers:{'content-type':'text/plain'}}):null)});
 assert.equal(r.status,'failed');assert.ok(r.findings.some(x=>/challenge/.test(x.detail)));
});
test('HEAD-only failure is surfaced',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>o.method==='HEAD'?new Response(null,{status:405}):null)});
 assert.equal(r.findings.length,8);
});
test('child-map failure cannot silently shrink coverage',async()=>{
 const r=await publicAccess(root,[],{fetcher:fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(o.method==='HEAD'?null:'<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>',{headers:{'content-type':'application/xml'}}):u.endsWith('/child.xml')?new Response('missing',{status:404}):null)});
 assert.equal(r.sitemapDocuments,2);assert.equal(r.status,'failed');assert.equal(r.findings.length,4);
});
test('bounded traversal is explicitly incomplete',async()=>{
 const r=await publicAccess(root,[],{maxMaps:1,fetcher:fixture((u,o)=>u.endsWith('/sitemap.xml')?new Response(o.method==='HEAD'?null:'<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>',{headers:{'content-type':'application/xml'}}):null)});
 assert.ok(r.findings.some(x=>/bound exhausted/.test(x.detail)));
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
