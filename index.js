require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
    EmbedBuilder, ActivityType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, InteractionType, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const express = require('express');

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

const {
    TOKEN, GUILD_ID, LOG_CHANNEL_ID, SUPPORT_ROLE, REPORT_ROLE, TICKET_CATEGORY, TICKET_LOG, VERIFY_LOG_CHANNEL, VERIFIED_ROLE_ID, WELCOME_CHANNEL
} = process.env;

// --- AFK Map ---
const afkMap = new Map(); // userId -> { reason: string, since: number }

// --- Verification Codes ---
const VERIFICATION_CODES = [
    '4K7H9J2L',
    'N8M5Q2RX',
    'Z6T1B9WP',
    'H3F8D7VC',
    'R2G6L5SX'
];

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

    new SlashCommandBuilder().setName('ticketpanel').setDescription('Send the ticket panel embed'),

    new SlashCommandBuilder().setName('add').setDescription('Add a user to this ticket (gives view/send perms)')
        .addUserOption(o => o.setName('user').setDescription('User to add to ticket').setRequired(true)),

    new SlashCommandBuilder().setName('remove').setDescription('Remove a user from this ticket (removes view/send perms)')
        .addUserOption(o => o.setName('user').setDescription('User to remove from ticket').setRequired(true)),

    new SlashCommandBuilder().setName('addrole').setDescription('Add a role to a user')
        .addUserOption(o => o.setName('user').setDescription('User to add role to').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true)),

    new SlashCommandBuilder().setName('removerole').setDescription('Remove a role from a user')
        .addUserOption(o => o.setName('user').setDescription('User to remove role from').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)),

    new SlashCommandBuilder().setName('addmulti').setDescription('Add multiple roles to a user (comma-separated role mentions/ids/names)')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(o => o.setName('roles').setDescription('Comma-separated roles').setRequired(true)),

    new SlashCommandBuilder().setName('removemulti').setDescription('Remove multiple roles from a user (comma-separated role mentions/ids/names)')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(o => o.setName('roles').setDescription('Comma-separated roles').setRequired(true)),

    new SlashCommandBuilder().setName('afk').setDescription('Set your AFK status')
        .addStringOption(o => o.setName('reason').setDescription('Reason for AFK').setRequired(false))
].map(cmd => cmd.toJSON());

const rest = new REST({
    version: '10'
}).setToken(TOKEN);

client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);
    client.user.setPresence({
        status: process.env.BOT_STATUS || 'online',
        activities: [{
            name: process.env.BOT_ACTIVITY || 'Shoreline Interactive',
            type: ActivityType.Watching
        }]
    });

    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
            body: commands
        });
        console.log('Slash commands registered.');
    } catch (err) {
        console.error('Failed to register slash commands:', err);
    }
});

// New member join event for verification
client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    if (member.guild.id !== GUILD_ID) return;

    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL);
    if (!welcomeChannel) {
        console.error(`Welcome channel with ID ${WELCOME_CHANNEL} not found.`);
        return;
    }

    const welcomeEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Welcome to the Server!')
        .setDescription('To gain access to the server, you need to verify your account by entering one of the codes below.')
        .addFields({
            name: 'Verification Codes',
            value: `1️⃣ \`4K7H9J2L\`\n2️⃣ \`N8M5Q2RX\`\n3️⃣ \`Z6T1B9WP\`\n4️⃣ \`H3F8D7VC\`\n5️⃣ \`R2G6L5SX\``,
            inline: false
        })
        .setTimestamp()
        .setFooter({
            text: `Welcome to ${member.guild.name}`
        });

    welcomeChannel.send({
        content: `Hey ${member}! Please go to <#${VERIFY_CHANNEL}> to get verified.`,
        embeds: [welcomeEmbed]
    }).catch(console.error);
});

