require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActivityType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, InteractionType 
} = require('discord.js');
const fs = require('fs');

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

// Persistent custom permissions
let customPermUsers = [];
const PERMS_FILE = './customPerms.json';
if (fs.existsSync(PERMS_FILE)) {
    customPermUsers = JSON.parse(fs.readFileSync(PERMS_FILE));
}
const savePerms = () => fs.writeFileSync(PERMS_FILE, JSON.stringify(customPermUsers, null, 2));

// Logging helpers
const logCommand = async (embed) => {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) logChannel.send({ embeds: [embed] });
};

const logTicket = async (embed) => {
    const ticketLogChannel = await client.channels.fetch(TICKET_LOG).catch(() => null);
    if (ticketLogChannel) ticketLogChannel.send({ embeds: [embed] });
};

// Admin commands
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

    new SlashCommandBuilder().setName('say').setDescription('Make the bot say something')
        .addStringOption(o => o.setName('message').setDescription('Message to say').setRequired(true)),

    new SlashCommandBuilder().setName('announce').setDescription('Send an announcement embed')
        .addStringOption(o => o.setName('message').setDescription('Announcement message').setRequired(true)),

    new SlashCommandBuilder().setName('ping').setDescription('Ping the bot'),

    new SlashCommandBuilder().setName('permissions').setDescription('Grant a user permission to use admin commands')
        .addUserOption(o => o.setName('target').setDescription('User to give permission').setRequired(true)),

    new SlashCommandBuilder().setName('removeperms').setDescription('Remove a user from having admin commands permission')
        .addUserOption(o => o.setName('target').setDescription('User to remove permission').setRequired(true)),

    new SlashCommandBuilder().setName('ticketpanel').setDescription('Send the ticket panel embed')
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
        console.error(err);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.type === InteractionType.ApplicationCommand) {
        await handleCommand(interaction);
    } else if (interaction.isButton()) {
        await handleButton(interaction);
    }
});

async function handleCommand(interaction) {
    const userId = interaction.user.id;
    const member = await interaction.guild.members.fetch(userId);
    const target = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const message = interaction.options.getString('message');

    const adminCommands = ['kick', 'ban', 'warn', 'say', 'announce', 'permissions', 'removeperms'];
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
                const embed = new EmbedBuilder()
                    .setTitle('Member Warned')
                    .setDescription(`${target.tag} was warned by ${interaction.user.tag}`)
                    .addFields({ name: 'Reason', value: reason })
                    .setColor('Orange')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
                await target.send({ embeds: [embed] }).catch(() => {});
                logCommand(embed);
                break;
            }

            case 'say': {
                await interaction.channel.send({ content: message });
                await interaction.reply({ content: 'Message sent!', ephemeral: true });
                logCommand(new EmbedBuilder().setTitle('Say Command Used').setDescription(`${interaction.user.tag} said: ${message}`).setColor('Blue').setTimestamp());
                break;
            }

            case 'announce': {
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

            default:
                await interaction.reply({ content: 'Unknown command', ephemeral: true });
                break;
        }
    } catch (err) {
        await interaction.reply({ content: `Error: ${err}`, ephemeral: true });
    }
}

// Button handler
async function handleButton(interaction) {
    const { customId, user, guild } = interaction;

    const ticketTypes = {
        ticket_general: 'general-support',
        ticket_ban: 'ban-appeal',
        ticket_report: 'report',
        ticket_feedback: 'feedback',
        ticket_other: 'other'
    };

    if (customId.startsWith('ticket_')) {
        const ticketType = ticketTypes[customId] || 'ticket';
        let roleToPing = SUPPORT_ROLE;
        if (customId === 'ticket_report') roleToPing = REPORT_ROLE;

        const channelName = `ticket-${ticketType}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: TICKET_CATEGORY,
            permissionOverwrites: [
                { id: guild.id, deny: ['ViewChannel'] },
                { id: user.id, allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'ReadMessageHistory'] },
                { id: roleToPing, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
            ]
        });

        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket Created')
            .setDescription(`Ticket opened by ${user}.\n<@&${roleToPing}> has been notified.`)
            .setColor('Green')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger));

        await channel.send({ content: `<@&${roleToPing}> <@${user.id}>`, embeds: [embed], components: [row] });

        await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });

        // Log creation
        logTicket(new EmbedBuilder()
            .setTitle('Ticket Created')
            .setDescription(`Ticket: ${channel}\nOwner: ${user.tag}\nType: ${ticketType}`)
            .setColor('Green')
            .setTimestamp()
        );
    }

    // Close ticket
    if (customId === 'close_ticket') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false });

        const embed = new EmbedBuilder()
            .setTitle('🔒 Ticket Closed')
            .setDescription(`Ticket closed by ${user}.`)
            .setColor('Orange')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('reopen_ticket').setLabel('♻️ Reopen Ticket').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('delete_ticket').setLabel('🗑️ Delete Ticket').setStyle(ButtonStyle.Danger)
            );

        await interaction.channel.send({ embeds: [embed], components: [row] });

        logTicket(new EmbedBuilder()
            .setTitle('Ticket Closed')
            .setDescription(`Ticket: ${interaction.channel.name}\nClosed by: ${user.tag}`)
            .setColor('Orange')
            .setTimestamp()
        );
    }

    // Reopen ticket
    if (customId === 'reopen_ticket') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true });

        const embed = new EmbedBuilder()
            .setTitle('♻️ Ticket Reopened')
            .setDescription(`Ticket reopened by ${user}.`)
            .setColor('Green')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger));

        await interaction.channel.send({ embeds: [embed], components: [row] });

        logTicket(new EmbedBuilder()
            .setTitle('Ticket Reopened')
            .setDescription(`Ticket: ${interaction.channel.name}\nReopened by: ${user.tag}`)
            .setColor('Green')
            .setTimestamp()
        );
    }

    // Delete ticket
    if (customId === 'delete_ticket') {
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Ticket Deletion Initiated')
            .setDescription('This ticket will be deleted in 15 seconds.')
            .setColor('Red')
            .setTimestamp();

        await interaction.channel.send({ embeds: [embed], components: [] });

        logTicket(new EmbedBuilder()
            .setTitle('Ticket Deleted')
            .setDescription(`Ticket: ${interaction.channel.name}\nDeleted by: ${user.tag}`)
            .setColor('Red')
            .setTimestamp()
        );

        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 15000);
    }
}

client.login(TOKEN);
