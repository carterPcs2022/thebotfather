const { query } = require('../database/database');

const processing = new Set();

async function runScheduledMessages(client) {
  let result;
  try {
    result = await query('SELECT id, guild_id, channel_id, content, repeat_minutes FROM scheduled_messages WHERE active = TRUE AND next_run_at <= NOW() ORDER BY next_run_at ASC LIMIT 25');
  } catch (error) {
    console.error('[Scheduler] Could not load schedules:', error.message);
    return;
  }

  for (const row of result.rows) {
    const key = String(row.id);
    if (processing.has(key)) continue;
    processing.add(key);
    try {
      const channel = await client.channels.fetch(row.channel_id).catch(() => null);
      if (!channel?.isTextBased()) {
        await query('UPDATE scheduled_messages SET active = FALSE WHERE id = $1', [row.id]);
        continue;
      }
      const sent = await channel.send({ content: row.content, allowedMentions: { parse: [] } }).then(() => true).catch(error => {
        console.error('[Scheduler] Send failed for #' + row.id + ':', error.message);
        return false;
      });
      if (row.repeat_minutes > 0) {
        await query(
          'UPDATE scheduled_messages SET next_run_at = NOW() + ($2 * INTERVAL \'1 minute\') WHERE id = $1',
          [row.id, row.repeat_minutes],
        );
      } else if (sent) {
        await query('UPDATE scheduled_messages SET active = FALSE WHERE id = $1', [row.id]);
      } else {
        await query('UPDATE scheduled_messages SET next_run_at = NOW() + INTERVAL \'1 minute\' WHERE id = $1', [row.id]);
      }
    } catch (error) {
      console.error('[Scheduler] Job #' + row.id + ' failed:', error.message);
    } finally {
      processing.delete(key);
    }
  }
}

function startScheduler(client) {
  const tick = () => runScheduledMessages(client).catch(error => console.error('[Scheduler] Tick failed:', error.message));
  tick();
  return setInterval(tick, 15000).unref();
}

module.exports = { runScheduledMessages, startScheduler };
