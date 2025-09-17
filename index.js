// index.js
require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
    EmbedBuilder, ActivityType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, InteractionType, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const express = require('express'); // <-- keep-alive
const getTranscript = require('./transcript.js'); // Import the new module

// Keep-alive server for Render free tier
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => console.log(`Keep-alive server running on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences // Needed to check user activity status
    ],
    partials: [Partials.Channel]
});

const { TOKEN, GUILD_ID, LOG_CHANNEL_ID, SUPPORT_ROLE, REPORT_ROLE, TICKET_CATEGORY, TICKET_LOG, WELCOME_CHANNEL } = process.env;

// --- AFK Map ---
const afkMap = new Map(); // userId -> { reason: string, since: number }

// Persistent custom permissions
let customPermUsers = [];
const PERMS_FILE = './customPerms.json';
if (fs.existsSync(PERMS_FILE)) {
    try { customPermUsers = JSON.parse(fs.readFileSync(PERMS_FILE)); } catch (e) { customPermUsers = []; }
}
const savePerms = () => fs.writeFileSync(PERMS_FILE, JSON.stringify(customPermUsers, null, 2));

// Warnings persistence
const WARN_FILE = './warnings.json';
let warningsDB = {};
if (fs.existsSync(WARN_FILE)) {
    try { warningsDB = JSON.parse(fs.readFileSync(WARN_FILE)); } catch (e) { warningsDB = {}; }
}
const saveWarnings = () => fs.writeFileSync(WARN_FILE, JSON.stringify(warningsDB, null, 2));

// Logging helpers
const logCommand = async (embed) => {
    if (!LOG_CHANNEL_ID) return;
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) logChannel.send({ embeds: [embed] }).catch(() => {});
};

const logTicket = async (embed) => {
    if (!TICKET_LOG) return;
    const ticketLogChannel = await client.channels.fetch(TICKET_LOG).catch(() => null);
    if (ticketLogChannel) ticketLogChannel.send({ embeds: [embed] }).catch(() => {});
};

// Slash commands registration
const commands = [
    new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
    .addUserOption(o => o.setName('target').setDescription('User to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
    .addUserOption(o => o.setName('target').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
    .addUserOption(o => o.setName('target').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    // New: warnings list & removewarn
    new SlashCommandBuilder().setName('warnings').setDescription('List warnings for a user')
    .addUserOption(o => o.setName('target').setDescription('User to view warnings').setRequired(true)),

    new SlashCommandBuilder().setName('removewarn').setDescription('Remove a warning by its id')
    .addUserOption(o => o.setName('target').setDescription('User to remove warning from').setRequired(true))
    .addStringOption(o => o.setName('warnid').setDescription('Warning ID to remove').setRequired(true)),

    new SlashCommandBuilder().setName('say').setDescription('Make the bot say something')
    .addStringOption(o => o.setName('message').setDescription('Message to say').setRequired(true)),

    new SlashCommandBuilder().setName('announce').setDescription('Send an announcement embed')
    .addStringOption(o => o.setName('message').setDescription('Announcement message').setRequired(true)),

    new SlashCommandBuilder().setName('ping').setDescription('Ping the bot'),

    new SlashCommandBuilder().setName('permissions').setDescription('Grant a user permission to use admin commands')
    .addUserOption(o => o.setName('target').setDescription('User to give permission').setRequired(true)),

    new SlashCommandBuilder().setName('removeperms').setDescription('Remove a user from having admin commands permission')
    .addUserOption(o => o.setName('target').setDescription('User to remove permission').setRequired(true)),

    // Ticket panel
    new SlashCommandBuilder().setName('ticketpanel').setDescription('Send the ticket panel embed'),

    // Ticket user/role management
    new SlashCommandBuilder().setName('add').setDescription('Add a user or role to this ticket')
    .addMentionableOption(o => o.setName('mention').setDescription('User or role to add to ticket').setRequired(true)),

    new SlashCommandBuilder().setName('remove').setDescription('Remove a user or role from this ticket')
    .addMentionableOption(o => o.setName('mention').setDescription('User or role to remove from ticket').setRequired(true)),

    // Role commands (single)
    new SlashCommandBuilder().setName('addrole').setDescription('Add a role to a user')
    .addUserOption(o => o.setName('user').setDescription('User to add role to').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true)),

    new SlashCommandBuilder().setName('removerole').setDescription('Remove a role from a user')
    .addUserOption(o => o.setName('user').setDescription('User to remove role from').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)),

    // Role commands (multiple via comma-separated list)
    new SlashCommandBuilder().setName('addmulti').setDescription('Add multiple roles to a user (comma-separated role mentions/ids/names)')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('roles').setDescription('Comma-separated roles').setRequired(true)),

    new SlashCommandBuilder().setName('removemulti').setDescription('Remove multiple roles from a user (comma-separated role mentions/ids/names)')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('roles').setDescription('Comma-separated roles').setRequired(true)),

    // AFK command (anyone)
    new SlashCommandBuilder().setName('afk').setDescription('Set your AFK status')
    .addStringOption(o => o.setName('reason').setDescription('Reason for AFK').setRequired(false))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async() => {
    console.log(`${client.user.tag} is online!`);
    client.user.setPresence({
        status: process.env.BOT_STATUS || 'online',
        activities: [{ name: process.env.BOT_ACTIVITY || 'Shoreline Interactive', type: ActivityType.Watching }]
    });

    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('Slash commands registered.');
    } catch (err) {
        console.error('Failed to register slash commands:', err);
    }
    
    // Timed message to keep bot online
    const CHANNEL_ID_TO_PING = '1417158960410263673';
    const PING_MESSAGE = 'Online ping! This message is to keep the bot from sleeping due to inactivity. 🤖';
    const PING_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

    setInterval(async () => {
        try {
            const channel = await client.channels.fetch(CHANNEL_ID_TO_PING);
            if (channel) {
                await channel.send(PING_MESSAGE);
                console.log(`Sent an online ping to channel ${CHANNEL_ID_TO_PING}.`);
            } else {
                console.error(`Channel with ID ${CHANNEL_ID_TO_PING} not found.`);
            }
        } catch (err) {
            console.error('Failed to send timed ping message:', err);
        }
    }, PING_INTERVAL);
});

// New Event: Guild Member Add
client.on('guildMemberAdd', async member => {
    if (!WELCOME_CHANNEL) return;
    try {
        const channel = await member.guild.channels.fetch(WELCOME_CHANNEL);
        if (channel) {
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('👋 Welcome!')
                .setDescription(`Welcome to **${member.guild.name}**, <@${member.user.id}>! We're glad you're here.`)
                .setColor('Green')
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            await channel.send({ 
                content: `<@${member.user.id}>`, 
                embeds: [welcomeEmbed] 
            });
        }
    } catch (err) {
        console.error('Error sending welcome message:', err);
    }
});

// Interaction create (handles slash commands, buttons, modals)
client.on('interactionCreate', async interaction => {
    try {
        // Modal submit (ticket form)
        if (interaction.type === InteractionType.ModalSubmit) {
            // expecting customId like ticket_modal_ticket_general or ticket_modal_ticket_ban etc.
            if (interaction.customId && interaction.customId.startsWith('ticket_modal_')) {
                await handleTicketModal(interaction);
                return;
            }
        }

        if (interaction.type === InteractionType.ApplicationCommand) {
            // AFK command handled inline before other admin checks
            if (interaction.commandName === 'afk') {
                const reason = interaction.options.getString('reason') || 'AFK';
                afkMap.set(interaction.user.id, { reason, since: Date.now() });

                const embed = new EmbedBuilder()
                    .setTitle('😴 AFK Set')
                    .setDescription(`<@${interaction.user.id}> I have set your AFK: **${reason}**`)
                    .setColor('Yellow')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                return;
            }

            await handleCommand(interaction);
            return;
        }

        if (interaction.isButton()) {
            await handleButton(interaction);
            return;
        }
    } catch (err) {
        console.error('interactionCreate error:', err);
        try {
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'An error occurred.', ephemeral: true });
        } catch (e) {}
    }
});

// Message create for AFK removal, mention notifications, and auto-add to tickets
client.on('messageCreate', async msg => {
    if (msg.author.bot) return;

    // If the author was AFK, remove AFK and announce
    if (afkMap.has(msg.author.id)) {
        afkMap.delete(msg.author.id);
        try {
            await msg.channel.send(`✅ I have removed your AFK, <@${msg.author.id}>.`);
        } catch (e) {}
    }

    // If message mentions users, notify if any are AFK, and auto-add to tickets
    if (msg.mentions && msg.mentions.users.size > 0) {
        msg.mentions.users.forEach(async user => {
            if (afkMap.has(user.id)) {
                const afk = afkMap.get(user.id);
                try {
                    msg.reply(`⚠️ <@${user.id}> is currently AFK: **${afk.reason}** (since <t:${Math.floor(afk.since/1000)}:R>).catch(() => {});`);
                } catch (e) {}
            }

            // New: Auto-add mentioned user to ticket
            if (msg.channel.name.startsWith('ticket-')) {
                const isTicketMember = msg.channel.permissionsFor(user.id).has(PermissionFlagsBits.ViewChannel);
                if (!isTicketMember) {
                    try {
                        await msg.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                        const embed = new EmbedBuilder().setTitle('User Auto-Added to Ticket').setDescription(`${user.tag} was automatically added to this ticket.`).setColor('Green');
                        await msg.channel.send({ embeds: [embed] });
                        logTicket(new EmbedBuilder().setTitle('Ticket - User Auto-Added').setDescription(`Ticket: ${msg.channel.name}\nAdded: ${user.tag}\nBy: ${msg.author.tag}`).setColor('Green').setTimestamp());
                    } catch (e) {
                        console.error('Failed to add user to ticket on mention:', e);
                    }
                }
            }
        });
    }
});

// ---------- handleCommand (all slash commands) ----------
async function handleCommand(interaction) {
    const userId = interaction.user.id;
    const member = await interaction.guild.members.fetch(userId);
    const targetUser = interaction.options.getUser('target') || interaction.options.getUser('user');
    const targetMention = interaction.options.getMentionable('mention');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const message = interaction.options.getString('message');

    // Which commands require admin?
    const adminCommands = ['kick', 'ban', 'warn', 'removewarn', 'addrole', 'removerole', 'addmulti', 'removemulti', 'add', 'remove', 'permissions', 'removeperms', 'ticketpanel'];
    if (adminCommands.includes(interaction.commandName)) {
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        const isOwner = interaction.guild.ownerId === userId;
        const hasCustomPerm = customPermUsers.includes(userId);
        if (!isAdmin && !isOwner && !hasCustomPerm) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
    }

    try {
        switch (interaction.commandName) {
            case 'ping':
                {
                    const embed = new EmbedBuilder()
                        .setTitle('🏓 Pong!')
                        .setDescription(`Latency: ${client.ws.ping}ms`)
                        .setColor('Yellow')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            case 'permissions':
                {
                    if (!targetUser) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                    if (!customPermUsers.includes(targetUser.id)) customPermUsers.push(targetUser.id);
                    savePerms();
                    const embed = new EmbedBuilder()
                        .setTitle('Permission Granted')
                        .setDescription(`${targetUser.tag} can now use admin commands`)
                        .setColor('Green')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            case 'removeperms':
                {
                    if (!targetUser) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                    customPermUsers = customPermUsers.filter(id => id !== targetUser.id);
                    savePerms();
                    const embed = new EmbedBuilder()
                        .setTitle('Permission Removed')
                        .setDescription(`${targetUser.tag} can no longer use admin commands`)
                        .setColor('Red')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            case 'kick':
                {
                    if (!targetUser) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                    const memberTarget = await interaction.guild.members.fetch(targetUser.id);
                    await memberTarget.kick(reason);
                    const embed = new EmbedBuilder()
                        .setTitle('Member Kicked')
                        .setDescription(`${targetUser.tag} was kicked by ${interaction.user.tag}`)
                        .addFields({ name: 'Reason', value: reason })
                        .setColor('Red')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    await targetUser.send({ embeds: [embed] }).catch(() => {});
                    logCommand(embed);
                    break;
                }

            case 'ban':
                {
                    if (!targetUser) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                    const memberTarget = await interaction.guild.members.fetch(targetUser.id);
                    await memberTarget.ban({ reason });
                    const embed = new EmbedBuilder()
                        .setTitle('Member Banned')
                        .setDescription(`${targetUser.tag} was banned by ${interaction.user.tag}`)
                        .addFields({ name: 'Reason', value: reason })
                        .setColor('DarkRed')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    await targetUser.send({ embeds: [embed] }).catch(() => {});
                    logCommand(embed);
                    break;
                }

            case 'warn':
                {
                    if (!targetUser) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                    // store warning in warningsDB
                    const warnId = Date.now().toString(); // unique-ish ID
                    const userIdStr = targetUser.id;
                    if (!warningsDB[userIdStr]) warningsDB[userIdStr] = [];
                    const warnObj = {
                        id: warnId,
                        moderator: interaction.user.tag,
                        moderatorId: interaction.user.id,
                        reason,
                        timestamp: new Date().toISOString()
                    };
                    warningsDB[userIdStr].push(warnObj);
                    saveWarnings();

                    const embed = new EmbedBuilder()
                        .setTitle('Member Warned')
                        .setDescription(`${targetUser.tag} was warned by ${interaction.user.tag}`)
                        .addFields(
                            { name: 'Reason', value: reason }, { name: 'Warning ID', value: warnId }
                        )
                        .setColor('Orange')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    await targetUser.send({ embeds: [embed] }).catch(() => {});
                    logCommand(embed);
                    break;
                }

            case 'warnings':
                {
                    if (!targetUser) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                    const userWarnings = warningsDB[targetUser.id] || [];
                    if (userWarnings.length === 0) {
                        return interaction.reply({ content: `${targetUser.tag} has no warnings.`, ephemeral: true });
                    }
                    // Build an embed list (limit to 25 fields)
                    const embed = new EmbedBuilder()
                        .setTitle(`Warnings for ${targetUser.tag}`)
                        .setColor('Orange')
                        .setTimestamp();
                    userWarnings.slice(0, 25).forEach(w => {
                        embed.addFields({ name: `ID: ${w.id} — by ${w.moderator}`, value: `${w.reason}\n${new Date(w.timestamp).toLocaleString()}` });
                    });
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    break;
                }

            case 'removewarn':
                {
                    if (!targetUser) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                    const warnId = interaction.options.getString('warnid');
                    const userWarnings = warningsDB[targetUser.id] || [];
                    const idx = userWarnings.findIndex(w => w.id === warnId);
                    if (idx === -1) {
                        return interaction.reply({ content: `No warning with ID ${warnId} for ${targetUser.tag}`, ephemeral: true });
                    }
                    const removed = userWarnings.splice(idx, 1)[0];
                    warningsDB[targetUser.id] = userWarnings;
                    saveWarnings();

                    const embed = new EmbedBuilder()
                        .setTitle('Warning Removed')
                        .setDescription(`Removed warning ${removed.id} for ${targetUser.tag}`)
                        .addFields({ name: 'Original reason', value: removed.reason })
                        .setColor('Green')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            case 'say':
                {
                    if (!message) return interaction.reply({ content: 'No message provided.', ephemeral: true });
                    await interaction.channel.send({ content: message });
                    await interaction.reply({ content: 'Message sent!', ephemeral: true });
                    logCommand(new EmbedBuilder().setTitle('Say Command Used').setDescription(`${interaction.user.tag} said: ${message}`).setColor('Blue').setTimestamp());
                    break;
                }

            case 'announce':
                {
                    if (!message) return interaction.reply({ content: 'No message provided.', ephemeral: true });
                    const embed = new EmbedBuilder()
                        .setTitle('📢 Announcement')
                        .setDescription(message)
                        .setColor('Blue')
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            case 'ticketpanel':
                {
                    const embed = new EmbedBuilder()
                        .setTitle('🎫 Shoreline Tickets')
                        .setDescription('Click a button below to open a ticket.\n**Available Ticket Types:**\n- General Support\n- Ban Appeal\n- Report\n- Feedback\n- Other')
                        .setColor('Green')
                        .setTimestamp();

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder().setCustomId('ticket_general').setLabel('💬 General Support').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId('ticket_ban').setLabel('⚖️ Ban Appeal').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId('ticket_report').setLabel('🚨 Report').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId('ticket_feedback').setLabel('📝 Feedback').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('ticket_other').setLabel('❓ Other').setStyle(ButtonStyle.Secondary)
                        );

                    await interaction.channel.send({ embeds: [embed], components: [row] });
                    await interaction.reply({ content: 'Ticket panel sent!', ephemeral: true });
                    logCommand(new EmbedBuilder().setTitle('Ticket Panel Sent').setDescription(`Panel sent by ${interaction.user.tag}`).setColor('Green').setTimestamp());
                    break;
                }

            // --- Ticket channel user/role add/remove ---
            case 'add':
                {
                    if (!interaction.channel || !interaction.channel.name || !interaction.channel.name.startsWith('ticket-')) {
                        return interaction.reply({ content: 'This command must be used inside a ticket channel.', ephemeral: true });
                    }
                    if (!targetMention) {
                           return interaction.reply({ content: 'You must mention a user or role to add.', ephemeral: true });
                    }
                    
                    const type = targetMention.user ? 'user' : 'role';
                    const targetId = targetMention.id;
                    const targetName = targetMention.user ? targetMention.user.tag : targetMention.name;

                    await interaction.channel.permissionOverwrites.edit(targetId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                    const embed = new EmbedBuilder().setTitle(`${type === 'user' ? 'User' : 'Role'} Added to Ticket`).setDescription(`${targetName} was added to this ticket by ${interaction.user.tag}`).setColor('Green').setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logTicket(new EmbedBuilder().setTitle('Ticket - User/Role Added').setDescription(`Ticket: ${interaction.channel.name}\nAdded: ${targetName}\nBy: ${interaction.user.tag}`).setColor('Green').setTimestamp());
                    break;
                }

            case 'remove':
                {
                    if (!interaction.channel || !interaction.channel.name || !interaction.channel.name.startsWith('ticket-')) {
                        return interaction.reply({ content: 'This command must be used inside a ticket channel.', ephemeral: true });
                    }
                    if (!targetMention) {
                           return interaction.reply({ content: 'You must mention a user or role to remove.', ephemeral: true });
                    }

                    const type = targetMention.user ? 'user' : 'role';
                    const targetId = targetMention.id;
                    const targetName = targetMention.user ? targetMention.user.tag : targetMention.name;

                    await interaction.channel.permissionOverwrites.edit(targetId, { ViewChannel: false, SendMessages: false, ReadMessageHistory: false }).catch(() => {});
                    const embed = new EmbedBuilder().setTitle(`${type === 'user' ? 'User' : 'Role'} Removed from Ticket`).setDescription(`${targetName} was removed from this ticket by ${interaction.user.tag}`).setColor('Orange').setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logTicket(new EmbedBuilder().setTitle('Ticket - User/Role Removed').setDescription(`Ticket: ${interaction.channel.name}\nRemoved: ${targetName}\nBy: ${interaction.user.tag}`).setColor('Orange').setTimestamp());
                    break;
                }

            // --- Role single add/remove ---
            case 'addrole':
                {
                    const userToMod = interaction.options.getUser('user');
                    const role = interaction.options.getRole('role');
                    const guildMember = await interaction.guild.members.fetch(userToMod.id);
                    await guildMember.roles.add(role.id).catch(err => {
                        throw err;
                    });
                    const embed = new EmbedBuilder().setTitle('Role Added').setDescription(`Added ${role.name} to ${userToMod.tag}`).setColor('Green').setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            case 'removerole':
                {
                    const userToMod = interaction.options.getUser('user');
                    const role = interaction.options.getRole('role');
                    const guildMember = await interaction.guild.members.fetch(userToMod.id);
                    await guildMember.roles.remove(role.id).catch(err => {
                        throw err;
                    });
                    const embed = new EmbedBuilder().setTitle('Role Removed').setDescription(`Removed ${role.name} from ${userToMod.tag}`).setColor('Orange').setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            // --- Role multiple add/remove (comma separated string) ---
            case 'addmulti':
                {
                    const userToMod = interaction.options.getUser('user');
                    const rolesString = interaction.options.getString('roles');
                    const guildMember = await interaction.guild.members.fetch(userToMod.id);

                    const roleTokens = rolesString.split(',').map(s => s.trim()).filter(Boolean);
                    const addedRoles = [];
                    const failed = [];
                    for (const token of roleTokens) {
                        // try mention <@&ID>
                        const mentionMatch = token.match(/^<@&(\d+)>$/);
                        let role = null;
                        if (mentionMatch) role = interaction.guild.roles.cache.get(mentionMatch[1]);
                        else if (/^\d+$/.test(token)) role = interaction.guild.roles.cache.get(token);
                        else role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === token.toLowerCase());
                        if (role) {
                            try {
                                await guildMember.roles.add(role.id);
                                addedRoles.push(role.name);
                            } catch (e) {
                                failed.push(token);
                            }
                        } else {
                            failed.push(token);
                        }
                    }

                    const embed = new EmbedBuilder().setTitle('Add Multiple Roles').setColor('Green').setTimestamp()
                        .setDescription(`Added: ${addedRoles.length ? addedRoles.join(', ') : 'None'}\nFailed: ${failed.length ? failed.join(', ') : 'None'}`);
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }

            case 'removemulti':
                {
                    const userToMod = interaction.options.getUser('user');
                    const rolesString = interaction.options.getString('roles');
                    const guildMember = await interaction.guild.members.fetch(userToMod.id);

                    const roleTokens = rolesString.split(',').map(s => s.trim()).filter(Boolean);
                    const removedRoles = [];
                    const failed = [];
                    for (const token of roleTokens) {
                        const mentionMatch = token.match(/^<@&(\d+)>$/);
                        let role = null;
                        if (mentionMatch) role = interaction.guild.roles.cache.get(mentionMatch[1]);
                        else if (/^\d+$/.test(token)) role = interaction.guild.roles.cache.get(token);
                        else role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === token.toLowerCase());
                        if (role) {
                            try {
                                await guildMember.roles.remove(role.id);
                                removedRoles.push(role.name);
                            } catch (e) {
                                failed.push(token);
                            }
                        } else {
                            failed.push(token);
                        }
                    }

                    const embed = new EmbedBuilder().setTitle('Remove Multiple Roles').setColor('Orange').setTimestamp()
                        .setDescription(`Removed: ${removedRoles.length ? removedRoles.join(', ') : 'None'}\nFailed: ${failed.length ? failed.join(', ') : 'None'}`);
                    await interaction.reply({ embeds: [embed] });
                    logCommand(embed);
                    break;
                }
            
            // ... (rest of your cases)
            default:
                await interaction.reply({ content: 'Unknown command.', ephemeral: true });
        }
    } catch (err) {
        console.error(`Error handling command ${interaction.commandName}:`, err);
        const errorEmbed = new EmbedBuilder()
            .setTitle('Command Failed')
            .setDescription(`There was an error while executing this command: \`${err.message}\``)
            .setColor('DarkRed')
            .setTimestamp();
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        }
    }
}