// Interaction create (handles slash commands, buttons, modals)
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === 'verify_modal') {
                await handleVerifyModal(interaction);
                return;
            } else if (interaction.customId && interaction.customId.startsWith('ticket_modal_')) {
                await handleTicketModal(interaction);
                return;
            }
        }

        if (interaction.isButton()) {
            await handleButton(interaction);
            return;
        }

        if (interaction.isCommand()) {
            if (interaction.commandName === 'afk') {
                const reason = interaction.options.getString('reason') || 'AFK';
                afkMap.set(interaction.user.id, {
                    reason,
                    since: Date.now()
                });

                const embed = new EmbedBuilder()
                    .setTitle('😴 AFK Set')
                    .setDescription(`I have set your AFK: **${reason}**`)
                    .setColor('Yellow')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                return;
            }
            await handleCommand(interaction);
        }
    } catch (err) {
        console.error('interactionCreate error:', err);
        try {
            if (!interaction.replied && !interaction.deferred) await interaction.reply({
                content: 'An error occurred.',
                ephemeral: true
            });
        } catch (e) {}
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
                } catch (e) {}
            }
        });
    }
});

// ---------- handleCommand (all slash commands) ----------
async function handleCommand(interaction) {
    const userId = interaction.user.id;
    const member = await interaction.guild.members.fetch(userId);
    const target = interaction.options.getUser('target') || interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const message = interaction.options.getString('message');

    // Which commands require admin?
    const adminCommands = ['kick', 'ban', 'warn', 'warnings', 'removewarn', 'addrole', 'removerole', 'addmulti', 'removemulti', 'add', 'remove', 'permissions', 'removeperms', 'ticketpanel', 'say', 'announce'];
    if (adminCommands.includes(interaction.commandName)) {
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        const isOwner = interaction.guild.ownerId === userId;
        const hasCustomPerm = customPermUsers.includes(userId);
        if (!isAdmin && !isOwner && !hasCustomPerm) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
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
                await interaction.reply({
                    embeds: [embed]
                });
                logCommand(embed);
                break;
            }

            case 'permissions': {
                if (!target) return interaction.reply({
                    content: 'No target provided.',
                    ephemeral: true
                });
                if (!customPermUsers.includes(target.id)) customPermUsers.push(target.id);
                savePerms();
                const embed = new EmbedBuilder()
                    .setTitle('Permission Granted')
                    .setDescription(`${target.tag} can now use admin commands`)
                    .setColor('Green')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                logCommand(embed);
                break;
            }

            case 'removeperms': {
                if (!target) return interaction.reply({
                    content: 'No target provided.',
                    ephemeral: true
                });
                customPermUsers = customPermUsers.filter(id => id !== target.id);
                savePerms();
                const embed = new EmbedBuilder()
                    .setTitle('Permission Removed')
                    .setDescription(`${target.tag} can no longer use admin commands`)
                    .setColor('Red')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                logCommand(embed);
                break;
            }

            case 'kick': {
                if (!target) return interaction.reply({
                    content: 'No target provided.',
                    ephemeral: true
                });
                const memberTarget = await interaction.guild.members.fetch(target.id);
                await memberTarget.kick(reason);
                const embed = new EmbedBuilder()
                    .setTitle('Member Kicked')
                    .setDescription(`${target.tag} was kicked by ${interaction.user.tag}`)
                    .addFields({
                        name: 'Reason',
                        value: reason
                    })
                    .setColor('Red')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                await target.send({
                    embeds: [embed]
                }).catch(() => {});
                logCommand(embed);
                break;
            }

            case 'ban': {
                if (!target) return interaction.reply({
                    content: 'No target provided.',
                    ephemeral: true
                });
                const memberTarget = await interaction.guild.members.fetch(target.id);
                await memberTarget.ban({
                    reason
                });
                const embed = new EmbedBuilder()
                    .setTitle('Member Banned')
                    .setDescription(`${target.tag} was banned by ${interaction.user.tag}`)
                    .addFields({
                        name: 'Reason',
                        value: reason
                    })
                    .setColor('DarkRed')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                await target.send({
                    embeds: [embed]
                }).catch(() => {});
                logCommand(embed);
                break;
            }

            case 'warn': {
                if (!target) return interaction.reply({
                    content: 'No target provided.',
                    ephemeral: true
                });
                const warnId = Date.now().toString();
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
                        {
                            name: 'Reason',
                            value: reason
                        }, {
                            name: 'Warning ID',
                            value: warnId
                        }
                    )
                    .setColor('Orange')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                await target.send({
                    embeds: [embed]
                }).catch(() => {});
                logCommand(embed);
                break;
            }

            case 'warnings': {
                if (!target) return interaction.reply({
                    content: 'No target provided.',
                    ephemeral: true
                });
                const userWarnings = warningsDB[target.id] || [];
                if (userWarnings.length === 0) {
                    return interaction.reply({
                        content: `${target.tag} has no warnings.`,
                        ephemeral: true
                    });
                }
                const embed = new EmbedBuilder()
                    .setTitle(`Warnings for ${target.tag}`)
                    .setColor('Orange')
                    .setTimestamp();
                userWarnings.slice(0, 25).forEach(w => {
                    embed.addFields({
                        name: `ID: ${w.id} — by ${w.moderator}`,
                        value: `${w.reason}\n${new Date(w.timestamp).toLocaleString()}`
                    });
                });
                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                });
                break;
            }

            case 'removewarn': {
                if (!target) return interaction.reply({
                    content: 'No target provided.',
                    ephemeral: true
                });
                const warnId = interaction.options.getString('warnid');
                const userWarnings = warningsDB[target.id] || [];
                const idx = userWarnings.findIndex(w => w.id === warnId);
                if (idx === -1) {
                    return interaction.reply({
                        content: `No warning with ID ${warnId} for ${target.tag}`,
                        ephemeral: true
                    });
                }
                const removed = userWarnings.splice(idx, 1)[0];
                warningsDB[target.id] = userWarnings;
                saveWarnings();

                const embed = new EmbedBuilder()
                    .setTitle('Warning Removed')
                    .setDescription(`Removed warning ${removed.id} for ${target.tag}`)
                    .addFields({
                        name: 'Original reason',
                        value: removed.reason
                    })
                    .setColor('Green')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                logCommand(embed);
                break;
            }

            case 'say': {
                if (!message) return interaction.reply({
                    content: 'No message provided.',
                    ephemeral: true
                });
                await interaction.channel.send({
                    content: message
                });
                await interaction.reply({
                    content: 'Message sent!',
                    ephemeral: true
                });
                logCommand(new EmbedBuilder().setTitle('Say Command Used').setDescription(`${interaction.user.tag} said: ${message}`).setColor('Blue').setTimestamp());
                break;
            }

            case 'announce': {
                if (!message) return interaction.reply({
                    content: 'No message provided.',
                    ephemeral: true
                });
                const embed = new EmbedBuilder()
                    .setTitle('📢 Announcement')
                    .setDescription(message)
                    .setColor('Blue')
                    .setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
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

                await interaction.channel.send({
                    embeds: [embed],
                    components: [row]
                });
                await interaction.reply({
                    content: 'Ticket panel sent!',
                    ephemeral: true
                });
                break;
            }

            // --- Ticket channel user add/remove ---
            case 'add': {
                if (!interaction.channel || !interaction.channel.name || !interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({
                        content: 'This command must be used inside a ticket channel.',
                        ephemeral: true
                    });
                }
                const userToAdd = interaction.options.getUser('user');
                await interaction.channel.permissionOverwrites.edit(userToAdd.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                const embed = new EmbedBuilder().setTitle('User Added to Ticket').setDescription(`${userToAdd.tag} was added to this ticket by ${interaction.user.tag}`).setColor('Green').setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                logTicket(new EmbedBuilder().setTitle('Ticket - User Added').setDescription(`Ticket: ${interaction.channel.name}\nAdded: ${userToAdd.tag}\nBy: ${interaction.user.tag}`).setColor('Green').setTimestamp());
                break;
            }

            case 'remove': {
                if (!interaction.channel || !interaction.channel.name || !interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({
                        content: 'This command must be used inside a ticket channel.',
                        ephemeral: true
                    });
                }
                const userToRemove = interaction.options.getUser('user');
                await interaction.channel.permissionOverwrites.edit(userToRemove.id, {
                    ViewChannel: false,
                    SendMessages: false,
                    ReadMessageHistory: false
                }).catch(() => {});
                const embed = new EmbedBuilder().setTitle('User Removed from Ticket').setDescription(`${userToRemove.tag} was removed from this ticket by ${interaction.user.tag}`).setColor('Orange').setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                logTicket(new EmbedBuilder().setTitle('Ticket - User Removed').setDescription(`Ticket: ${interaction.channel.name}\nRemoved: ${userToRemove.tag}\nBy: ${interaction.user.tag}`).setColor('Orange').setTimestamp());
                break;
            }

            // --- Role single add/remove ---
            case 'addrole': {
                const userToMod = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');
                const guildMember = await interaction.guild.members.fetch(userToMod.id);
                await guildMember.roles.add(role.id).catch(err => {
                    throw err;
                });
                const embed = new EmbedBuilder().setTitle('Role Added').setDescription(`Added ${role.name} to ${userToMod.tag}`).setColor('Green').setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
                logCommand(embed);
                break;
            }

            case 'removerole': {
                const userToMod = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');
                const guildMember = await interaction.guild.members.fetch(userToMod.id);
                await guildMember.roles.remove(role.id).catch(err => {
                    throw err;
                });
                const embed = new EmbedBuilder().setTitle('Role Removed').setDescription(`Removed ${role.name} from ${userToMod.tag}`).setColor('Orange').setTimestamp();
                await interaction.reply({
                    embeds: [embed]
                });
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
                await interaction.reply({
                    embeds: [embed]
                });
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
                await interaction.reply({
                    embeds: [embed]
                });
                logCommand(embed);
                break;
            }

            default:
                await interaction.reply({
                    content: 'Unknown command',
                    ephemeral: true
                });
                break;
        }
    } catch (err) {
        console.error('handleCommand error:', err);
        try {
            await interaction.reply({
                content: `Error: ${err.message || err}`,
                ephemeral: true
            });
        } catch (e) {}
    }
}

