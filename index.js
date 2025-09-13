// index.js (updated)
require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActivityType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, InteractionType, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const express = require('express'); // <-- keep-alive

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
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const { TOKEN, GUILD_ID, LOG_CHANNEL_ID, SUPPORT_ROLE, REPORT_ROLE, TICKET_CATEGORY, TICKET_LOG } = process.env;

// --- AFK Map ---
const afkMap = new Map(); // userId -> { reason: string, since: number }

// Persistent custom permissions
let customPermUsers = [];
const PERMS_FILE = './customPerms.json';
if (fs.existsSync(PERMS_FILE)) {
    try { customPermUsers = JSON.parse(fs.readFileSync(PERMS_FILE)); } catch(e) { customPermUsers = []; }
}
const savePerms = () => fs.writeFileSync(PERMS_FILE, JSON.stringify(customPermUsers, null, 2));

// Warnings persistence
const WARN_FILE = './warnings.json';
let warningsDB = {};
if (fs.existsSync(WARN_FILE)) {
    try { warningsDB = JSON.parse(fs.readFileSync(WARN_FILE)); } catch(e) { warningsDB = {}; }
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

    // Ticket user management
    new SlashCommandBuilder().setName('add').setDescription('Add a user to this ticket (gives view/send perms)')
        .addUserOption(o => o.setName('user').setDescription('User to add to ticket').setRequired(true)),

    new SlashCommandBuilder().setName('remove').setDescription('Remove a user from this ticket (removes view/send perms)')
        .addUserOption(o => o.setName('user').setDescription('User to remove from ticket').setRequired(true)),

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

client.once('ready', async () => {
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

// Interaction create (handles slash commands, buttons, modals)
client.on('interactionCreate', async interaction => {
    try {
        // Modal submit (ticket form)
        if (interaction.type === InteractionType.ModalSubmit) {
            // expecting customId like `ticket_modal_ticket_general` or `ticket_modal_ticket_ban` etc.
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
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'An error occurred.', ephemeral: true }); } catch(e) {}
    }
});

// Message create for AFK removal & mention notifications
client.on('messageCreate', async msg => {
    if (msg.author.bot) return;

    // If the author was AFK, remove AFK and announce
    if (afkMap.has(msg.author.id)) {
        afkMap.delete(msg.author.id);
        try {
            await msg.channel.send(`✅ I have removed your AFK, <@${msg.author.id}>.`);
        } catch (e) {}
    }

    // If message mentions users, notify if any are AFK
    if (msg.mentions && msg.mentions.users.size > 0) {
        msg.mentions.users.forEach(user => {
            if (afkMap.has(user.id)) {
                const afk = afkMap.get(user.id);
                try {
                    msg.reply(`⚠️ <@${user.id}> is currently AFK: **${afk.reason}** (since <t:${Math.floor(afk.since/1000)}:R>)`).catch(() => {});
                } catch(e) {}
            }
        });
    }
});

// ---------- handleCommand (all slash commands) ----------
async function handleCommand(interaction) {
    const userId = interaction.user.id;
    const member = await interaction.guild.members.fetch(userId);
    const target = interaction.options.getUser('target') || interaction.options.getUser('user') || interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const message = interaction.options.getString('message');

    // Which commands require admin?
    const adminCommands = ['kick', 'ban', 'warn', 'removewarn', 'addrole', 'removerole', 'addmulti', 'removemulti', 'add', 'remove', 'permissions', 'removeperms'];
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
            case 'ping': {
                const embed = new EmbedBuilder()
                    .setTitle('🏓 Pong!')
                    .setDescription(`Latency: ${client.ws.ping}ms`)
                    .setColor('Yellow')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logCommand(embed);
                break;
            }

            case 'permissions': {
                if (!target) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                if (!customPermUsers.includes(target.id)) customPermUsers.push(target.id);
                savePerms();
                const embed = new EmbedBuilder()
                    .setTitle('Permission Granted')
                    .setDescription(`${target.tag} can now use admin commands`)
                    .setColor('Green')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logCommand(embed);
                break;
            }

            case 'removeperms': {
                if (!target) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                customPermUsers = customPermUsers.filter(id => id !== target.id);
                savePerms();
                const embed = new EmbedBuilder()
                    .setTitle('Permission Removed')
                    .setDescription(`${target.tag} can no longer use admin commands`)
                    .setColor('Red')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logCommand(embed);
                break;
            }

            case 'kick': {
                if (!target) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                const memberTarget = await interaction.guild.members.fetch(target.id);
                await memberTarget.kick(reason);
                const embed = new EmbedBuilder()
                    .setTitle('Member Kicked')
                    .setDescription(`${target.tag} was kicked by ${interaction.user.tag}`)
                    .addFields({ name: 'Reason', value: reason })
                    .setColor('Red')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                await target.send({ embeds: [embed] }).catch(() => {});
                logCommand(embed);
                break;
            }

            case 'ban': {
                if (!target) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                const memberTarget = await interaction.guild.members.fetch(target.id);
                await memberTarget.ban({ reason });
                const embed = new EmbedBuilder()
                    .setTitle('Member Banned')
                    .setDescription(`${target.tag} was banned by ${interaction.user.tag}`)
                    .addFields({ name: 'Reason', value: reason })
                    .setColor('DarkRed')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                await target.send({ embeds: [embed] }).catch(() => {});
                logCommand(embed);
                break;
            }

            case 'warn': {
                if (!target) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                // store warning in warningsDB
                const warnId = Date.now().toString(); // unique-ish ID
                const userIdStr = target.id;
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
                    .setDescription(`${target.tag} was warned by ${interaction.user.tag}`)
                    .addFields(
                        { name: 'Reason', value: reason },
                        { name: 'Warning ID', value: warnId }
                    )
                    .setColor('Orange')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                await target.send({ embeds: [embed] }).catch(() => {});
                logCommand(embed);
                break;
            }

            case 'warnings': {
                if (!target) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                const userWarnings = warningsDB[target.id] || [];
                if (userWarnings.length === 0) {
                    return interaction.reply({ content: `${target.tag} has no warnings.`, ephemeral: true });
                }
                // Build an embed list (limit to 25 fields)
                const embed = new EmbedBuilder()
                    .setTitle(`Warnings for ${target.tag}`)
                    .setColor('Orange')
                    .setTimestamp();
                userWarnings.slice(0, 25).forEach(w => {
                    embed.addFields({ name: `ID: ${w.id} — by ${w.moderator}`, value: `${w.reason}\n${new Date(w.timestamp).toLocaleString()}` });
                });
                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            case 'removewarn': {
                if (!target) return interaction.reply({ content: 'No target provided.', ephemeral: true });
                const warnId = interaction.options.getString('warnid');
                const userWarnings = warningsDB[target.id] || [];
                const idx = userWarnings.findIndex(w => w.id === warnId);
                if (idx === -1) {
                    return interaction.reply({ content: `No warning with ID ${warnId} for ${target.tag}`, ephemeral: true });
                }
                const removed = userWarnings.splice(idx, 1)[0];
                warningsDB[target.id] = userWarnings;
                saveWarnings();

                const embed = new EmbedBuilder()
                    .setTitle('Warning Removed')
                    .setDescription(`Removed warning ${removed.id} for ${target.tag}`)
                    .addFields({ name: 'Original reason', value: removed.reason })
                    .setColor('Green')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logCommand(embed);
                break;
            }

            case 'say': {
                if (!message) return interaction.reply({ content: 'No message provided.', ephemeral: true });
                await interaction.channel.send({ content: message });
                await interaction.reply({ content: 'Message sent!', ephemeral: true });
                logCommand(new EmbedBuilder().setTitle('Say Command Used').setDescription(`${interaction.user.tag} said: ${message}`).setColor('Blue').setTimestamp());
                break;
            }

            case 'announce': {
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

            case 'ticketpanel': {
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

            // --- Ticket channel user add/remove ---
            case 'add': {
                if (!interaction.channel || !interaction.channel.name || !interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({ content: 'This command must be used inside a ticket channel.', ephemeral: true });
                }
                const userToAdd = interaction.options.getUser('user');
                await interaction.channel.permissionOverwrites.edit(userToAdd.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                const embed = new EmbedBuilder().setTitle('User Added to Ticket').setDescription(`${userToAdd.tag} was added to this ticket by ${interaction.user.tag}`).setColor('Green').setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logTicket(new EmbedBuilder().setTitle('Ticket - User Added').setDescription(`Ticket: ${interaction.channel.name}\nAdded: ${userToAdd.tag}\nBy: ${interaction.user.tag}`).setColor('Green').setTimestamp());
                break;
            }

            case 'remove': {
                if (!interaction.channel || !interaction.channel.name || !interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({ content: 'This command must be used inside a ticket channel.', ephemeral: true });
                }
                const userToRemove = interaction.options.getUser('user');
                await interaction.channel.permissionOverwrites.edit(userToRemove.id, { ViewChannel: false, SendMessages: false, ReadMessageHistory: false }).catch(() => {});
                const embed = new EmbedBuilder().setTitle('User Removed from Ticket').setDescription(`${userToRemove.tag} was removed from this ticket by ${interaction.user.tag}`).setColor('Orange').setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logTicket(new EmbedBuilder().setTitle('Ticket - User Removed').setDescription(`Ticket: ${interaction.channel.name}\nRemoved: ${userToRemove.tag}\nBy: ${interaction.user.tag}`).setColor('Orange').setTimestamp());
                break;
            }

            // --- Role single add/remove ---
            case 'addrole': {
                const userToMod = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');
                const guildMember = await interaction.guild.members.fetch(userToMod.id);
                await guildMember.roles.add(role.id).catch(err => { throw err; });
                const embed = new EmbedBuilder().setTitle('Role Added').setDescription(`Added ${role.name} to ${userToMod.tag}`).setColor('Green').setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logCommand(embed);
                break;
            }

            case 'removerole': {
                const userToMod = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');
                const guildMember = await interaction.guild.members.fetch(userToMod.id);
                await guildMember.roles.remove(role.id).catch(err => { throw err; });
                const embed = new EmbedBuilder().setTitle('Role Removed').setDescription(`Removed ${role.name} from ${userToMod.tag}`).setColor('Orange').setTimestamp();
                await interaction.reply({ embeds: [embed] });
                logCommand(embed);
                break;
            }

            // --- Role multiple add/remove (comma separated string) ---
            case 'addmulti': {
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

            case 'removemulti': {
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
        try { await interaction.reply({ content: `Error: ${err.message || err}`, ephemeral: true }); } catch(e) {}
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
            try { interaction.reply({ content: 'Unable to show modal.', ephemeral: true }); } catch(e) {}
        });
        return;
    }

    // Close ticket
    if (customId === 'close_ticket') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false }).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('🔒 Ticket Closed')
            .setDescription(`Ticket closed by ${interaction.user.tag}.`)
            .setColor('Orange')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('reopen_ticket').setLabel('♻️ Reopen Ticket').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('delete_ticket').setLabel('🗑️ Delete Ticket').setStyle(ButtonStyle.Danger)
            );

        await interaction.channel.send({ embeds: [embed], components: [row] }).catch(() => {});

        logTicket(new EmbedBuilder()
            .setTitle('Ticket Closed')
            .setDescription(`Ticket: ${interaction.channel.name}\nClosed by: ${interaction.user.tag}`)
            .setColor('Orange')
            .setTimestamp()
        );
        return;
    }

    // Reopen ticket
    if (customId === 'reopen_ticket') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true }).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('♻️ Ticket Reopened')
            .setDescription(`Ticket reopened by ${interaction.user.tag}.`)
            .setColor('Green')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger));

        await interaction.channel.send({ embeds: [embed], components: [row] }).catch(() => {});

        logTicket(new EmbedBuilder()
            .setTitle('Ticket Reopened')
            .setDescription(`Ticket: ${interaction.channel.name}\nReopened by: ${interaction.user.tag}`)
            .setColor('Green')
            .setTimestamp()
        );
        return;
    }

    // Delete ticket
    if (customId === 'delete_ticket') {
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Ticket Deletion Initiated')
            .setDescription('This ticket will be deleted in 15 seconds.')
            .setColor('Red')
            .setTimestamp();

        await interaction.channel.send({ embeds: [embed], components: [] }).catch(() => {});

        logTicket(new EmbedBuilder()
            .setTitle('Ticket Deleted')
            .setDescription(`Ticket: ${interaction.channel.name}\nDeleted by: ${interaction.user.tag}`)
            .setColor('Red')
            .setTimestamp()
        );

        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 15000);

        return;
    }
}