// --- handleButton (ticket buttons) ---
async function handleButton(interaction) {
    if (interaction.customId === 'close_ticket') {
        const ticketChannel = interaction.channel;
        if (!ticketChannel.name.startsWith('ticket-')) {
            return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
        }

        const transcriptButton = new ButtonBuilder()
            .setCustomId('save_transcript')
            .setLabel('Save Transcript')
            .setStyle(ButtonStyle.Secondary);

        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_close')
            .setLabel('Confirm Close')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(transcriptButton, confirmButton, cancelButton);

        await interaction.reply({
            content: 'Are you sure you want to close this ticket?',
            components: [row],
            ephemeral: true
        });
        return;
    }

    if (interaction.customId === 'confirm_close') {
        const ticketChannel = interaction.channel;
        const ticketMember = await interaction.guild.members.fetch(ticketChannel.topic).catch(() => null);
        
        await ticketChannel.delete();
        await interaction.followUp({ content: 'Ticket closed.', ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('Ticket Closed')
            .setDescription(`Ticket \`${ticketChannel.name}\` was closed by ${interaction.user.tag}`)
            .addFields(
                { name: 'Opened By', value: ticketMember ? `<@${ticketMember.id}>` : 'Unknown User', inline: true },
                { name: 'Transcript', value: 'Transcript not saved.', inline: true }
            )
            .setColor('Red')
            .setTimestamp();
        logTicket(embed);
        return;
    }

    if (interaction.customId === 'cancel_close') {
        await interaction.update({ content: 'Ticket closure cancelled.', components: [], ephemeral: true });
        return;
    }
    
    if (interaction.customId === 'save_transcript') {
        const ticketChannel = interaction.channel;
        if (!ticketChannel.name.startsWith('ticket-')) {
            return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
        }
    
        await interaction.deferReply({ ephemeral: true });

        try {
            const transcript = await getTranscript(ticketChannel);
            const transcriptEmbed = new EmbedBuilder()
                .setTitle(`Transcript for ${ticketChannel.name}`)
                .setDescription('See the attached file for the full conversation history.')
                .setColor('Blue')
                .setTimestamp();
    
            await logTicket(transcriptEmbed);
            await logTicket({ files: [{ attachment: transcript, name: `${ticketChannel.name}.html` }] });
    
            await interaction.editReply({ content: 'Transcript saved!', ephemeral: true });
        } catch (err) {
            console.error('Failed to save transcript:', err);
            await interaction.editReply({ content: 'Failed to save transcript.', ephemeral: true });
        }
        return;
    }

    if (interaction.customId.startsWith('ticket_')) {
        const ticketType = interaction.customId.replace('ticket_', '');

        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${ticketType}`)
            .setTitle(`Open a ${ticketType} Ticket`);

        const subjectInput = new TextInputBuilder()
            .setCustomId('ticket_subject')
            .setLabel("Subject")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g., Ban Appeal, Bug Report")
            .setRequired(true);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('ticket_description')
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Please describe your issue in detail.")
            .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(subjectInput);
        const secondRow = new ActionRowBuilder().addComponents(descriptionInput);

        modal.addComponents(firstRow, secondRow);
        await interaction.showModal(modal);
        return;
    }
}

// --- handleTicketModal ---
async function handleTicketModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const subject = interaction.fields.getTextInputValue('ticket_subject');
    const description = interaction.fields.getTextInputValue('ticket_description');
    const ticketType = interaction.customId.replace('ticket_modal_', '');
    const user = interaction.user;
    
    const guild = interaction.guild;
    const category = guild.channels.cache.get(TICKET_CATEGORY);
    if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.editReply({ content: 'Ticket category not configured or not found.', ephemeral: true });
        return;
    }

    // Check for existing open tickets
    const existingTicket = guild.channels.cache.find(c => 
        c.name.startsWith('ticket-') && c.topic && c.topic === user.id
    );

    if (existingTicket) {
        await interaction.editReply({ content: `You already have an open ticket in ${existingTicket}. Please use that one or close it first.`, ephemeral: true });
        return;
    }

    try {
        const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15)}-${Math.random().toString(36).substring(2, 6)}`;
        
        const newTicketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: TICKET_CATEGORY,
            topic: user.id, // Storing the user ID in the topic for easy access
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                {
                    id: client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                }
            ],
        });

        // Add support role if it exists
        if (SUPPORT_ROLE) {
            await newTicketChannel.permissionOverwrites.edit(SUPPORT_ROLE, { ViewChannel: true, SendMessages: true });
        }

        // Add report role if it's a report ticket
        if (ticketType === 'report' && REPORT_ROLE) {
            await newTicketChannel.permissionOverwrites.edit(REPORT_ROLE, { ViewChannel: true, SendMessages: true });
        }

        const closeButton = new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(closeButton);

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`Ticket Opened - ${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)}`)
            .setDescription(`**Subject:** ${subject}\n\n**Description:**\n${description}\n\n<@${user.id}>, a support member will be with you shortly.`)
            .addFields(
                { name: 'Opened By', value: `<@${user.id}>`, inline: true },
                { name: 'Ticket Type', value: ticketType, inline: true }
            )
            .setColor('Blue')
            .setTimestamp();
        
        const supportPing = SUPPORT_ROLE ? `<@&${SUPPORT_ROLE}>` : '';
        const reportPing = (ticketType === 'report' && REPORT_ROLE) ? `<@&${REPORT_ROLE}>` : '';
        
        await newTicketChannel.send({ 
            content: `${supportPing} ${reportPing}`, 
            embeds: [ticketEmbed], 
            components: [row] 
        });

        await interaction.editReply({ content: `Your ticket has been created! You can find it here: ${newTicketChannel}.`, ephemeral: true });

        const logEmbed = new EmbedBuilder()
            .setTitle('Ticket Opened')
            .setDescription(`A new ticket was opened by ${user.tag}`)
            .addFields(
                { name: 'Ticket Channel', value: `<#${newTicketChannel.id}>`, inline: true },
                { name: 'Ticket Type', value: ticketType, inline: true }
            )
            .setColor('Green')
            .setTimestamp();
        logTicket(logEmbed);
    } catch (err) {
        console.error('Failed to create ticket channel:', err);
        await interaction.editReply({ content: 'Failed to create ticket channel.', ephemeral: true });
    }
}

client.login(TOKEN);