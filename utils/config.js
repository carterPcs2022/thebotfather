const DEFAULT_SETTINGS = Object.freeze({
  log_channel_id: null,
  welcome_channel_id: null,
  goodbye_channel_id: null,
  autorole_id: null,
  welcome_enabled: false,
  goodbye_enabled: false,
  welcome_dm_enabled: false,
  verification_enabled: false,
  verification_role_id: null,
  automod_enabled: false,
  automod_spam_enabled: true,
  automod_duplicate_enabled: true,
  automod_mention_enabled: true,
  automod_link_enabled: false,
  automod_caps_enabled: false,
  automod_emoji_enabled: false,
  automod_bad_words_enabled: false,
  automod_max_mentions: 5,
  automod_max_caps_percent: 80,
  automod_max_emojis: 12,
  automod_spam_window_seconds: 8,
  automod_spam_message_limit: 6,
  automod_action: 'warn',
  level_enabled: false,
  suggestion_channel_id: null,
  ticket_category_id: null,
});

function normalizeSettings(row) {
  return { ...DEFAULT_SETTINGS, ...(row || {}) };
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings };
