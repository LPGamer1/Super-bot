const Discord = require("discord.js");
// Importa o modelo de Configuração que criamos
const { Config } = require("../models.js"); 

module.exports = {
    run: async (client, message, args) => {
        if (!message.member.permissions.has("ADMINISTRATOR")) return message.reply("Sem permissão.");

        // Exemplo: /configbot nome LojaDoZe
        const novoNome = args.join(" ");
        if (!novoNome) return message.reply("Digite o nome do bot.");

        // Atualiza a configuração no MongoDB
        // O comando abaixo procura uma config, se não achar, cria uma nova (upsert: true)
        await Config.findOneAndUpdate({}, { 
            nomebot: novoNome 
        }, { upsert: true, new: true });

        message.reply(`✅ Nome do bot atualizado para: **${novoNome}**`);
    }
}
