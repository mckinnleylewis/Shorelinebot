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


const STICKY_FILE = './sticky.json';

// Sticky message persistence
let stickyMessages = {};
if (fs.existsSync(STICKY_FILE)) {
    try { stickyMessages = JSON.parse(fs.readFileSync(STICKY_FILE)); } catch (e) { stickyMessages = {}; }
}
const saveSticky = () => fs.writeFileSync(STICKY_FILE, JSON.stringify(stickyMessages, null, 2));

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

    // NEW: Stick a message to the bottom of the channel
    new SlashCommandBuilder().setName('stickymessage').setDescription('Sticks a message to the bottom of the channel')
    .addStringOption(o => o.setName('message').setDescription('The message to stick').setRequired(true)),

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

            default:
                await interaction.reply({ content: 'Unknown command', ephemeral: true });
                break;
        }
    } catch (err) {
        console.error('handleCommand error:', err);
        try {
            await interaction.reply({ content: `Error: ${err.message || err}`, ephemeral: true });
        } catch (e) {}
    }
}

// ---------- handleButton (shows modal for ticket creation) ----------
async function handleButton(interaction) {
    const { customId, user } = interaction;

    const ticketTypes = {
        ticket_general: 'general-support',
        ticket_ban: 'ban-appeal',
        ticket_report: 'report',
        ticket_feedback: 'feedback',
        ticket_other: 'other'
    };

    // When a ticket button is pressed, show a modal asking Reason + Roblox Username
    if (customId && customId.startsWith('ticket_')) {
        // Build modal
        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${customId}`) // e.g. ticket_modal_ticket_general
            .setTitle('Open a Ticket');

        const reasonInput = new TextInputBuilder()
            .setCustomId('ticket_reason')
            .setLabel('Reason')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Explain why you are opening this ticket...')
            .setRequired(true);

        const robloxInput = new TextInputBuilder()
            .setCustomId('ticket_roblox')
            .setLabel('Roblox Username')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Your Roblox username')
            .setRequired(true);

        // TextInput must be in ActionRow-like wrappers when added to modal
        modal.addComponents(
            new ActionRowBuilder().addComponents(reasonInput),
            new ActionRowBuilder().addComponents(robloxInput)
        );

        await interaction.showModal(modal).catch(err => {
            console.error('showModal error:', err);
            try {
                interaction.reply({ content: 'Unable to show modal.', ephemeral: true });
            } catch (e) {}
        });
        return;
    }

    // New: Claim Ticket
    if (customId === 'claim_ticket') {
        await interaction.deferUpdate();
        const member = await interaction.guild.members.fetch(user.id);
        const hasClaimPerms = member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.has(SUPPORT_ROLE) || member.roles.cache.has(REPORT_ROLE) || customPermUsers.includes(user.id);

        if (!hasClaimPerms) {
            return interaction.followUp({ content: 'You do not have permission to claim tickets.', ephemeral: true });
        }

        const originalEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(originalEmbed)
            .setTitle(`✅ Ticket Claimed`)
            .setDescription(`This ticket has been claimed by <@${user.id}>.`)
            .setColor('Green');

        const closeRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('❌ Close Ticket').setStyle(ButtonStyle.Danger)
            );
        
        await interaction.message.edit({ embeds: [newEmbed], components: [closeRow] });
        await interaction.channel.send({ content: `<@${user.id}> will be handling your ticket today.` });
        
        logTicket(new EmbedBuilder().setTitle('Ticket Claimed').setDescription(`Ticket: ${interaction.channel.name}\nClaimed By: ${user.tag}`).setColor('Blue').setTimestamp());
        return;
    }
    
    // Close Ticket button
    if (customId === 'close_ticket') {
        await interaction.deferReply({ ephemeral: true });
        const closeRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('reopen_ticket').setLabel('♻️ Reopen Ticket').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('save_transcript').setLabel('💾 Save Transcript').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('delete_ticket').setLabel('🗑️ Delete Ticket').setStyle(ButtonStyle.Danger)
            );

        const closeEmbed = new EmbedBuilder()
            .setTitle('Close Ticket')
            .setDescription('Are you sure you want to close this ticket? This action is not permanent but will close the channel.')
            .setColor('Red')
            .setTimestamp();
        await interaction.channel.send({ embeds: [closeEmbed], components: [closeRow] });
        await interaction.editReply({ content: 'Ticket close panel sent.', ephemeral: true });
        return;
    }

    // Reopen Ticket
    if (customId === 'reopen_ticket') {
        await interaction.deferReply({ ephemeral: true });
        const userPerms = interaction.channel.permissionOverwrites.cache.find(p => p.type === 'member' && p.id !== interaction.guild.id);
        if (userPerms) {
            await interaction.channel.permissionOverwrites.edit(userPerms.id, { ViewChannel: true });
            await interaction.channel.send({ content: 'Ticket reopened!' });
            await interaction.message.delete();
            logTicket(new EmbedBuilder().setTitle('Ticket Reopened').setDescription(`Ticket: ${interaction.channel.name}\nReopened By: ${user.tag}`).setColor('Green').setTimestamp());
        } else {
            await interaction.editReply({ content: 'Failed to find original ticket owner permissions.', ephemeral: true });
        }
        return;
    }

    // New: Save Transcript
    if (customId === 'save_transcript') {
        await interaction.deferReply({ ephemeral: true });

        const transcript = await getTranscript(interaction.channel, client);
        if (!transcript) {
            return interaction.editReply({ content: 'Failed to create transcript.', ephemeral: true });
        }

        const logChannel = await interaction.guild.channels.fetch(TICKET_LOG);
        if (logChannel) {
            const fileName = `transcript-${interaction.channel.name}.txt`;
            const buffer = Buffer.from(transcript, 'utf-8');

            await logChannel.send({
                content: `📝 Transcript for ticket **${interaction.channel.name}**`,
                files: [{
                    attachment: buffer,
                    name: fileName
                }]
            });
            await interaction.editReply({ content: '✅ Transcript saved!', ephemeral: true });
        } else {
            await interaction.editReply({ content: 'Failed to find log channel.', ephemeral: true });
        }
        return;
    }

    // Delete Ticket
    if (customId === 'delete_ticket') {
        await interaction.deferReply({ ephemeral: true });
        const closeEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Ticket Closed')
            .setDescription('This ticket will be deleted in 15 seconds.');

        const sentMessage = await interaction.channel.send({ embeds: [closeEmbed] });
        
        // Wait 15 seconds and then delete the channel
        setTimeout(async () => {
            await interaction.channel.delete().catch(err => {
                console.error('Error deleting ticket channel:', err);
                sentMessage.delete().catch(() => {});
            });
        }, 15000);
        
        await interaction.editReply({ content: 'Deleting ticket in 15 seconds...', ephemeral: true });
        logTicket(new EmbedBuilder().setTitle('Ticket Deleted').setDescription(`Ticket: ${interaction.channel.name}\nDeleted By: ${user.tag}`).setColor('Red').setTimestamp());
        return;
    }
}

// ---------- handleTicketModal (creates ticket channel) ----------
async function handleTicketModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const ticketSubject = interaction.customId.replace('ticket_modal_ticket_', '');
    const reason = interaction.fields.getTextInputValue('ticket_reason');
    const robloxName = interaction.fields.getTextInputValue('ticket_roblox');

    const hasTicket = interaction.guild.channels.cache.find(c =>
        c.name.startsWith(`ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`) &&
        c.parent && c.parent.id === TICKET_CATEGORY
    );

    if (hasTicket) {
        return interaction.editReply({ content: `You already have an open ticket: <#${hasTicket.id}>`, ephemeral: true });
    }

    try {
        const permissionOverwrites = [
            // Deny @everyone from viewing all tickets
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            // Allow the ticket creator to view
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];

        const rolesToPing = [];

        // Check the ticket type and set permissions accordingly
        if (ticketSubject === 'report') {
            // Report tickets are ONLY for the creator and the REPORT_ROLE
            permissionOverwrites.push({ id: REPORT_ROLE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            rolesToPing.push(REPORT_ROLE);
        } else {
            // All other tickets are for the creator, SUPPORT_ROLE, and REPORT_ROLE
            permissionOverwrites.push(
                { id: SUPPORT_ROLE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: REPORT_ROLE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            );
            rolesToPing.push(SUPPORT_ROLE, REPORT_ROLE);
        }
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            type: ChannelType.GuildText,
            parent: TICKET_CATEGORY,
            permissionOverwrites: permissionOverwrites
        });
        
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`New Ticket: ${ticketSubject.charAt(0).toUpperCase() + ticketSubject.slice(1)}`)
            .setDescription(`A staff member will be with you shortly. Please provide any additional information to help us resolve your issue.`)
            .addFields(
                { name: 'Opened by', value: `<@${interaction.user.id}>` },
                { name: 'Reason', value: reason },
                { name: 'Roblox Username', value: robloxName }
            )
            .setColor('Blue')
            .setTimestamp();

        const claimRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('🤝 Claim Ticket').setStyle(ButtonStyle.Primary)
            );

        const initialMessage = `<@${interaction.user.id}> ${rolesToPing.filter(Boolean).map(roleId => `<@&${roleId}>`).join(' ')}`;

        await ticketChannel.send({ content: initialMessage, embeds: [welcomeEmbed], components: [claimRow] });
        await interaction.editReply({ content: `✅ Your ticket has been created: <#${ticketChannel.id}>`, ephemeral: true });
        
        logTicket(new EmbedBuilder().setTitle('Ticket Created').setDescription(`**Channel:** ${ticketChannel.name}\n**User:** ${interaction.user.tag}\n**Subject:** ${ticketSubject}\n**Reason:** ${reason}`).setColor('Blue').setTimestamp());

    } catch (err) {
        console.error('Error creating ticket channel:', err);
        await interaction.editReply({ content: `Failed to create ticket: ${err.message}`, ephemeral: true });
    }
}


client.login(TOKEN);