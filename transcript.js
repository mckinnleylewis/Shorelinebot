// transcript.js
const { ChannelType } = require('discord.js');

module.exports = async (channel, client) => {
    try {
        if (!channel || channel.type !== ChannelType.GuildText) {
            console.error("Invalid channel provided for transcript.");
            return null;
        }

        const fetchMessages = async (channel) => {
            let allMessages = [];
            let lastId;

            while (true) {
                const options = { limit: 100 };
                if (lastId) {
                    options.before = lastId;
                }
                const messages = await channel.messages.fetch(options);
                allMessages = allMessages.concat(Array.from(messages.values()));
                lastId = messages.last()?.id;
                if (messages.size < 100) break;
            }
            return allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        };

        const messages = await fetchMessages(channel);

        let transcript = `Transcript of #${channel.name}\nTicket Created at: ${channel.createdAt.toLocaleString()}\n\n`;

        messages.forEach(msg => {
            const date = msg.createdAt.toLocaleString();
            const author = msg.author.tag;
            const content = msg.content;
            const attachments = msg.attachments.size > 0 ? ` [Attachments: ${msg.attachments.map(a => a.url).join(', ')}]` : '';
            
            // Format the content, including newlines
            const formattedContent = content.split('\n').map(line => `        ${line}`).join('\n');

            transcript += `[${date}] ${author}: \n${formattedContent}${attachments}\n`;
        });

        // Add a section for user profiles in the ticket
        const perms = channel.permissionOverwrites.cache;
        let membersInTicket = [];
        for (const [id, perm] of perms) {
            if (perm.allow.has('ViewChannel') && !client.guilds.cache.get(channel.guildId).roles.cache.has(id)) {
                try {
                    const member = await channel.guild.members.fetch(id);
                    membersInTicket.push(member);
                } catch (e) {
                    // Ignore if member is not found
                }
            }
        }
        
        if (membersInTicket.length > 0) {
            transcript += '\n\n--- User Profiles in Ticket ---\n';
            membersInTicket.forEach(member => {
                const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None';
                transcript += `\n[User] ${member.user.tag} (ID: ${member.user.id})\n` +
                              `  Joined Server: ${member.joinedAt.toLocaleString()}\n` +
                              `  Roles: ${roles}\n`;
            });
        }

        return transcript;

    } catch (error) {
        console.error("Error creating transcript:", error);
        return null;
    }
};