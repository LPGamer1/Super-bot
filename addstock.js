const { Product } = require("../models.js");

module.exports = {
    run: async (client, message, args) => {
        if (!message.member.permissions.has("ADMINISTRATOR")) return;

        const idProduto = args[0];
        const novoItem = args.slice(1).join(" "); // Pode ser um login:senha ou key

        if (!idProduto || !novoItem) return message.reply("Uso: `/addstock <id> <item>`");

        // $push adiciona o item ao array 'conta' sem apagar os anteriores
        const resultado = await Product.updateOne(
            { id: idProduto },
            { $push: { conta: novoItem } }
        );

        if (resultado.matchedCount === 0) return message.reply("❌ Produto não encontrado.");

        message.reply(`✅ Item adicionado ao estoque do produto **${idProduto}**!`);
    }
}
