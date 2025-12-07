const { Product } = require("../models.js");

module.exports = {
    run: async (client, message, args) => {
        if (!message.member.permissions.has("ADMINISTRATOR")) return;

        const idProduto = args[0];
        // Pega tudo a partir do segundo argumento e junta com espaços
        const novoNome = args.slice(1).join(" "); 

        if (!idProduto || !novoNome) return message.reply("Uso: `/setnome <id> <novo nome>`");

        const resultado = await Product.updateOne(
            { id: idProduto },
            { $set: { nome: novoNome } }
        );

        if (resultado.matchedCount === 0) return message.reply("❌ Produto não existe.");

        message.reply(`✅ Nome atualizado para: **${novoNome}**`);
    }
}
