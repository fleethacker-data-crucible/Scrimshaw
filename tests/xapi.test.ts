import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../src/model/factory.ts';
import { activityId, connectXapi, parseLaunch, tincanXml, type XapiTransport } from '../src/export/xapi.ts';

const actor = JSON.stringify({ name: ['Ada'], mbox: ['mailto:ada@example.com'] });

test('parseLaunch reads Tin Can parameters and rejects bad endpoints', () => {
  const l = parseLaunch(`?endpoint=${encodeURIComponent('https://lrs.example.com/xapi')}&auth=Basic%20abc&actor=${encodeURIComponent(actor)}&registration=r1&activity_id=urn:x`, 'urn:fallback')!;
  assert.equal(l.endpoint, 'https://lrs.example.com/xapi/');
  assert.equal(l.auth, 'Basic abc');
  assert.deepEqual(l.actor, { name: 'Ada', mbox: 'mailto:ada@example.com', objectType: 'Agent' });
  assert.equal(l.activityId, 'urn:x');
  assert.equal(parseLaunch('?nothing=1', 'x'), null);
  assert.equal(parseLaunch(`?endpoint=javascript:alert(1)&actor=${encodeURIComponent(actor)}`, 'x'), null);
  assert.equal(parseLaunch(`?endpoint=https://a.b/&actor=not-json`, 'x'), null);
});

test('connectXapi resumes from the State API and sends statements', async () => {
  const course = newCourse('Tin Can & co');
  const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] = [];
  const transport: XapiTransport = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers });
    const isState = url.includes('activities/state');
    return { ok: isState && init.method === 'GET', status: 200, text: async () => '{"v":1}' };
  };
  const search = `?endpoint=${encodeURIComponent('https://lrs.example.com/xapi/')}&auth=Basic%20k&actor=${encodeURIComponent(actor)}&registration=reg-9`;
  let t = 1_000;
  const lms = (await connectXapi(course, search, transport, () => t))!;
  assert.equal(lms.suspendData, '{"v":1}');
  const statements = () => calls.filter((c) => c.url.endsWith('/statements')).map((c) => JSON.parse(c.body!));
  assert.equal(statements()[0].verb.id, 'http://adlnet.gov/expapi/verbs/initialized');
  assert.equal(statements()[0].object.id, activityId(course));
  assert.equal(statements()[0].context.registration, 'reg-9');
  assert.equal(calls[0].headers['X-Experience-API-Version'], '1.0.3');
  assert.equal(calls[0].headers.Authorization, 'Basic k');
  lms.setProgress('s1', '{"v":1,"s":"s1"}');
  lms.setProgress('s1', '{"v":1,"s":"s1"}');
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 1, 'unchanged progress is not re-sent');
  lms.answered({ id: 'q1', title: 'Q1', correct: true, response: 'A', points: 10, max: 10 });
  t = 61_000;
  lms.complete('failed', 40);
  lms.finish();
  lms.finish();
  await new Promise((r) => setTimeout(r, 0));
  const verbs = statements().map((s) => s.verb.id.split('/').pop());
  assert.deepEqual(verbs, ['initialized', 'answered', 'failed', 'terminated']);
  const failed = statements()[2];
  assert.deepEqual(failed.result.score, { scaled: 0.4, raw: 40, min: 0, max: 100 });
  assert.equal(failed.result.success, false);
  assert.equal(failed.result.duration, 'PT0H1M0S');
  assert.ok(tincanXml(course).includes('<name>Tin Can &amp; co</name>'));
  assert.equal(await connectXapi(course, '', transport), null);
});

