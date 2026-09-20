const { handleMessage } = require('../services/automod');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    await handleMessage(message);
  },
};
