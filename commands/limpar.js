const Discord = require("discord.js");
// Remova linhas como: const db = require("quick.db");

module.exports = {
    run: async (client, message, args) => {
        if (!message.member.permissions.has("MANAGE_MESSAGES")) return;
        
        const deleteCount = parseInt(args[0], 10);
        if (!deleteCount || deleteCount < 1 || deleteCount > 99)
            return message.reply("Forneça um número entre 1 e 99.");

        const fetched = await message.channel.messages.fetch({ limit: deleteCount });
        message.channel.bulkDelete(fetched).catch(error => message.reply(`Não foi possível deletar mensagens devido a: ${error}`));
    }
}