// ---------- handleButton (shows modal for ticket creation & verification) ----------
async function handleButton(interaction) {
    const {
        customId,
        user
    } = interaction;

    if (customId === 'verify_button') {
        const modal = new ModalBuilder()
            .setCustomId('verify_modal')
            .setTitle('Enter Verification Code');

        const codeInput = new TextInputBuilder()
            .setCustomId('verificationCodeInput')
            .setLabel("Verification Code")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(codeInput);
        modal.addComponents(firstRow);

        await interaction.showModal(modal);

    } else if (customId && customId.startsWith('ticket_')) {
        const ticketType = customId.split('_')[1];
        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${ticketType}`)
            .setTitle(`Open a ${ticketType} Ticket`);

        const subjectInput = new TextInputBuilder()
            .setCustomId('ticketSubjectInput')
            .setLabel("Subject")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('ticketDescriptionInput')
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(subjectInput);
        const secondRow = new ActionRowBuilder().addComponents(descriptionInput);

        modal.addComponents(firstRow, secondRow);
        await interaction.showModal(modal);

    } else if (customId === 'close_ticket') {
        const channel = interaction.channel;
        if (!channel.name.startsWith('ticket-')) {
            return await interaction.reply({
                content: 'This is not a ticket channel.',
                ephemeral: true
            });
        }

        const closeButton = new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirm Close').setStyle(ButtonStyle.Danger);
        const cancelButton = new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(closeButton, cancelButton);

        await interaction.reply({
            content: 'Are you sure you want to close this ticket?',
            components: [row]
        });

    } else if (customId === 'confirm_close') {
        await interaction.reply({
            content: 'Closing ticket in 5 seconds...',
            ephemeral: true
        });
        setTimeout(async () => {
            await interaction.channel.delete().catch(console.error);
            const logEmbed = new EmbedBuilder().setTitle('Ticket Closed').setDescription(`Ticket: ${interaction.channel.name}\nClosed by: ${interaction.user.tag}`).setColor('Red').setTimestamp();
            logTicket(logEmbed);
        }, 5000);

    } else if (customId === 'cancel_close') {
        await interaction.reply({
            content: 'Ticket closure cancelled.',
            ephemeral: true
        });
    }
}

// ---------- handleTicketModal ----------
async function handleTicketModal(interaction) {
    const {
        customId,
        user,
        guild
    } = interaction;
    const ticketType = customId.split('_')[2];
    const ticketSubject = interaction.fields.getTextInputValue('ticketSubjectInput');
    const ticketDescription = interaction.fields.getTextInputValue('ticketDescriptionInput');

    const ticketChannel = await guild.channels.create({
        name: `ticket-${user.username}-${ticketType}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: SUPPORT_ROLE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: REPORT_ROLE, deny: [PermissionFlagsBits.ViewChannel], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
    });

    const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(closeButton);

    const ticketEmbed = new EmbedBuilder()
        .setTitle(`🎫 ${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)} Ticket`)
        .setDescription(`New ticket from ${user}.\n**Subject:** ${ticketSubject}\n**Description:**\n${ticketDescription}`)
        .setColor('Green')
        .setTimestamp();

    await ticketChannel.send({
        content: `<@&${SUPPORT_ROLE}> New ticket created by ${user}!`,
        embeds: [ticketEmbed],
        components: [row]
    });

    await interaction.reply({
        content: `Your ticket has been created in ${ticketChannel}. We'll be with you shortly!`,
        ephemeral: true
    });

    logTicket(new EmbedBuilder().setTitle('New Ticket Created').setDescription(`**User:** ${user.tag}\n**Channel:** <#${ticketChannel.id}>`).setColor('Green').setTimestamp());
}

