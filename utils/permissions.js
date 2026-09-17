const { PermissionFlagsBits } = require('discord.js');

function hasPermission(member, permission) {
  return member?.permissions?.has(permission) ?? false;
}

function isAdministrator(member) {
  return hasPermission(member, PermissionFlagsBits.Administrator);
}

function canManageGuild(member) {
  return isAdministrator(member) || hasPermission(member, PermissionFlagsBits.ManageGuild);
}

module.exports = { hasPermission, isAdministrator, canManageGuild };