test('cmi5: fetch token, launch data, moveOn statements, browse mode reports nothing', async () => {
  const { connectCmi5, cmi5Xml } = await import('../src/export/xapi.ts');
  const course = newCourse('Five');
  const run = async (launchMode: string) => {
    const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] = [];
    const transport: XapiTransport = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body, headers: init.headers });
      if (url.startsWith('https://lms.example.com/fetch')) return { ok: true, status: 200, text: async () => '{"auth-token":"TOKEN"}' };
      if (url.includes('stateId=LMS.LaunchData')) return { ok: true, status: 200, text: async () => JSON.stringify({ launchMode, masteryScore: 0.8, contextTemplate: { extensions: { 'https://w3id.org/xapi/cmi5/context/extensions/sessionid': 'S1' } } }) };
      return { ok: false, status: 404, text: async () => '' };
    };
    const search = `?endpoint=${encodeURIComponent('https://lrs.example.com/xapi/')}&fetch=${encodeURIComponent('https://lms.example.com/fetch/1')}&actor=${encodeURIComponent(actor)}&registration=R&activityId=${encodeURIComponent('urn:au:1')}`;
    const lms = (await connectCmi5(course, search, transport))!;
    lms.complete('passed', 85);
    lms.finish();
    await new Promise((r) => setTimeout(r, 0));
    return calls;
  };
  const calls = await run('Normal');
  const st = calls.filter((c) => c.url.endsWith('/statements'));
  assert.equal(st[0].headers.Authorization, 'Basic TOKEN');
  const bodies = st.map((c) => JSON.parse(c.body!));
  assert.deepEqual(bodies.map((b) => b.verb.id.split('/').pop()), ['initialized', 'completed', 'passed', 'terminated']);
  const passed = bodies[2];
  assert.equal(passed.object.id, 'urn:au:1');
  assert.equal(passed.context.registration, 'R');
  assert.equal(passed.context.extensions['https://w3id.org/xapi/cmi5/context/extensions/sessionid'], 'S1');
  assert.equal(passed.context.extensions['https://w3id.org/xapi/cmi5/context/extensions/masteryscore'], 0.8);
  assert.ok(passed.context.contextActivities.category.some((c: { id: string }) => c.id.endsWith('/moveon')));
  const browse = (await run('Browse')).filter((c) => c.url.endsWith('/statements')).map((c) => JSON.parse(c.body!).verb.id.split('/').pop());
  assert.deepEqual(browse, ['initialized', 'terminated']);
  assert.ok(cmi5Xml(course).includes('moveOn="Completed"') && !cmi5Xml(course).includes('masteryScore'), 'no graded questions: completion only');
  const { newQuestionSlide } = await import('../src/model/factory.ts');
  course.scenes[0].slides.push(newQuestionSlide('multiple-choice'));
  const xml = cmi5Xml(course);
  assert.ok(xml.includes('moveOn="CompletedAndPassed"') && xml.includes('masteryScore="0.80"'));
  assert.equal(await connectCmi5(course, '?endpoint=x', async () => ({ ok: false, status: 0, text: async () => '' })), null);
});

test('cmi5: one completed and one passed per registration, failed retries, answered statements', async () => {
  const { connectCmi5 } = await import('../src/export/xapi.ts');
  const course = newCourse('Five');
  const docs = new Map<string, string>();
  const statements: { verb: string; object: string; category: string[] }[] = [];
  const transport: XapiTransport = async (url, init) => {
    if (url.startsWith('https://lms.example.com/fetch')) return { ok: true, status: 200, text: async () => '{"auth-token":"T"}' };
    const stateId = url.includes('activities/state') ? new URL(url).searchParams.get('stateId')! : '';
    if (stateId === 'LMS.LaunchData') return { ok: true, status: 200, text: async () => JSON.stringify({ launchMode: 'Normal', masteryScore: 0.8, contextTemplate: { contextActivities: { grouping: [{ id: 'urn:course' }] } } }) };
    if (stateId && init.method === 'PUT') { docs.set(stateId, init.body!); return { ok: true, status: 204, text: async () => '' }; }
    if (stateId) return docs.has(stateId) ? { ok: true, status: 200, text: async () => docs.get(stateId)! } : { ok: false, status: 404, text: async () => '' };
    const b = JSON.parse(init.body!);
    statements.push({ verb: b.verb.id.split('/').pop(), object: b.object.id, category: (b.context.contextActivities?.category ?? []).map((c: { id: string }) => c.id.split('/').pop()) });
    assert.deepEqual(b.context.contextActivities.grouping, [{ id: 'urn:course' }], 'context template on every statement');
    return { ok: true, status: 200, text: async () => '' };
  };
  const search = `?endpoint=${encodeURIComponent('https://lrs.example.com/xapi/')}&fetch=${encodeURIComponent('https://lms.example.com/fetch/1')}&actor=${encodeURIComponent(actor)}&registration=R&activityId=${encodeURIComponent('urn:au:1')}`;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let lms = (await connectCmi5(course, search, transport))!;
  lms.answered({ id: 'q1', title: 'Q1', correct: false, response: 'b', points: 0, max: 10 });
  lms.complete('failed', 50);
  lms.complete('failed', 50);
  lms.complete('failed', 60);
  lms.complete('passed', 90);
  lms.complete('passed', 100);
  await tick();
  assert.deepEqual(statements.map((x) => x.verb), ['initialized', 'answered', 'completed', 'failed', 'failed', 'passed']);
  const answered = statements[1];
  assert.equal(answered.object, 'urn:au:1/question/q1');
  assert.ok(!answered.category.includes('cmi5'), 'answered is a cmi5 allowed statement');
  // A new session on the same registration sends neither completed nor passed again.
  statements.length = 0;
  lms = (await connectCmi5(course, search, transport))!;
  lms.complete('passed', 95);
  lms.complete('failed', 10);
  await tick();
  assert.deepEqual(statements.map((x) => x.verb), ['initialized']);
});
