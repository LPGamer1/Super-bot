const Discord = require("discord.js");
const { Product } = require("../models.js");

module.exports = {
    name: "stockid", // ou o nome que você usava
    run: async (client, message, args) => {
        if (!message.member.permissions.has("ADMINISTRATOR")) return message.reply("❌ Sem permissão.");

        const id = args[0];
        const conteudo = args.slice(1).join(" "); // O conteúdo do estoque

        if (!id || !conteudo) {
            return message.reply("❌ Uso correto: `/stockid <id_produto> <conteudo>`\nEx: `/stockid netflix login:senha`");
        }

        // Procura e atualiza (push adiciona ao array)
        const resultado = await Product.updateOne(
            { id: id },
            { $push: { conta: conteudo } }
        );

        if (resultado.matchedCount === 0) {
            return message.reply("❌ Produto não encontrado!");
        }

        message.reply(`✅ Item adicionado ao estoque do produto **${id}** com sucesso!`);
    }
}
