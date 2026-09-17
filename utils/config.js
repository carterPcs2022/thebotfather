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
  ticket_staff_role_id: null,
});

function normalizeSettings(row) {
  return { ...DEFAULT_SETTINGS, ...(row || {}) };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSettings(settings) {
  if (!isPlainObject(settings)) throw new TypeError('Settings must be an object.');
  if (!['warn', 'timeout', 'delete'].includes(settings.automod_action)) {
    throw new Error('automod_action must be warn, timeout, or delete.');
  }
  if (!Number.isInteger(settings.automod_max_mentions) || settings.automod_max_mentions < 1 || settings.automod_max_mentions > 20) {
    throw new Error('automod_max_mentions must be between 1 and 20.');
  }
  if (!Number.isInteger(settings.automod_max_caps_percent) || settings.automod_max_caps_percent < 50 || settings.automod_max_caps_percent > 100) {
    throw new Error('automod_max_caps_percent must be between 50 and 100.');
  }
  if (!Number.isInteger(settings.automod_max_emojis) || settings.automod_max_emojis < 1 || settings.automod_max_emojis > 50) {
    throw new Error('automod_max_emojis must be between 1 and 50.');
  }
  if (!Number.isInteger(settings.automod_spam_window_seconds) || settings.automod_spam_window_seconds < 2 || settings.automod_spam_window_seconds > 60) {
    throw new Error('automod_spam_window_seconds must be between 2 and 60.');
  }
  if (!Number.isInteger(settings.automod_spam_message_limit) || settings.automod_spam_message_limit < 3 || settings.automod_spam_message_limit > 30) {
    throw new Error('automod_spam_message_limit must be between 3 and 30.');
  }
  return true;
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings, validateSettings };