// ---------- handleVerifyModal ----------
async function handleVerifyModal(interaction) {
    const {
        user,
        guild
    } = interaction;
    const enteredCode = interaction.fields.getTextInputValue('verificationCodeInput').toUpperCase();

    // Check if the entered code is in the list of valid codes
    if (VERIFICATION_CODES.includes(enteredCode)) {
        const verifiedRole = guild.roles.cache.get(VERIFIED_ROLE_ID);
        if (!verifiedRole) {
            return interaction.reply({
                content: 'Verification failed: The "Verified" role could not be found. Please contact an admin.',
                ephemeral: true
            });
        }
        if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
            return interaction.reply({
                content: 'You are already verified!',
                ephemeral: true
            });
        }
        try {
            await interaction.member.roles.add(verifiedRole);
            await interaction.reply({
                content: '✅ Verification successful! You now have access to the server.',
                ephemeral: true
            });
            const logChannel = guild.channels.cache.get(VERIFY_LOG_CHANNEL);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('Member Verified')
                    .setDescription(`**User:** ${user.tag} (${user.id})\n**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`)
                    .setThumbnail(user.displayAvatarURL());
                logChannel.send({
                    embeds: [logEmbed]
                });
            }
        } catch (error) {
            console.error('Failed to add verified role:', error);
            await interaction.reply({
                content: 'An error occurred while assigning the role. Please try again or contact an admin.',
                ephemeral: true
            });
        }
    } else {
        await interaction.reply({
            content: '❌ Incorrect code. Please try again with one of the valid codes from the welcome message.',
            ephemeral: true
        });
    }
}

client.login(TOKEN);