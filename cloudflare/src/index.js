import webpush from 'web-push';
import { cycleDate, dueBlock, localParts, unfinishedReminderTime } from './schedule.js';

const cors = (request, env) => {
  const origin = request.headers.get('Origin');
  if (origin !== env.ALLOWED_ORIGIN) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
};

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
});

function validEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname.endsWith('.push.services.mozilla.com') ||
      url.hostname.endsWith('.notify.windows.com') ||
      url.hostname.endsWith('.push.apple.com')
    );
  } catch (_) { return false; }
}

async function registered(env, endpoint) {
  return env.DB.prepare('SELECT endpoint FROM subscriptions WHERE endpoint = ?').bind(endpoint).first();
}

async function removeEndpoint(env, endpoint) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM calls WHERE endpoint = ?').bind(endpoint),
    env.DB.prepare('DELETE FROM daily_progress WHERE endpoint = ?').bind(endpoint),
    env.DB.prepare('DELETE FROM push_events WHERE endpoint = ?').bind(endpoint),
    env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(endpoint)
  ]);
}

async function sendPush(env, subscription, payload) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return webpush.sendNotification({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth }
  }, JSON.stringify({ ...payload, url: `./?tab=${payload.tab || 'today'}` }), { TTL: 3600 });
}

async function sendOnce(env, subscription, eventKey, payload, now) {
  const reservation = await env.DB.prepare(
    'INSERT OR IGNORE INTO push_events(endpoint,event_key,sent_at) VALUES(?,?,?)'
  ).bind(subscription.endpoint, eventKey, now).run();
  if (!reservation.meta?.changes) return false;
  try {
    await sendPush(env, subscription, payload);
    return true;
  } catch (error) {
    await env.DB.prepare('DELETE FROM push_events WHERE endpoint = ? AND event_key = ?')
      .bind(subscription.endpoint, eventKey).run();
    if ([404, 410].includes(Number(error.statusCode))) await removeEndpoint(env, subscription.endpoint);
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (!headers) return new Response('Origin is not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true }, 200, headers);
    if (request.method !== 'POST') return json({ error: 'Not found' }, 404, headers);

    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON' }, 400, headers); }
    const now = Date.now();

    if (url.pathname === '/subscribe') {
      const sub = body.subscription;
      if (!sub || !validEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth || typeof body.timeZone !== 'string' || body.timeZone.length > 64) {
        return json({ error: 'Invalid subscription or timezone' }, 400, headers);
      }
      try { new Intl.DateTimeFormat('en', { timeZone: body.timeZone }); }
      catch (_) { return json({ error: 'Invalid timezone' }, 400, headers); }
      await env.DB.prepare(`INSERT INTO subscriptions(endpoint,p256dh,auth,timezone,created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,
        timezone=excluded.timezone`).bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, body.timeZone, now).run();
      return json({ ok: true }, 200, headers);
    }

    if (!validEndpoint(body.endpoint)) return json({ error: 'Invalid endpoint' }, 400, headers);
    const sub = await registered(env, body.endpoint);
    if (!sub) return json({ error: 'Subscription not found' }, 404, headers);

    if (url.pathname === '/unsubscribe') {
      await removeEndpoint(env, body.endpoint);
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === '/progress') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || typeof body.pending !== 'boolean') {
        return json({ error: 'Invalid progress data' }, 400, headers);
      }
      await env.DB.prepare(`INSERT INTO daily_progress(endpoint,cycle_date,pending_core,updated_at)
        VALUES(?,?,?,?) ON CONFLICT(endpoint,cycle_date) DO UPDATE SET
        pending_core=excluded.pending_core,updated_at=excluded.updated_at`)
        .bind(body.endpoint, body.date, body.pending ? 1 : 0, now).run();
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === '/calls/save') {
      const call = body.call;
      if (!call || !/^[A-Za-z0-9_-]{8,80}$/.test(call.id || '') || !Number.isSafeInteger(call.startsAt) ||
          call.startsAt <= now + 30000 || call.startsAt > now + 48 * 60 * 60 * 1000) {
        return json({ error: 'Invalid call reminder' }, 400, headers);
      }
      // Описание встречи не передаётся. Сохраняются только случайный ID и время.
      await env.DB.prepare(`INSERT INTO calls(endpoint,id,starts_at,notified,created_at)
        VALUES(?,?,?,0,?) ON CONFLICT(endpoint,id) DO UPDATE SET starts_at=excluded.starts_at,notified=0`)
        .bind(body.endpoint, call.id, call.startsAt, now).run();
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === '/calls/delete') {
      if (typeof body.id !== 'string' || body.id.length > 80) return json({ error: 'Invalid call ID' }, 400, headers);
      await env.DB.prepare('DELETE FROM calls WHERE endpoint = ? AND id = ?').bind(body.endpoint, body.id).run();
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === '/test') {
      const row = await env.DB.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').bind(body.endpoint).first();
      try {
        await sendPush(env, row, { title: 'Панель персонажа', body: 'Push-уведомления работают.', tag: 'quest-panel-test', tab: 'today' });
      } catch (error) {
        if ([404, 410].includes(Number(error.statusCode))) await removeEndpoint(env, body.endpoint);
        return json({ error: 'Push delivery failed', detail: String(error.message || error) }, 502, headers);
      }
      return json({ ok: true }, 200, headers);
    }

    return json({ error: 'Not found' }, 404, headers);
  },

  async scheduled(_controller, env) {
    const nowDate = new Date();
    const now = nowDate.getTime();
    const { results = [] } = await env.DB.prepare('SELECT * FROM subscriptions').all();

    for (const subscription of results) {
      let parts;
      try { parts = localParts(nowDate, subscription.timezone); }
      catch (_) { continue; }
      const cycle = cycleDate(parts);
      const block = dueBlock(parts, cycle);
      if (block) {
        try { await sendOnce(env, subscription, block.key, { ...block, tag: `quest-${block.key}` }, now); }
        catch (error) { console.error('Block push failed', error); }
      }

      const reminderTime = unfinishedReminderTime(cycle);
      if (parts.hour === reminderTime.hour && parts.minute === reminderTime.minute) {
        const progress = await env.DB.prepare(`SELECT pending_core FROM daily_progress WHERE endpoint = ? AND cycle_date = ?`)
          .bind(subscription.endpoint, cycle).first();
        if (progress?.pending_core) {
          const key = `${cycle}:03:30:unfinished-core`;
          try {
            await sendOnce(env, subscription, key, {
              key, title: 'План на сегодня', body: 'У вас остались незавершённые основные квесты.',
              tag: `quest-unfinished-${cycle}`, tab: 'quests'
            }, now);
          } catch (error) { console.error('Unfinished quests push failed', error); }
        }
      }

      const { results: calls = [] } = await env.DB.prepare(
        'SELECT id,starts_at,notified FROM calls WHERE endpoint = ? AND starts_at > ? AND starts_at <= ? AND notified = 0'
      ).bind(subscription.endpoint, now, now + 10 * 60 * 1000).all();
      for (const call of calls) {
        const claimed = await env.DB.prepare('UPDATE calls SET notified = 1 WHERE endpoint = ? AND id = ? AND notified = 0')
          .bind(subscription.endpoint, call.id).run();
        if (!claimed.meta?.changes) continue;
        try {
          await sendPush(env, subscription, {
            title: 'Скоро созвон', body: 'Созвон через 10 минут.', tag: `quest-call-${call.id}`, tab: 'today'
          });
        } catch (error) {
          await env.DB.prepare('UPDATE calls SET notified = 0 WHERE endpoint = ? AND id = ?')
            .bind(subscription.endpoint, call.id).run();
          if ([404, 410].includes(Number(error.statusCode))) await removeEndpoint(env, subscription.endpoint);
          console.error('Call push failed', error);
        }
      }
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM calls WHERE starts_at <= ?').bind(now - 5 * 60 * 1000),
      env.DB.prepare('DELETE FROM push_events WHERE sent_at < ?').bind(now - 30 * 24 * 60 * 60 * 1000),
      env.DB.prepare('DELETE FROM daily_progress WHERE updated_at < ?').bind(now - 14 * 24 * 60 * 60 * 1000)
    ]);
  }
};