// ---------- handleTicketModal (create channel and include submitted info + claim system) ----------
async function handleTicketModal(interaction) {
    try {
        const customId = interaction.customId; // e.g. ticket_modal_ticket_general
        const typeKey = customId.replace('ticket_modal_', ''); // ticket_general
        const ticketTypes = {
            ticket_general: 'general-support',
            ticket_ban: 'ban-appeal',
            ticket_report: 'report',
            ticket_feedback: 'feedback',
            ticket_other: 'other'
        };
        const ticketType = ticketTypes[typeKey] || 'ticket';

        const reason = interaction.fields.getTextInputValue('ticket_reason');
        const robloxUser = interaction.fields.getTextInputValue('ticket_roblox');

        // Determine role to ping
        let roleToPing = SUPPORT_ROLE;
        if (typeKey === 'ticket_report') roleToPing = REPORT_ROLE;

        // Create sanitized channel name
        const channelName = `ticket-${ticketType}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: TICKET_CATEGORY,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'ReadMessageHistory'] },
                ...(roleToPing ? [{ id: roleToPing, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }] : [])
            ]
        }).catch(err => {
            console.error('channel create error:', err);
            return null;
        });

        if (!channel) {
            await interaction.reply({ content: 'Failed to create ticket channel.', ephemeral: true });
            return;
        }

        // Ticket embed
        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket Created')
            .setDescription(`Ticket opened by ${interaction.user.tag}.\n${ roleToPing ? `<@&${roleToPing}> has been notified.` : '' }`)
            .addFields(
                { name: 'Reason', value: reason || 'No reason provided' },
                { name: 'Roblox Username', value: robloxUser || 'Not provided' }
            )
            .setColor('Green')
            .setTimestamp();

        // Buttons: Claim + Close
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('✅ Claim Ticket').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
            );

        await channel.send({ content: `${ roleToPing ? `<@&${roleToPing}> ` : '' }<@${interaction.user.id}>`, embeds: [embed], components: [row] }).catch(() => {});

        // Acknowledge the modal to the user
        await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });

        // Optionally set channel topic with summary
        try {
            await channel.setTopic(`Ticket for ${interaction.user.tag} — Type: ${ticketType} — Roblox: ${robloxUser}`);
        } catch (e) {}

        // Log creation
        logTicket(new EmbedBuilder()
            .setTitle('Ticket Created')
            .setDescription(`Ticket: ${channel}\nOwner: ${interaction.user.tag}\nType: ${ticketType}\nRoblox: ${robloxUser}\nReason: ${reason}`)
            .setColor('Green')
            .setTimestamp()
        );

    } catch (err) {
        console.error('handleTicketModal error:', err);
        try { if (!interaction.replied) await interaction.reply({ content: 'An error occurred while creating the ticket.', ephemeral: true }); } catch(e) {}
    }
}


client.login(TOKEN);
