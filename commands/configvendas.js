const Discord = require("discord.js");
const { Config } = require("../models.js");

module.exports = {
    run: async (client, message, args) => {
        if (!message.member.permissions.has("ADMINISTRATOR")) return;

        // Se for menção de canal ou ID
        const canal = message.mentions.channels.first() || client.channels.cache.get(args[0]);
        if (!canal) return message.reply("Mencione um canal válido.");

        // Atualiza a configuração. Como só existe 1 config para o bot, pegamos a primeira ou criamos.
        // O método findOneAndUpdate com upsert:true garante que cria se não existir.
        await Config.findOneAndUpdate({}, { 
            logs: canal.id // Ou 'catecarrinho', depende do que esse arquivo específico fazia
        }, { upsert: true, new: true });

        message.reply(`✅ Canal de vendas configurado para ${canal}!`);
    }
}
